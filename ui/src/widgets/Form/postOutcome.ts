/**
 * What a Form's allow-listed POST answered, and which of the CR's entries that answer selects —
 * shared by `fieldChecks` (fieldCheck.tsx) and `submitPost` (Form.tsx). Pure, except `sendPost`.
 *
 * MATCHING. An entry's `when` is `{status?, bodyField?, equals?}`; every condition it gives must
 * hold, and a condition it leaves out matches anything. Entries are tried in the CR's order and the
 * first match wins, so precedence is the author's order (an entry with no `when` catches everything
 * after it). `bodyField` matches only a JSON body where that dotted field is a string in `equals`.
 * A request that got no answer (a network error, the client timeout) matches NO entry: it is the
 * CR's `otherwise`. One that was aborted (superseded, or the form went away) has no outcome at all.
 *
 * INTERPOLATION. A CR string may name `{value}` (the checked value), `{body.<dotted>}` (a string or
 * number in the response) and `{retryAfter}` ("30 seconds", "2 minutes"). The result is a plain
 * string, rendered as text: nothing from a response is ever markup. A token with no value is empty.
 */
import type { AllowlistedPost } from '../../transport/allowlistedPost'
import { PublicPostRefused } from '../../transport/allowlistedPost'

export interface PostWhen {
  status?: number[]
  bodyField?: string
  equals?: string[]
}

/** An HTTP answer, read once. `body` is the parsed JSON, or undefined when it was not JSON. */
export interface PostAnswer {
  kind: 'answer'
  status: number
  body: unknown
  /** Retry-After in whole seconds, when it is a positive integer; else undefined. */
  retryAfter?: number
}

export type PostOutcome =
  | PostAnswer
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'aborted' }
  | { kind: 'refused'; reason: string }

/** The client timeout when the CR names none. */
export const DEFAULT_TIMEOUT_MS = 10_000

/** A dotted path into a JSON value; undefined where it leads nowhere. */
export const valueAt = (body: unknown, dotted: string): unknown =>
  dotted.split('.').reduce<unknown>((at, key) => (at && typeof at === 'object' && !Array.isArray(at) ? (at as Record<string, unknown>)[key] : undefined), body)

/**
 * Retry-After as whole seconds. Only the delay-seconds form, and only above zero: an HTTP-date, a
 * fraction, zero or garbage is "no Retry-After", and the message without a wait is shown.
 */
export const parseRetryAfter = (header: string | null | undefined): number | undefined => {
  const text = header?.trim()
  if (!text || !/^\d+$/.test(text)) { return undefined }
  const seconds = Number(text)
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined
}

/** "1 second", "30 seconds", "60 seconds"; above a minute, whole minutes rounded UP ("2 minutes"). */
export const formatRetryAfter = (seconds: number): string => {
  if (seconds <= 60) { return seconds === 1 ? '1 second' : `${seconds} seconds` }
  const minutes = Math.ceil(seconds / 60)
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

export interface InterpolationVars {
  value?: unknown
  body?: unknown
  retryAfter?: number
}

const scalarText = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' ? String(value) : '')

/** The CR string with its `{value}`, `{body.x}` and `{retryAfter}` tokens filled in, as plain text. */
export const interpolate = (template: string, vars: InterpolationVars): string =>
  template.replace(/\{(value|retryAfter|body\.[A-Za-z0-9_.-]+)\}/g, (_token, name: string) => {
    if (name === 'value') { return scalarText(vars.value) }
    if (name === 'retryAfter') { return vars.retryAfter === undefined ? '' : formatRetryAfter(vars.retryAfter) }
    return scalarText(valueAt(vars.body, name.slice('body.'.length)))
  })

/** Whether one entry's `when` holds for an answer. */
export const whenHolds = (when: PostWhen | undefined, answer: PostAnswer): boolean => {
  if (!when) { return true }
  if (Array.isArray(when.status) && when.status.length && !when.status.includes(answer.status)) { return false }
  if (typeof when.bodyField === 'string' && when.bodyField) {
    const found = valueAt(answer.body, when.bodyField)
    if (typeof found !== 'string') { return false }
    if (Array.isArray(when.equals) && !when.equals.includes(found)) { return false }
  } else if (Array.isArray(when.equals) && when.equals.length) {
    // `equals` without a field to compare has nothing to hold for.
    return false
  }
  return true
}

/** The first entry whose `when` holds, in the CR's order; undefined for no match or no answer. */
export const firstMatch = <Entry extends { when?: PostWhen }>(entries: readonly Entry[] | undefined, outcome: PostOutcome): Entry | undefined => {
  if (outcome.kind !== 'answer' || !entries) { return undefined }
  return entries.find((entry) => whenHolds(entry.when, outcome))
}

/** Read a Response once: its status, its JSON body (if any) and its Retry-After. */
export const readAnswer = async (response: Response): Promise<PostAnswer> => {
  let body: unknown
  try {
    const text = await response.text()
    body = text ? JSON.parse(text) as unknown : undefined
  } catch {
    body = undefined
  }
  return { body, kind: 'answer', retryAfter: parseRetryAfter(response.headers.get('Retry-After')), status: response.status }
}

/**
 * Send through the transport's allow-listed `post`, bounded by a client timeout, cancellable by
 * `signal`. Never rejects: every way it can end is an outcome. Aborting `signal` (a newer value, the
 * form unmounting) is `aborted`, which shows nothing; the timeout is `timeout`, which is the CR's
 * `otherwise`.
 */
export const sendPost = async (post: AllowlistedPost | undefined, path: string, body: unknown, { signal, timeoutMs }: { signal?: AbortSignal; timeoutMs?: number }): Promise<PostOutcome> => {
  if (!post) { return { kind: 'refused', reason: 'this page has no allow-listed POST' } }
  if (signal?.aborted) { return { kind: 'aborted' } }
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => { controller.abort() }
  signal?.addEventListener('abort', onAbort)
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const response = await post(path, body, { signal: controller.signal })
    return await readAnswer(response)
  } catch (error) {
    if (error instanceof PublicPostRefused) { return { kind: 'refused', reason: error.message } }
    if (timedOut) { return { kind: 'timeout' } }
    if (controller.signal.aborted) { return { kind: 'aborted' } }
    return { kind: 'network' }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** The body extras a CR maps (`{bodyKey: extraKey}`), from the page's fragment extras; a key the page was not opened with is left out. */
export const pickBodyExtras = (map: Record<string, string> | undefined, extras: Readonly<Record<string, string>>): Record<string, string> => {
  const picked: Record<string, string> = {}
  for (const [bodyKey, extraKey] of Object.entries(map ?? {})) {
    const value = extras[extraKey]
    if (typeof value === 'string') { picked[bodyKey] = value }
  }
  return picked
}
