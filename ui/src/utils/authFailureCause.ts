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
 * Classify a 401 from its Status body.
 *
 * An unrecognised or absent reason falls back to `reauthenticate`, which is what the portal did
 * for every 401 before this existed. That default is deliberate: it is the outcome that cannot
 * make things worse. Guessing `step-up` for an unknown reason would risk the unsatisfiable-prompt
 * loop this module exists to prevent, and guessing `configuration-fault` would tell someone their
 * cluster is broken on the strength of a string we do not recognise.
 */
export const authFailureCauseOf = (body: unknown): AuthFailureCause => {
  const causes = (body as AuthFailureBody | null | undefined)?.details?.causes
  const first = Array.isArray(causes) ? causes[0] : undefined
  const raw = first?.reason
  const reason = typeof raw === 'string' && raw.length > 0 ? raw : null
  return { action: (reason !== null && BY_REASON[reason]) || 'reauthenticate', reason }
}

/** True when stepping up or signing in again can actually resolve this failure. */
export const isUserActionable = (cause: AuthFailureCause): boolean =>
  cause.action !== 'configuration-fault' && cause.action !== 'server-fault'
