/**
 * Read authn's `/strategies` — the sign-in methods both the login page and the oidc/oauth callback
 * offer — and fail in a way that can be classified.
 *
 * WHY THIS EXISTS. Login.tsx and Auth.tsx each read `/strategies` with `fetch(url).then(r => r.json())`
 * and nothing else, under the SAME react-query key. That had three faults:
 *   - a non-200 was never noticed: a gateway's 503 page parsed as "the list" when it happened to be
 *     JSON, and threw an unclassified parse error when it was not;
 *   - a 200 that was not a list (a base URL pointing at the wrong service) became `methods`, and the
 *     first `methods.find(...)` threw;
 *   - every one of these reached the page as an opaque error, shown as "Ops! Something didn't work"
 *     on the login page and as a generic subtitle on the callback.
 *
 * WHAT A FAILURE CAN MEAN. authn's own handler never fails: it answers 200 with whatever list it
 * could build and logs the rest (authn `internal/routes/auth/strategies/strategies.go`). So a
 * non-200 here is from something IN FRONT of authn — a gateway answering 502/503/504 while authn
 * restarts, or a 404 from a base URL that routes nowhere — and a rejected fetch is authn unreachable.
 * `strategiesFailureOf` in loginFailureCause.ts turns that into what the person should do.
 *
 * Both pages share the query key, so they must share this function: two query functions under one
 * key would serve whichever ran first to the other page.
 */
import type { AuthModeType } from '../pages/Login/Login.types'

/** Why `/strategies` could not be read. Only these three are distinguishable from the browser. */
export type StrategiesFailure =
  | { kind: 'unreachable' }
  | { kind: 'status'; status: number }
  | { kind: 'unusable' }

export class StrategiesError extends Error {
  readonly failure: StrategiesFailure

  constructor(failure: StrategiesFailure) {
    super(failure.kind === 'status' ? `/strategies answered ${failure.status}` : `/strategies ${failure.kind}`)
    this.name = 'StrategiesError'
    this.failure = failure
  }
}

export const fetchStrategies = async (url: string): Promise<AuthModeType[]> => {
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new StrategiesError({ kind: 'unreachable' })
  }
  if (!response.ok) {
    throw new StrategiesError({ kind: 'status', status: response.status })
  }
  const body: unknown = await response.json().catch(() => null)
  if (!Array.isArray(body)) {
    throw new StrategiesError({ kind: 'unusable' })
  }
  return body as AuthModeType[]
}

/** The failure a query error carries, or null for an error this module did not raise. */
export const strategiesFailureFrom = (error: unknown): StrategiesFailure | null => {
  return error instanceof StrategiesError ? error.failure : null
}
