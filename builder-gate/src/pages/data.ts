/**
 * Step 5, data (#442 D10 c): each RESTAction in the draft is resolved BY SNOWPLOW, AS THE CALLER,
 * without being stored (snowplow.ts resolveInline: POST /call/read with the draft in the body,
 * snowplow#443 — docs/snowplow-contract.md), so the agent sees what the page will actually show
 * before it hands the draft back. The gate evaluates nothing itself. Each RESTAction resolves on
 * its own: drafts referencing other drafts are not in snowplow's v1 (nested refs resolve STORED
 * objects).
 *
 * Until snowplow advertises the inline resolve, the step says "live verdict missing" and is RED
 * (#442 D9) whenever the draft carries a RESTAction. A draft with none has nothing to resolve.
 *
 * What it reads back:
 *   - stage outcomes, from the X-Snowplow-Stage-Outcomes header (snowplow PR #469) — the primary
 *     source, which a spec.filter cannot hide. A write-verb stage refused by design
 *     (StageNotExecuted, or its documented message) is a NOTE ("checked at the driven Preview"), and
 *     so is a failed stage the draft marks continueOnError; any other failed stage, a truncated
 *     header and a missing one are red. The body's per-stage
 *     error messages are read only as detail;
 *   - the output itself, as a count and a short sample, with anything shaped like a Kubernetes
 *     Secret DROPPED first and the drop noted. builder-lint already refuses a RESTAction that
 *     could read Secrets (secrets.ts); this is the second layer, because snowplow reads Secret
 *     paths live as the caller and does not refuse them.
 */
import { step, type StepResult } from '../envelope'
import { HttpError } from '../http'
import type { GateContext } from '../plan'
import { CAPABILITY_RESOLVE, type SnowplowReply, STAGE_ABORTED_REASON, STAGE_NOT_EXECUTED_MESSAGE, STAGE_NOT_EXECUTED_REASON, STAGE_NOT_RUN_REASON, STAGE_OUTCOMES, STAGE_REASONS, STAGE_SKIPPED_REASON, stageOutcomesOf } from '../snowplow'

import { isRestAction, labelOf, nameOf, rec, type Rec, str } from './drafts'

/**
 * The step, plus each RESTAction's resolved output BY NAME — what the shape step (shape.ts)
 * resolves widget expressions against. Already stripped of anything Secret-shaped.
 */
export interface DataStepResult {
  step: StepResult
  outputs: Map<string, unknown>
}

const SAMPLE_CHARS = 1_200
const PER_CALL_MS = 20_000
export const STEP_BUDGET_MS = 40_000

const describe = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `an array of ${value.length} item(s)`
  }
  const items = rec(value)?.items
  if (Array.isArray(items)) {
    return `an object whose items holds ${items.length} item(s)`
  }
  if (value === null || value === undefined || value === '') {
    return 'EMPTY (null) — the page would render no data'
  }
  return `a ${typeof value}`
}

const sample = (value: unknown): string => {
  const head = Array.isArray(value) ? value.slice(0, 3) : value
  const text = JSON.stringify(head) ?? 'null'
  return text.length > SAMPLE_CHARS ? `${text.slice(0, SAMPLE_CHARS)}…` : text
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** A Kubernetes Secret, or something shaped like one: kind Secret, or a `data` map of base64 under a Secret-shaped object. */
export const secretShaped = (value: unknown): boolean => {
  const obj = rec(value)
  if (!obj) {
    return false
  }
  if (obj.kind === 'Secret') {
    return true
  }
  const data = rec(obj.data)
  const values = data ? Object.values(data) : []
  const base64Map = values.length > 0 && values.every((v) => typeof v === 'string' && BASE64.test(v))
  const secretLike = typeof obj.type === 'string' || rec(obj.metadata) !== null || 'stringData' in obj || 'immutable' in obj
  return base64Map && secretLike
}

/** `value` with every Secret-shaped object (at any depth) replaced, and how many were. */
export const withoutSecrets = (value: unknown): { value: unknown; dropped: number } => {
  let dropped = 0
  const walk = (node: unknown): unknown => {
    if (secretShaped(node)) {
      dropped += 1
      return '[dropped by the gate: a Secret-shaped object]'
    }
    if (Array.isArray(node)) {
      return node.map(walk)
    }
    const obj = rec(node)
    return obj ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, walk(v)])) : node
  }
  // `walk` increments `dropped` as it goes, so the call must happen BEFORE `dropped` is read.
  // Object literal properties evaluate in source order, which made `{ dropped, value: walk(value) }`
  // return a count of 0 — a real bug introduced by `eslint --fix` sorting these two keys. Binding
  // the result first makes the order explicit and the literal safe to sort.
  const walked = walk(value)
  return { dropped, value: walked }
}

