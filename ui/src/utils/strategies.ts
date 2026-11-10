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

/**
 * The URL a credential (basic or ldap) sign-in is sent to, built from the `/strategies` entry the
 * person chose — or why there is none.
 *
 * LDAP NEEDS ITS CONFIG NAME. authn's `/strategies` describes an LDAP method as `path: "/ldap/login"`
 * with the LDAPConfig's name in a SEPARATE `name` field (authn strategies.go, `forLDAP`), and
 * `/ldap/login` refuses a request without `?name=` with 400 MissingConfigName (ldap/login.go:97-99
 * in 0.40.0). Both credential surfaces — the login page and the session-resume modal — sent
 * `${base}${path}` and nothing else, so every LDAP sign-in from the portal was refused before authn
 * looked at the credentials. It went unseen because the install it was tested on offers basic only.
 *
 * The name is added with URLSearchParams, so it is encoded, and a query `path` already carries is
 * kept rather than clobbered by a second `?`.
 *
 * Basic takes no name — `/basic/login` has no config to choose — and its URL is left exactly as it
 * was.
 */
export type CredentialLoginUrl =
  | { ok: true; url: string }
  | { ok: false; reason: 'LdapStrategyWithoutName' | 'StrategyWithoutPath' }

export const credentialLoginUrlOf = (baseUrl: string, method: AuthModeType): CredentialLoginUrl => {
  if (!method.path) {
    return { ok: false, reason: 'StrategyWithoutPath' }
  }
  if (method.kind !== 'ldap') {
    return { ok: true, url: `${baseUrl}${method.path}` }
  }
  if (!method.name) {
    return { ok: false, reason: 'LdapStrategyWithoutName' }
  }
  const url = new URL(`${baseUrl}${method.path}`, window.location.href)
  url.searchParams.set('name', method.name)
  return { ok: true, url: url.toString() }
}
