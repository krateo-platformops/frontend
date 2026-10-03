/**
 * Step 5, data (#442 D10 c): each RESTAction in the draft is resolved BY SNOWPLOW, AS THE CALLER,
 * without being stored (snowplow.ts resolveInline, POST /resolve?dryRun=All —
 * docs/snowplow-contract.md), so the agent sees what the page will actually show before it hands
 * the draft back. The gate evaluates nothing itself: what a RESTAction yields is snowplow's to say.
 *
 * Until snowplow advertises the inline resolve, the step says "live verdict missing" and is RED
 * (#442 D9) whenever the draft carries a RESTAction. A draft with none has nothing to resolve.
 *
 * What reaches the agent is a count and a short sample of the output. A RESTAction that could read
 * Secrets never gets here: builder-lint refuses it first (secrets.ts).
 */
import { step, type StepResult } from '../envelope'
import { HttpError } from '../http'
import type { GateContext } from '../plan'
import { CAPABILITY_RESOLVE } from '../snowplow'
import { isRestAction, labelOf, rec, type Rec } from './drafts'

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
    return step('data', [`live verdict missing: this snowplow cannot yet resolve a RESTAction without storing it (${CAPABILITY_RESOLVE}, docs/snowplow-contract.md) — no RESTAction in the draft was run`])
  }

  const problems: string[] = []
  const notes = ['resolved by snowplow as the caller, nothing stored (POST /resolve?dryRun=All)']
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
      const output = rec(reply.json)?.status
      notes.push(`${label}: yields ${describe(output)}; sample ${sample(output)}`)
    } catch (error) {
      problems.push(`${label}: ${error instanceof HttpError ? `notChecked: snowplow could not be reached (${error.message})` : (error as Error).message}`)
    }
  }
  return step('data', problems, notes)
}
