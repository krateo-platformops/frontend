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
 *   - per-stage errors, from each stage's errorKey (default "error") in the output, where snowplow
 *     accumulates them. A write-verb stage snowplow did not run by design carries
 *     STAGE_NOT_EXECUTED_REASON and is a NOTE ("checked at the driven Preview") — only with that
 *     code; any other stage error is red, unless every stage writing that key is continueOnError;
 *   - the output itself, as a count and a short sample, with anything shaped like a Kubernetes
 *     Secret DROPPED first and the drop noted. builder-lint already refuses a RESTAction that
 *     could read Secrets (secrets.ts); this is the second layer, because snowplow reads Secret
 *     paths live as the caller and does not refuse them.
 */
import { step, type StepResult } from '../envelope'
import { HttpError } from '../http'
import type { GateContext } from '../plan'
import { CAPABILITY_RESOLVE, STAGE_NOT_EXECUTED_REASON } from '../snowplow'
import { isRestAction, labelOf, rec, type Rec, str } from './drafts'

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
  return { value: walk(value), dropped }
}

/** The per-stage errors in a resolve's output, split into by-design notes and real problems. */
const stageErrors = (ra: Rec, output: unknown): { byDesign: string[]; failures: string[]; tolerated: string[] } => {
  const result = { byDesign: [] as string[], failures: [] as string[], tolerated: [] as string[] }
  const out = rec(output)
  const apis = (Array.isArray(rec(ra.spec)?.api) ? rec(ra.spec)?.api as unknown[] : []).map((a) => rec(a) ?? {})
  if (!out) {
    return result
  }
  const keys = new Map<string, boolean>()
  for (const api of apis) {
    const key = str(api.errorKey) ?? 'error'
    // A key is tolerated only when EVERY stage writing it is continueOnError.
    keys.set(key, (keys.get(key) ?? true) && api.continueOnError === true)
  }
  for (const [key, tolerated] of keys) {
    const entries = out[key]
    for (const entry of Array.isArray(entries) ? entries : entries === undefined ? [] : [entries]) {
      const status = rec(entry)
      const message = String(status?.message ?? (typeof entry === 'string' ? entry : JSON.stringify(entry))).slice(0, 300)
      if (status?.reason === STAGE_NOT_EXECUTED_REASON) {
        result.byDesign.push(`not executed by design (a write-verb stage): checked at the driven Preview — ${message}`)
      } else if (tolerated) {
        result.tolerated.push(message)
      } else {
        result.failures.push(message)
      }
    }
  }
  return result
}

export const dataStep = async (drafts: readonly Rec[], ctx: GateContext): Promise<StepResult> => {
  if (!ctx.live) {
    return step('data', [], ['DISABLED: offline run (--offline) — no data was resolved'])
  }
  const restActions = drafts.map((cr, index) => ({ cr, index })).filter(({ cr }) => isRestAction(cr))
  if (restActions.length === 0) {
    return step('data', [], ['no RESTAction in the draft — nothing to resolve'])
  }
  const snowplow = ctx.snowplow
  if (!snowplow) {
    return step('data', [`notChecked: ${ctx.snowplowMissing ?? 'no snowplow'} — the gate resolves data only through snowplow, as the caller`])
  }
  const capabilities = await snowplow.capabilities(PER_CALL_MS)
  if (!capabilities.ok) {
    return step('data', [`notChecked: ${capabilities.reason}`])
  }
  if (!capabilities.offered.has(CAPABILITY_RESOLVE)) {
    return step('data', [`live verdict missing: this snowplow cannot yet resolve a RESTAction without storing it (${CAPABILITY_RESOLVE}; snowplow 1.12.36, docs/snowplow-contract.md) — no RESTAction in the draft was run`])
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
      const errors = stageErrors(cr, rec(reply.json)?.status)
      problems.push(...errors.failures.map((m) => `${label}: stage error: ${m}`))
      notes.push(...errors.byDesign.map((m) => `${label}: ${m}`))
      notes.push(...errors.tolerated.map((m) => `${label}: stage error tolerated by continueOnError: ${m}`))
      const { value: output, dropped } = withoutSecrets(rec(reply.json)?.status)
      if (dropped > 0) {
        notes.push(`${label}: ${dropped} Secret-shaped object(s) dropped from the output before it reached this envelope`)
      }
      notes.push(`${label}: yields ${describe(output)}; sample ${sample(output)}`)
    } catch (error) {
      problems.push(`${label}: ${error instanceof HttpError ? `notChecked: snowplow could not be reached (${error.message})` : (error as Error).message}`)
    }
  }
  return step('data', problems, notes)
}
