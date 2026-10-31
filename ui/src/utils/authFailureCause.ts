/**
 * What a 401 actually means, and what the person can do about it.
 *
 * WHY THIS EXISTS (snowplow#1029). Every 401 used to mean one thing to the portal: the session is
 * gone, raise the resume modal, ask them to sign in again. With step-up authentication that is no
 * longer true, and the difference is not cosmetic — it decides whether the prompt we show them can
 * succeed at all.
 *
 * snowplow sends the discriminator in the Status body as `details.causes[0].reason`, NOT in a
 * header. That is deliberate and it is the only option that works: the portal's app-wide 401
 * handler (`useCatchError`) receives an error object with no `Response` on it, so a
 * `WWW-Authenticate` header is structurally invisible at the very place most 401s are handled.
 * snowplow also sends the bare RFC 9470 header, but nothing here depends on it.
 *
 * THE THREE OUTCOMES, and why two is the wrong number. Of the reasons on the wire, two are not
 * fixable by the person in front of the screen:
 *
 *   - `StepUpNotEnabled`   — step-up is not configured on this cluster
 *   - `StepUpMisconfigured` — it is configured wrongly
 *
 * A resource needs an elevated credential that the cluster cannot issue. Treating those as "step
 * up again" shows a prompt that CANNOT succeed: the person re-authenticates, gets the same 401,
 * and loops, while the actual fault — a cluster setting — is reported to nobody. So a
 * configuration fault gets an honest dead end that names it, instead of an action that cannot work.
 */

/** The reasons snowplow and authn put in `details.causes[0].reason` (snowplow#1029). */
export const AUTH_FAILURE_REASONS = {
  /** authn: the credential's assurance level is below what the resource requires. */
  insufficientAssurance: 'InsufficientAssurance',
  /** authn: the token could not be issued. A server fault, not the person's and not a setting. */
  issuanceFailed: 'IssuanceFailed',
  /** snowplow: the session credential itself is absent — the ordinary expired-session 401. */
  sessionCredentialMissing: 'SessionCredentialMissing',
  /** authn: authentication is too old for the resource's freshness requirement. */
  staleAuthentication: 'StaleAuthentication',
  /** authn: step-up is configured, but wrongly. NOT user-fixable. */
  stepUpMisconfigured: 'StepUpMisconfigured',
  /** authn: step-up is not enabled on this cluster. NOT user-fixable. */
  stepUpNotEnabled: 'StepUpNotEnabled',
  /** snowplow: a loa:2 token was required and the step-up credential is missing. */
  stepUpRequired: 'StepUpRequired',
} as const

/**
 * What the portal should DO. Three outcomes, not three-plus-one-per-reason: the UI branches on
 * the action available to the person, and the reason is carried alongside for the message.
 */
export type AuthFailureAction =
  /** The cluster cannot satisfy the requirement. Nothing the person does will help. */
  | 'configuration-fault'
  /** The session is gone or unusable. Sign in again. */
  | 'reauthenticate'
  /** Issuing the credential failed server-side. Retrying may work; it is not a setting. */
  | 'server-fault'
  /** The session is valid but not elevated enough. Step up. */
  | 'step-up'

export interface AuthFailureCause {
  action: AuthFailureAction
  /** The raw reason, for the message and for support to quote. `null` when none was sent. */
  reason: string | null
}

const BY_REASON: Record<string, AuthFailureAction> = {
  [AUTH_FAILURE_REASONS.insufficientAssurance]: 'step-up',
  // Distinct from a configuration fault: the cluster IS set up, and issuance failed anyway. Saying
  // "ask an administrator to configure step-up" would send them to fix something already correct;
  // saying "sign in again" would hide a server fault as though it were their session.
  [AUTH_FAILURE_REASONS.issuanceFailed]: 'server-fault',
  [AUTH_FAILURE_REASONS.sessionCredentialMissing]: 'reauthenticate',
  // Stale authentication is fixed by authenticating again, which is the same gesture as a
  // step-up prompt from the person's side, but the honest word for it is re-authenticate.
  [AUTH_FAILURE_REASONS.staleAuthentication]: 'reauthenticate',
  [AUTH_FAILURE_REASONS.stepUpMisconfigured]: 'configuration-fault',
  [AUTH_FAILURE_REASONS.stepUpNotEnabled]: 'configuration-fault',
  [AUTH_FAILURE_REASONS.stepUpRequired]: 'step-up',
}

/** The 401 body shape this reads. Only the fields it needs; everything else is ignored. */
export interface AuthFailureBody {
  details?: {
    causes?: { reason?: unknown }[]
  }
}

/**
 * The two reasons whose meaning changes at the step-up exchange.
 *
 * `InsufficientAssurance` stays `step-up` here on purpose: it is offered ONCE. Deciding that a
 * second identical refusal is a dead end needs attempt state, which does not belong in a pure
 * classifier — the step-up flow owns that, and `accountCannotReachLevel` below is what it shows.
 */
