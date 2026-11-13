/**
 * The request Content-Type of a /call write — ONE place, shared by the single-op path (`runRest`)
 * and the set fabric (`runRestSet`, which the fan-out and multi-op paths ride).
 *
 * WHY IT MUST BE SET. A string body with no Content-Type is sent by `fetch` as
 * `text/plain;charset=UTF-8` (Fetch spec, body extraction). snowplow forwards the request's
 * Content-Type to the apiserver and defaults only an EMPTY one, so a write without a declared type
 * reaches the apiserver as text/plain and is refused with 415.
 *
 * A leaf module (no imports from the hooks) so neither caller widens the runRestSet ⇄
 * useHandleActions cycle.
 */

/** The verbs that carry a body. GET and DELETE never do, so they never get a Content-Type. */
export type BodyVerb = 'POST' | 'PUT' | 'PATCH'

/** True for the verbs whose request carries a body. */
export const carriesBody = (verb: string): verb is BodyVerb => verb === 'POST' || verb === 'PUT' || verb === 'PATCH'

/** The default Content-Type of a write: merge-patch for PATCH (apiserver semantics), JSON otherwise. */
export const contentTypeOf = (verb: BodyVerb): string =>
  (verb === 'PATCH' ? 'application/merge-patch+json' : 'application/json')

/** True iff `headers` already declares a Content-Type (header names are case-insensitive). */
export const declaresContentType = (headers: Record<string, string>): boolean =>
  Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')
