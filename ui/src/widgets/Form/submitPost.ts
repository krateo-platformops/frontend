import { resolveResult, type ResultSpec } from './FormResult'
import { firstMatch, interpolate, type PostOutcome, type PostWhen, valueAt } from './postOutcome'

/**
 * A Form that submits by POSTing JSON to an allow-listed same-origin path (`submitPost`) instead of
 * a snowplow /call write, and maps each response to what the person sees:
 *
 * - `result`: an antd Result replaces the form (FormResult.tsx);
 * - `fieldErrors`: errors on the fields a response names (`names`, and/or the strings of the body's
 *   `namesFrom` array). A field's message is `ruleMessages[body[ruleFrom]]`, else
 *   `fieldMessages[name]`, else `message`, else "Check this field.". Names the form does not have
 *   are ignored; if none is left, `message` shows as an error Alert instead;
 * - `alert`: an inline antd Alert directly above the action bar, never a toast. With a positive
 *   integer Retry-After, `retryAfterDescription` replaces `description`, once, with no countdown.
 *
 * Responses are matched as postOutcome.ts says (first in the CR's order wins); no answer at all
 * (a network error, the client timeout) is `otherwise`, and with no `otherwise` an error Alert.
 */
export interface SubmitAlertSpec {
  type: 'warning' | 'error' | 'info'
  title: string
  description?: string
  retryAfterDescription?: string
}

export interface SubmitFieldErrorsSpec {
  names?: string[]
  namesFrom?: string
  ruleFrom?: string
  ruleMessages?: Record<string, string>
  fieldMessages?: Record<string, string>
  message?: string
}

export interface SubmitResponseSpec {
  when?: PostWhen
  result?: ResultSpec
  fieldErrors?: SubmitFieldErrorsSpec
  alert?: SubmitAlertSpec
}

export interface SubmitPostSpec {
  path: string
  bodyExtras?: Record<string, string>
  timeoutMs?: number
  responses?: SubmitResponseSpec[]
  otherwise?: Omit<SubmitResponseSpec, 'when'>
}

export interface ShownAlert {
  type: 'warning' | 'error' | 'info'
  title: string
  description?: string
}

export type SubmitEffect =
  | { kind: 'result'; result: ResultSpec }
  | { kind: 'fieldErrors'; errors: Array<{ name: string; message: string }>; fallback: ShownAlert }
  | { kind: 'alert'; alert: ShownAlert }
  | { kind: 'none' }

export const DEFAULT_SUBMIT_ALERT: ShownAlert = { description: 'Try again later.', title: "We couldn't send this form.", type: 'error' }

/** What the person is told when the CR's path is refused, or the page has no allow-listed post. */
export const NOT_CONFIGURED_ALERT: ShownAlert = { description: 'Ask whoever maintains this page.', title: 'This form is not configured to submit.', type: 'error' }

const DEFAULT_FIELD_MESSAGE = 'Check this field.'

/**
 * Why a Form's way to submit is unusable, or undefined when it has exactly one: `submitPost`, or
 * `actions` with `submitActionId`. The CRD requires neither (a `submitPost` form has no actions),
 * so the rule lives here and the widget says what is wrong instead of rendering a dead button.
 */
export const submitModeProblem = (widgetData: { actions?: unknown; submitActionId?: unknown; submitPost?: unknown }): string | undefined => {
  const posts = widgetData.submitPost !== undefined && widgetData.submitPost !== null
  const hasActions = widgetData.actions !== undefined && widgetData.actions !== null
  const hasActionId = widgetData.submitActionId !== undefined && widgetData.submitActionId !== null
  if (posts && (hasActions || hasActionId)) {
    return 'The Form widget has two ways to submit — `submitPost` and `actions`/`submitActionId`. Keep one of them.'
  }
  if (posts) { return undefined }
  if (hasActions && hasActionId) { return undefined }
  if (hasActions) { return 'The Form widget has `actions` but no `submitActionId` naming the one to submit with — or use `submitPost`.' }
  if (hasActionId) { return 'The Form widget has a `submitActionId` but no `actions` — or use `submitPost`.' }
  return 'The Form widget has no way to submit — set `submitPost`, or `actions` with `submitActionId`.'
}

const ALERT_TYPES = new Set(['warning', 'error', 'info'])

/** What one response means for the form, before the form checks which named fields it has. */
export const mapSubmitOutcome = (spec: SubmitPostSpec, outcome: PostOutcome): SubmitEffect => {
  if (outcome.kind === 'aborted') { return { kind: 'none' } }
  if (outcome.kind === 'refused') {
    console.error(`The form cannot be submitted: ${outcome.reason}`)
    return { alert: NOT_CONFIGURED_ALERT, kind: 'alert' }
  }
  const entry = firstMatch(spec.responses, outcome) ?? spec.otherwise
  const answered = outcome.kind === 'answer' ? outcome : undefined
  const vars = { body: answered?.body, retryAfter: answered?.retryAfter }
  if (entry?.result) { return { kind: 'result', result: resolveResult(entry.result, vars) } }
  if (entry?.fieldErrors) {
    const spec = entry.fieldErrors
    const fromBody = spec.namesFrom ? valueAt(answered?.body, spec.namesFrom) : undefined
    const names = [...(spec.names ?? []), ...(Array.isArray(fromBody) ? fromBody.filter((name): name is string => typeof name === 'string') : [])]
    const rule = spec.ruleFrom ? valueAt(answered?.body, spec.ruleFrom) : undefined
    const ruleMessage = typeof rule === 'string' ? spec.ruleMessages?.[rule] : undefined
    const errors = [...new Set(names)].map((name) => ({
      message: interpolate(ruleMessage ?? spec.fieldMessages?.[name] ?? spec.message ?? DEFAULT_FIELD_MESSAGE, vars),
      name,
    }))
    return { errors, fallback: { title: interpolate(spec.message ?? DEFAULT_FIELD_MESSAGE, vars), type: 'error' }, kind: 'fieldErrors' }
  }
  if (entry?.alert) {
    const { alert } = entry
    const useRetryAfter = answered?.retryAfter !== undefined && !!alert.retryAfterDescription
    const description = useRetryAfter ? alert.retryAfterDescription : alert.description
    return {
      alert: {
        description: description === undefined ? undefined : interpolate(description, vars),
        title: interpolate(alert.title, vars),
        type: ALERT_TYPES.has(alert.type) ? alert.type : 'error',
      },
      kind: 'alert',
    }
  }
  return { alert: DEFAULT_SUBMIT_ALERT, kind: 'alert' }
}