const atStepUpExchange = (reason: string | null, base: AuthFailureAction): AuthFailureAction => {
  if (reason === AUTH_FAILURE_REASONS.staleAuthentication) {
    // The session credential is fine; the IdP's auth_time was older than max_age. Redo the
    // step-up redirect — `stepUpAuthCodeURL` carries max_age, so the IdP re-authenticates.
    return 'step-up'
  }
  return base
}

/**
 * WHERE the failure came from. The SAME reason means different things at the two origins, so this
 * is a required argument rather than an option with a default — authn's correction on authn#58,
 * and a context-free classifier would get both of the following wrong:
 *
 *   - `StaleAuthentication` on a resource 401 means the session is old: sign in again. From the
 *     step-up exchange it means the IdP returned an `auth_time` older than `max_age`, and the
 *     session credential is FINE — the fix is to redo the step-up redirect, not to sign in.
 *   - `InsufficientAssurance` on a resource 401 means no elevated credential was presented, so a
 *     step-up prompt is right. From the step-up exchange it means the IdP completed and still did
 *     not reach the level (no OTP enrolled, or the realm's flow lacks the LoA) — re-prompting the
 *     same step-up can loop, so it is offered once and then becomes a dead end.
 */
export type AuthFailureOrigin =
  /** A 401 from reading a resource. Only ever snowplow's own reasons (authn#58, note 1). */
  | 'resource-401'
  /** A 403/500 from the step-up POST itself, handled by whoever started the step-up. */
  | 'step-up-exchange'

/**
 * Classify an auth failure from its Status body and the origin it arrived at.
 *
 * An unrecognised or absent reason falls back to `reauthenticate`, which is what the portal did
 * for every 401 before this existed. That default is deliberate: it is the outcome that cannot
 * make things worse. Guessing `step-up` for an unknown reason would risk the unsatisfiable-prompt
 * loop this module exists to prevent, and guessing `configuration-fault` would tell someone their
 * cluster is broken on the strength of a string we do not recognise.
 */
/**
 * Which credential the failed request carried.
 *
 * This is the input NO server response can supply, and it is what makes the classification robust
 * (authn#58, note on expiry). When a step-up JWT expires, snowplow rejects it at JWT validation —
 * before any Secret is selected — so the answer is its GENERIC expired-token 401: not
 * `StepUpRequired`, not `SessionCredentialMissing`, quite possibly no `reason` at all. No amount of
 * body-reading can tell that apart from an expired session, because on the wire it is the same
 * thing. Only the caller knows which token it sent.
 *
 * Without this, an expired step-up token shows a full sign-in surface for a session that is still
 * valid — wrong, plausible, and the kind of thing nobody reports as a bug.
 */
export type AuthTokenKind =
  /** The ordinary session JWT (24h default). */
  | 'session'
  /** A step-up JWT, good for ~15m and used only for elevated calls. */
  | 'step-up'

export interface AuthFailureContext {
  origin?: AuthFailureOrigin
  tokenKind?: AuthTokenKind
}

export const authFailureCauseOf = (body: unknown, context: AuthFailureOrigin | AuthFailureContext = {}): AuthFailureCause => {
  const { origin = 'resource-401', tokenKind = 'session' } = typeof context === 'string' ? { origin: context } : context
  const causes = (body as AuthFailureBody | null | undefined)?.details?.causes
  const first = Array.isArray(causes) ? causes[0] : undefined
  const raw = first?.reason
  const reason = typeof raw === 'string' && raw.length > 0 ? raw : null
  const known = reason !== null && BY_REASON[reason]
  const base = known || 'reauthenticate'
  const action = origin === 'step-up-exchange' ? atStepUpExchange(reason, base) : base
  // A request that carried the STEP-UP token can never resolve to a session sign-in: the session
  // credential was not what failed, and authn never touches it during a step-up. An unrecognised
  // or absent reason here is an expired step-up JWT, which is the common case rather than an edge
  // one — the token lives ~15m. A recognised reason still wins, because snowplow naming a specific
  // fault is better information than the token kind.
  if (tokenKind === 'step-up' && !known) {
    return { action: 'step-up', reason }
  }
  return { action, reason }
}

/**
 * The outcome for a step-up that has already been offered once and come back
 * `InsufficientAssurance`: the account cannot reach the level at all (no OTP enrolled, or the
 * realm's flow lacks it). Not a cluster misconfiguration, so it does not claim to be one — but
 * equally not something a third prompt will fix.
 */
export const accountCannotReachLevel = (reason: string | null): AuthFailureCause =>
  ({ action: 'configuration-fault', reason })

/** True when stepping up or signing in again can actually resolve this failure. */
export const isUserActionable = (cause: AuthFailureCause): boolean =>
  cause.action !== 'configuration-fault' && cause.action !== 'server-fault'