/** Every per-stage error message in a resolve's body, from each stage's errorKey — detail only. */
const bodyStageMessages = (ra: Rec, output: unknown): string[] => {
  const out = rec(output)
  if (!out) {
    return []
  }
  const apis = (Array.isArray(rec(ra.spec)?.api) ? rec(ra.spec)?.api as unknown[] : []).map((a) => rec(a) ?? {})
  const keys = new Set(['error', ...apis.map((api) => str(api.errorKey) ?? 'error')])
  return [...keys].flatMap((key) => {
    const entries = out[key]
    return (Array.isArray(entries) ? entries : entries === undefined ? [] : [entries])
      .map((entry) => String(rec(entry)?.message ?? (typeof entry === 'string' ? entry : JSON.stringify(entry))))
  })
}

/** The body's message for a stage, when one names it (`stage "<name>"`): detail for a note. */
const detailFor = (messages: readonly string[], stage: string): string | undefined =>
  messages.find((m) => m.includes(`stage ${JSON.stringify(stage)}`) || m.includes(`stage ${stage} `))

/**
 * Stage outcomes from X-Snowplow-Stage-Outcomes — the PRIMARY source, which no spec.filter can
 * hide. Each failed stage, in the header's topological order:
 *   - a reason outside the closed set (or none): red, "unknown reason";
 *   - StageNotExecuted, or — the documented fallback — the body message `dry-run: stage "<name>"
 *     verb <V> is not executed`: a NOTE, refused by design, checked at the driven Preview;
 *   - a stage the draft marks continueOnError (by name): a NOTE — its author declared the
 *     tolerance, and the driven Preview judges what renders;
 *   - NotRun: the resolve stopped before this stage. snowplow truncates a resolve at the first
 *     stage that fails hard (stage_outcomes.go, resolve.go), and every later stage in topological
 *     order reports NotRun — whatever its dependsOn. So the cause is the nearest earlier failed
 *     stage: if that one is a note (refused by design, or continueOnError), so is the NotRun;
 *     otherwise the NotRun is red with it;
 *   - any other failed stage: red.
 * A truncated header, and a missing or malformed one (a contract violation), are red. The body is
 * read only for the message fallback and for detail.
 */
