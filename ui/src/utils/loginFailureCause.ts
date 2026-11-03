/**
 * Why a login was refused, and whether the person typing can do anything about it.
 *
 * WHY THIS EXISTS. `Login.tsx` rendered every failure as `Login error (500: Internal Server
 * Error)` — the raw status and nothing else — so a misconfigured cluster and a mistyped password
 * looked identical to whoever was typing. Someone whose LDAP server is down was told to check their
 * password. That is the same defect `authFailureCause.ts` exists to fix for resource 401s; the login
 * form never got the same treatment.
 *
 * authn 0.32.0 makes the distinction available: a refusal of the CALLER is 401/403, and authn's own
 * inability to check is 5xx, with the specific cause in `details.causes[0].reason`. Before that
 * release authn answered 403 for its own failures too, so no classification was possible.
 *
 * THE CONTRACT THIS RELIES ON, from authn's docs/api.md: causes are only ever ADDED, never renamed,
 * and a cause never changes its code. That is what makes the fall-through below safe — an unknown
 * cause is a cause newer than this file, not a broken one, so it degrades to the status-code
 * reading rather than to "unknown error".
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not distinguish an unknown user from a wrong
 * password. authn returns one fixed `InvalidCredentials` message for both, on purpose, so the form
 * cannot be used to enumerate usernames. Nothing here should undo that.
 */

/** The failure body authn sends: a Kubernetes `Status`. Only the fields this reads. */
export interface LoginFailureBody {
  code?: unknown
  details?: {
    causes?: { message?: unknown; reason?: unknown }[]
  }
  message?: unknown
}

/**
 * What the person should do, which is the only distinction the form needs to draw.
 *
 * `retype` and `escalate` are deliberately the whole set. A login form has exactly two useful
 * outcomes — try again yourself, or this is not yours to fix — and inventing a third would put a
 * decision in front of someone who cannot act on it.
 */
export type LoginFailureAction = 'escalate' | 'retype'

export interface LoginFailureCause {
  /** What to do about it. */
  action: LoginFailureAction
  /** authn's cause, when it sent one. Null when the body carried none — see `causeOf`. */
  reason: string | null
  /** What to show the person. Never authn's own `message`: see below. */
  text: string
}

/**
 * The causes authn documents for the login routes, as of 0.32.0.
 *
 * Grouped by what the person can do, NOT by status code, because that is the only question the
 * form has to answer. The codes are recorded in the comments so a reader can line this up against
 * authn's docs without going to look.
 */
/*
 * 403 InvalidCredentials — wrong password OR unknown user, one fixed message for both.
 * 401 MissingCredentials — no Authorization header. The form always sends one, so this should be
 *     unreachable from here; it is listed because reachable-by-another-caller is not the same as
 *     impossible, and a 401 arriving here must not read as a server fault.
 */
const RETYPE_REASONS = new Set([
  'InvalidCredentials',
  'MissingCredentials',
])

/*
 * All of authn's own failures. Codes, for lining up against authn's docs/api.md:
 *   500  IssuanceFailed           could not mint the token
 *   500  LDAPBindFailed           bind rejected — authn's OWN service account, not the person's
 *   500  LDAPConfigLookupFailed   could not read the LDAPConfig
 *   404  LDAPConfigNotFound       the named LDAPConfig does not exist. NOT the person's fault: the
 *                                 method list the form offers comes from authn itself.
 *   500  LDAPSearchFailed         search errored
 *   500  LDAPUnavailable          the directory is unreachable
 *   500  PasswordLookupFailed     could not read the password key
 *   500  PasswordSecretMissing    the User's password Secret is absent
 *   500  UserLookupFailed         could not read the User
 */
const ESCALATE_REASONS = new Set([
  'IssuanceFailed',
  'LDAPBindFailed',
  'LDAPConfigLookupFailed',
  'LDAPConfigNotFound',
  'LDAPSearchFailed',
  'LDAPUnavailable',
  'PasswordLookupFailed',
  'PasswordSecretMissing',
  'UserLookupFailed',
])

/** The first cause's reason, or null when the body is not authn's shape or carries none. */
const causeOf = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) { return null }
  const causes = (body as LoginFailureBody).details?.causes
  if (!Array.isArray(causes) || causes.length === 0) { return null }
  const [first] = causes
  const { reason } = first
  return typeof reason === 'string' && reason !== '' ? reason : null
}

const REFUSED = 'Those credentials were not accepted. Check them and try again.'
const PLATFORM = 'Sign-in is unavailable: the platform could not check your credentials. '
  + 'This is not a problem with what you typed — retry shortly, and tell an administrator if it persists.'

/**
 * Classify a failed login.
 *
 * `status` leads and the cause refines it, rather than the other way round: the status code alone
 * already gives the user-facing split (per authn's own guidance), so an unrecognised cause never
 * costs us the right answer. A cause that contradicts its documented code — which the contract says
 * cannot happen — would be a bug in authn, and trusting the code is the safer failure.
 *
 * NOTE ON 300. LDAP's `AmbiguousUser` arrives as 300 with a body that says `"status":"Success"`,
 * which authn has on a follow-up list as a known quirk. It is classified by its CAUSE here and not
 * by its code, because a 3xx falling into the 5xx arm would tell someone to call an administrator
 * about a directory that holds two matching entries for them — true, but it reads as an outage.
 */
export const loginFailureCauseOf = (status: number, body: unknown): LoginFailureCause => {
  const reason = causeOf(body)

  if (reason !== null && RETYPE_REASONS.has(reason)) {
    return { action: 'retype', reason, text: REFUSED }
  }
  if (reason !== null && ESCALATE_REASONS.has(reason)) {
    return { action: 'escalate', reason, text: PLATFORM }
  }
  if (reason === 'AmbiguousUser') {
    return {
      action: 'escalate',
      reason,
      text: 'More than one directory entry matches that username, so sign-in cannot tell which is '
        + 'yours. An administrator needs to resolve the duplicate.',
    }
  }

  // Unknown or absent cause: fall through to the code, which authn guarantees carries the split.
  return status >= 500
    ? { action: 'escalate', reason, text: PLATFORM }
    : { action: 'retype', reason, text: REFUSED }
}