export const stageVerdicts = (ra: Rec, reply: { headers?: SnowplowReply['headers']; json: unknown }): { failures: string[]; byDesign: string[] } => {
  const outcomes = stageOutcomesOf(reply.headers)
  const messages = bodyStageMessages(ra, rec(reply.json)?.status)
  switch (outcomes.kind) {
    case 'missing':
      return { byDesign: [], failures: [`snowplow answered the inline resolve without ${STAGE_OUTCOMES} — a contract violation: its stage outcomes cannot be known`] }
    case 'invalid':
      return { byDesign: [], failures: [`snowplow's ${STAGE_OUTCOMES} is not the documented shape (${outcomes.why}): its stage outcomes cannot be known`] }
    case 'truncated':
      // `failed` is the number of ROWS the header would have carried, which snowplow sets to
      // len(out): every stage that did not succeed, NotRun ones included, plus the resolve-level
      // Aborted row. So it is "did not succeed", not "failed" — an aborted resolve, where nothing
      // ran at all, can arrive here too once its stage list is long enough to breach 4 KiB.
      return { byDesign: [], failures: [`${Number.isNaN(outcomes.failed) ? 'some' : outcomes.failed} stage(s) did not succeed; ${STAGE_OUTCOMES} was truncated, so which ones — and whether any stage ran at all — cannot be told`] }
    default:
  }
  // An ABORTED resolve (snowplow#904 review F3) ran no stage at all: its graph could not be
  // ordered. Every row after it is a NotRun that the abort explains, so attributing them one by
  // one to a positional `stopper` would print a line per stage, each naming no cause. One red
  // line that says the resolve never started is the honest report.
  const aborted = outcomes.stages.find((o) => o.name === '' && o.reason === STAGE_ABORTED_REASON)
  if (aborted) {
    const declared = outcomes.stages.filter((o) => o.name !== '').map((o) => o.name)
    const never = declared.length === 0 ? '' : `; its declared stage(s) never ran: ${declared.join(', ')}`
    return {
      byDesign: [],
      failures: [`snowplow aborted the resolve before running any stage — its dependsOn graph could not be ordered (a stage naming a dependency that does not exist, or a cycle)${never}`],
    }
  }
  const failures: string[] = []
  const byDesign: string[] = []
  // The draft's own declaration: a stage its author marked continueOnError may fail.
  const tolerant = new Set((Array.isArray(rec(ra.spec)?.api) ? rec(ra.spec)?.api as unknown[] : [])
    .map((a) => rec(a) ?? {}).filter((api) => api.continueOnError === true).map((api) => str(api.name))
    .filter((n): n is string => n !== null))
  /** The cause of the latest stop: the nearest earlier failed stage, and whether it was a note. */
  let stopper: { name: string; reason: string; note: string | null } | null = null
  /**
   * Every non-succeeded stage already judged, by NAME: the note phrase when it was a note,
   * null when it was red. Skipped reads its cause from here.
   *
   * NotRun has to guess its cause by position (`stopper`) because snowplow does not say which
   * stage truncated the resolve. Skipped does say — `dependsOn` names it — so it must not
   * guess: a chain A fails -> B skipped -> C skipped resolves C through B through A, which
   * positional attribution would get wrong the moment an unrelated failure sits between them.
   * The header is in topological order and lists only stages that did NOT succeed, so a named
   * dependency has always been judged by the time its dependent is reached.
   */
  const judged = new Map<string, string | null>()
  for (const stage of outcomes.stages.filter((o) => !o.ok)) {
    const reason = stage.reason ?? ''
    const detail = detailFor(messages, stage.name)
    const suffix = detail ? ` — ${detail}` : ''
    if (!STAGE_REASONS.has(reason)) {
      failures.push(`stage ${stage.name} failed with an unknown reason ${JSON.stringify(stage.reason ?? null)} — not one of snowplow's codes${suffix}`)
      stopper = { name: stage.name, note: null, reason }
      judged.set(stage.name, null)
      continue
    }
    if (reason === STAGE_NOT_RUN_REASON) {
      if (stopper?.note) {
        byDesign.push(`stage ${stage.name}: not run — the resolve stopped at stage ${stopper.name}, which ${stopper.note}; checked at the driven Preview`)
        judged.set(stage.name, `was not run after stage ${stopper.name}, which ${stopper.note}`)
      } else if (stopper) {
        failures.push(`stage ${stage.name}: not run — the resolve stopped at stage ${stopper.name} (${stopper.reason})`)
        judged.set(stage.name, null)
      } else {
        failures.push(`stage ${stage.name}: not run — the resolve stopped before it, at no failed stage the header names`)
        judged.set(stage.name, null)
      }
      continue
    }
    if (reason === STAGE_SKIPPED_REASON) {
      // snowplow#904: a write stage it did not dial because the stage it dependsOn did not
      // succeed. It inherits that stage's verdict — a note if the cause was tolerated, red if
      // not — because the skip is a CONSEQUENCE, never an independent failure. A skip is also
      // not a `stopper`: it does not truncate the resolve, so a later NotRun must not be
      // attributed to it.
      const dep = stage.dependsOn
      const depNote = dep === undefined ? undefined : judged.get(dep)
      if (dep === undefined) {
        failures.push(`stage ${stage.name}: not sent, but ${STAGE_OUTCOMES} does not name the stage it depends on${suffix}`)
        judged.set(stage.name, null)
      } else if (depNote === undefined) {
        failures.push(`stage ${stage.name}: not sent because stage ${dep} did not succeed — which ${STAGE_OUTCOMES} does not list${suffix}`)
        judged.set(stage.name, null)
      } else if (depNote === null) {
        failures.push(`stage ${stage.name}: not sent because the stage it depends on, ${dep}, failed${suffix}`)
        judged.set(stage.name, null)
      } else {
        byDesign.push(`stage ${stage.name}: not sent — it depends on stage ${dep}, which ${depNote}; checked at the driven Preview${suffix}`)
        judged.set(stage.name, `was not sent because stage ${dep} ${depNote}`)
      }
      continue
    }
    if (reason === STAGE_NOT_EXECUTED_REASON || (detail !== undefined && STAGE_NOT_EXECUTED_MESSAGE.test(detail))) {
      byDesign.push(`stage ${stage.name}: not executed by design (a write-verb stage): checked at the driven Preview${suffix}`)
      stopper = { name: stage.name, note: 'was not executed by design', reason }
      judged.set(stage.name, 'was not executed by design')
    } else if (tolerant.has(stage.name)) {
      byDesign.push(`stage ${stage.name} failed (${reason}) — continueOnError, the page is expected to cope; checked at the driven Preview${suffix}`)
      stopper = { name: stage.name, note: 'is continueOnError', reason }
      judged.set(stage.name, 'is continueOnError')
    } else {
      failures.push(`stage ${stage.name} failed (${reason})${suffix}`)
      stopper = { name: stage.name, note: null, reason }
      judged.set(stage.name, null)
    }
  }
  return { byDesign, failures }
}

export const dataStep = async (drafts: readonly Rec[], ctx: GateContext): Promise<DataStepResult> => {
  // Keyed by RESTAction NAME: that is what a widget's spec.apiRef names (references.ts).
  const outputs = new Map<string, unknown>()
  if (!ctx.live) {
    return { outputs, step: step('data', [], ['DISABLED: offline run (--offline) — no data was resolved']) }
  }
  const restActions = drafts.map((cr, index) => ({ cr, index })).filter(({ cr }) => isRestAction(cr))
  if (restActions.length === 0) {
    return { outputs, step: step('data', [], ['no RESTAction in the draft — nothing to resolve']) }
  }
  const { snowplow } = ctx
  if (!snowplow) {
    return { outputs, step: step('data', [`notChecked: ${ctx.snowplowMissing ?? 'no snowplow'} — the gate resolves data only through snowplow, as the caller`]) }
  }
  const capabilities = await snowplow.capabilities(PER_CALL_MS)
  if (!capabilities.ok) {
    return { outputs, step: step('data', [`notChecked: ${capabilities.reason}`]) }
  }
  if (!capabilities.offered.has(CAPABILITY_RESOLVE)) {
    return { outputs, step: step('data', [`live verdict missing: this snowplow cannot yet resolve a RESTAction without storing it (${CAPABILITY_RESOLVE}; snowplow 1.12.36, docs/snowplow-contract.md) — no RESTAction in the draft was run`]) }
  }

  const problems: string[] = []
  const notes = ['resolved by snowplow as the caller, nothing stored (POST /call/read, the draft in the body); each RESTAction on its own']
  const stepDeadline = Math.min(ctx.deadline, Date.now() + STEP_BUDGET_MS)
  for (const { cr, index } of restActions) {
    const label = labelOf(cr, index)
    const remaining = Math.min(PER_CALL_MS, stepDeadline - Date.now())
    if (remaining < 1_000) {
      problems.push(`${label}: notChecked: the step's time budget ran out`)
      continue
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- one RESTAction at a time, inside the budget
      const reply = await snowplow.resolveInline(cr, remaining)
      if (reply.status !== 200) {
        const message = String(rec(reply.json)?.message ?? reply.body).slice(0, 300)
        problems.push(`${label}: ${reply.status === 401 || reply.status >= 500 ? 'notChecked: ' : ''}snowplow could not resolve it (${reply.status}): ${message}`)
        continue
      }
      const stages = stageVerdicts(cr, reply)
      problems.push(...stages.failures.map((m) => `${label}: ${m}`))
      notes.push(...stages.byDesign.map((m) => `${label}: ${m}`))
      const { dropped, value: output } = withoutSecrets(rec(reply.json)?.status)
      if (dropped > 0) {
        notes.push(`${label}: ${dropped} Secret-shaped object(s) dropped from the output before it reached this envelope`)
      }
      notes.push(`${label}: yields ${describe(output)}; sample ${sample(output)}`)
      // The SANITISED output — the shape step must never see what this step dropped.
      const raName = nameOf(cr)
      if (raName) {
        outputs.set(raName, output)
      }
    } catch (error) {
      problems.push(`${label}: ${error instanceof HttpError ? `notChecked: snowplow could not be reached (${error.message})` : (error as Error).message}`)
    }
  }
  return { outputs, step: step('data', problems, notes) }
}
