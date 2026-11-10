/**
 * Why a login was refused, and whether the person signing in can do anything about it.
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
 * authn 0.35.0 brought the oidc and oauth routes into the same contract (#81) — before it they
 * answered `417`/`500` with no cause at all, so the social-login path could not be classified
 * either and `Auth.tsx` still showed the raw status. That release is why `flow` exists below.
 *
 * THE CONTRACT THIS RELIES ON, from authn's docs/api.md: causes are only ever ADDED, never renamed,
 * and a cause never changes its code. That is what makes the fall-through below safe — an unknown
 * cause is a cause newer than this file, not a broken one, so it degrades to the status-code
 * reading rather than to "unknown error".
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not distinguish an unknown user from a wrong
 * password. authn returns one fixed `InvalidCredentials` message for both, on purpose, so the form
 * cannot be used to enumerate usernames. Nothing here should undo that. It also never surfaces the
 * IdP's own error text: authn keeps that in its log precisely because it names internal endpoints.
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
 * Which sign-in produced the failure, because THE STATUS-CODE READING IS NOT THE SAME FOR BOTH.
 *
 * `password` — the person typed a username and a password, so a 4xx plausibly means they typed it
 * wrong, and "check them and try again" is the useful default for a cause this file has not met.
 *
 * `redirect` — an oidc/oauth round trip. The person typed NOTHING; they clicked a button and came
 * back with a code. A 4xx here is never their text to correct, so the same fall-through that is
 * right for `password` would tell someone to check credentials on a page that has no password
 * field — the exact defect this file was written to remove, in a new shape.
 *
 * This is a required argument rather than a defaulted one: a third sign-in added later must answer
 * the question rather than inherit whichever answer happened to be the default.
 */
export type LoginFlow = 'password' | 'redirect'

/**
 * What the person should do, which is the only distinction a sign-in page needs to draw.
 *
 * An earlier version of this file argued that `retype` and `escalate` were the whole set, because
 * "a login form has exactly two useful outcomes". That was right for a password form and
 * incomplete for a redirect flow: authn's `AuthorizationCodeRejected` is neither — there is
 * nothing to retype, and no administrator is needed for the ordinary case. authn's own guidance for
 * it is "start the sign-in again", so `restart` is a third real outcome rather than an invented one.
 *
 * `request-access` is the fourth, for the same reason: authn's `GroupNotAllowed` is a person whose
 * identity provider signed them in and whom this control plane then declined to admit. Nothing is
 * wrong to retype, starting over returns the same answer, and nothing is broken for an
 * administrator to repair — what is missing is a grant, and only the person can go and ask for it.
 * authn's own guidance for it is "Ask for access". Folding it into `escalate` told that person the
 * platform could not check their credentials and to retry shortly — wrong on both counts.
 */
export type LoginFailureAction = 'escalate' | 'request-access' | 'restart' | 'retype'

export interface LoginFailureCause {
  /** What to do about it. */
  action: LoginFailureAction
  /** authn's cause, when it sent one. Null when the body carried none — see `causeOf`. */
  reason: string | null
  /** What to show the person. Never authn's own `message`: see below. */
  text: string
}

/*
 * The causes authn documents for the login routes.
 *
 * THE SOURCE OF TRUTH IS authn's `docs/api.md`, which enumerates every cause with its code — 45 of
 * them, and exhaustive: verified by extracting every `CauseType` constant from authn's source and
 * finding all 45 present in that document. It is NOT the release notes for any one version. Those
 * tables cover only what that release changed, and reading one as though it were the whole contract
 * is exactly how the four ID-token 403s below went unhandled here. The `(0.35.0)` markers record
 * when a cause appeared, as a reading aid; they do not mean this list came from that release.
 *
 * Grouped by what the person can do, NOT by status code, because that is the only question the
 * page has to answer. The codes are recorded in the comments so a reader can line this up against
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
 * 403 AuthorizationCodeRejected (0.35.0) — the IdP refused the authorization code. It is ONE cause
 *     covering expired, already-used, wrong PKCE verifier, AND redirect_uri mismatch, because
 *     RFC 6749 §5.2 gives all of them the single `invalid_grant` answer and the only thing that
 *     separates them is the IdP's non-standardised `error_description`. authn deliberately will not
 *     guess a split from free text.
 *
 *     So starting over fixes the common cases and CANNOT fix the others: a redirect_uri mismatch or
 *     a bad verifier rejects every fresh code the same way. authn confirmed that directly, which is
 *     why the copy below says "if it happens twice" rather than only "try again" — a loop that
 *     cannot terminate has to hand off, and authn logs the IdP's full answer at warn with
 *     cause=AuthorizationCodeRejected, so there is a real line for an administrator to read.
 */
const RESTART_REASONS = new Set([
  'AuthorizationCodeRejected',
])

/*
 * 400 MissingCodeVerifier (0.36.0) — the OIDCConfig is a public client (no clientSecret) and the
 *     callback brought no X-Code-Verifier. authn answers it BEFORE calling the IdP, so — unlike
 *     AuthorizationCodeRejected — nothing was refused: this browser simply had no verifier to send.
 *     It needs its own copy for that reason; RESTART's "the code … was refused" would be false.
 *
 *     Where a portal-started sign-in loses it. SocialLogin keeps the verifier, beside the state, in
 *     LOCALSTORAGE (`KrateoSLV`, frontend#609) — per origin and shared by every tab of the browser,
 *     so a callback in another tab of the same browser still finds it. Auth.tsx takes both on the
 *     first callback load. So the verifier is missing when:
 *       - the callback page is reloaded — the first load spent it; with no state left either, the
 *         page exchanges the code with no verifier, and authn answers this
 *       - the callback lands in another browser, profile or private window, or storage was cleared
 *     Starting over fixes every one of those. It cannot fix the two repeatable causes:
 *       - the portal is not a secure context (plain http), so `crypto.subtle` is absent, no
 *         challenge is computed, and no verifier is ever stored — every attempt fails alike
 *       - the OIDCConfig's redirectURI is on a different origin from the page the sign-in started
 *         on, so the callback reads another origin's storage, which never held the verifier
 *     Hence "if it keeps happening, tell an administrator" — the same hand-off RESTART carries,
 *     and for the same reason: a loop that cannot terminate has to end somewhere.
 */
const RESTART_HERE_REASONS = new Set([
  'MissingCodeVerifier',
])

/*
 * 403 GroupNotAllowed (0.34.0) — the OIDCConfig sets `spec.allowedGroups` and the person holds none
 *     of them (read after the RESTAction, and after authn strips its reserved `krateo:loa:` groups).
 *     The sign-in itself SUCCEEDED: the IdP authenticated them, the code was redeemed, the ID token
 *     validated. Only admission was refused. authn's docs/api.md: "Caller should — Ask for access".
 *
 *     It is oidc-only. OAuthConfig has no `allowedGroups`, so /oauth/login cannot send it; the set is
 *     consulted for every flow anyway, because the classification follows the cause, not the route.
 *
 *     Before this set existed it fell through: an unknown 403 on a redirect escalates, and the
 *     person was told "the platform could not check your credentials … retry shortly". Every word
 *     of that was false for them — the credentials were checked, and no retry admits someone who is
 *     not in the group.
 */
const REQUEST_ACCESS_REASONS = new Set([
  'GroupNotAllowed',
])

/*
 * The IdP's RESPONSE was refused, rather than the person or the code — all 403, and authn's own
 * comment on them is "retrying unchanged fails again":
 *
 *   403 IDTokenInvalid     the ID token did not validate
 *   403 IssuerMismatch     `iss` is not the configured issuer
 *   403 AudienceMismatch   `aud` is not this client
 *   403 TokenExpired       the ID token's `exp` has passed, beyond authn's one-minute clock skew
 *
 * These escalate, like any platform failure, but they must NOT carry the ordinary platform copy,
 * because that says "retry shortly" — and for an issuer or audience mismatch every retry produces
 * the same refusal. An OIDCConfig pointing at the wrong issuer fails identically forever, and
 * telling someone to wait and try again sends them round a loop with no exit.
 *
 * NOTE ON `TokenExpired`, WHICH IS A COLLISION WAITING TO BE MISREAD. `authFailureCause.ts` also
 * knows a `TokenExpired`, and treats it as "your session ended, sign in again". That is a DIFFERENT
 * token: there it is the caller's own Krateo session token on a resource 401; here it is the ID
 * token the IdP just issued, on the login route. Same string, different subject, and the right
 * advice differs — do not unify them.
 */
const PLATFORM_REFUSAL_REASONS = new Set([
  'AudienceMismatch',
  'IDTokenInvalid',
  'IssuerMismatch',
  'TokenExpired',
])

/*
 * All of authn's own failures, plus the caller-side bugs that are OURS and not the person's.
 * Codes, for lining up against authn's docs/api.md:
 *
 *   authn or its IdP could not complete the sign-in
 *   500  IssuanceFailed             could not mint the token
 *   500  LDAPBindFailed             bind rejected — authn's OWN service account, not the person's
 *   500  LDAPConfigLookupFailed     could not read the LDAPConfig
 *   500  LDAPSearchFailed           search errored
 *   500  LDAPUnavailable            the directory is unreachable
 *   500  PasswordLookupFailed       could not read the password key
 *   500  PasswordSecretMissing      the User's password Secret is absent
 *   500  UserLookupFailed           could not read the User
 *   500  TokenExchangeFailed        (0.35.0) token endpoint unreachable/failing, invalid_client
 *   500  OIDCConfigLookupFailed     (0.35.0)
 *   500  OAuthConfigLookupFailed    (0.35.0)
 *   500  OIDCDiscoveryFailed        (0.35.0)
 *   500  OIDCConfigInvalid          (0.35.0)
 *   500  ClientSecretLookupFailed   (0.35.0)
 *   500  UserInfoFailed             (0.35.0)
 *   500  RESTActionFailed           (0.35.0)
 *
 *   the named config does not exist. NOT the person's fault: the method list the page offers comes
 *   from authn's own /strategies, so offering a method that is not there is our bug or a broken
 *   install, never something to retype.
 *   404  LDAPConfigNotFound
 *   404  OIDCConfigNotFound         (0.35.0)
 *   404  OAuthConfigNotFound        (0.35.0)
 *
 *   the portal sent a malformed request. Also never the person's text — these are OUR bugs, and the
 *   person cannot act on them, so they escalate rather than ask for a retype.
 *   400  MissingConfigName          (0.35.0) no ?name= on ldap/oauth/oidc/step-up
 *   400  MissingAuthorizationCode   (0.35.0) no X-Auth-Code
 *   400  InvalidRequestBody         (0.35.0) ldap body is not JSON
 */
const ESCALATE_REASONS = new Set([
  'ClientSecretLookupFailed',
  // 500. In docs/api.md all along; missed here because this file was first built from the 0.35.0
  // release notes. `IssuerUnknown` is a configured issuer that is missing entirely;
  // `IssuerConflict` is more than one match; `LDAPConfigInvalid` is an unusable LDAPConfig.
  'IssuerConflict',
  'IssuerUnknown',
  'LDAPConfigInvalid',
  'InvalidRequestBody',
  'IssuanceFailed',
  'LDAPBindFailed',
  'LDAPConfigLookupFailed',
  'LDAPConfigNotFound',
  'LDAPSearchFailed',
  'LDAPUnavailable',
  'MissingAuthorizationCode',
  'MissingConfigName',
  'OAuthConfigLookupFailed',
  'OAuthConfigNotFound',
  'OIDCConfigInvalid',
  'OIDCConfigLookupFailed',
  'OIDCConfigNotFound',
  'OIDCDiscoveryFailed',
  'PasswordLookupFailed',
  'PasswordSecretMissing',
  'RESTActionFailed',
  'TokenExchangeFailed',
  'UserInfoFailed',
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
const MISCONFIGURED = 'Sign-in could not be completed: the platform rejected the response from your '
  + 'identity provider. Retrying will not help — an administrator needs to check how this sign-in '
  + 'method is configured.'
/*
 * Says what DID happen (the identity provider signed them in) so that it cannot be read as a
 * credential problem, and names the one person who can change the answer. No "retry": retrying
 * returns the same refusal until someone grants access.
 */
const NOT_ADMITTED = 'Your identity provider signed you in, but your account is not allowed into '
  + 'this control plane. Ask its owner to give you access.'
const RESTART_HERE = 'That sign-in could not be finished in this browser. Start the sign-in again '
  + 'from here — and if it keeps happening, tell an administrator, because the sign-in may be '
  + 'misconfigured.'
const RESTART = 'That sign-in did not complete: the code from your identity provider was refused, '
  + 'usually because it expired or had already been used. Start the sign-in again — and if it happens '
  + 'a second time, tell an administrator, because the sign-in may be misconfigured rather than stale.'

/**
 * Classify a failed login.
 *
 * `status` leads and the cause refines it, rather than the other way round: the status code alone
 * already gives the user-facing split (per authn's own guidance), so an unrecognised cause never
 * costs us the right answer. A cause that contradicts its documented code — which the contract says
 * cannot happen — would be a bug in authn, and trusting the code is the safer failure.
 *
 * THE FALL-THROUGH DEPENDS ON `flow`, and that is the whole reason it is an argument. "4xx means the
 * caller got it wrong" is true of a password form and false of a redirect: on oidc/oauth the person
 * typed nothing, so a 4xx this file has never seen is OUR bug or a broken install, and escalating is
 * both honest and actionable. Reading an unknown 4xx as `retype` there would print "check them and
 * try again" on a page with no field to check.
 *
 * NOTE ON 300. LDAP's `AmbiguousUser` arrives as 300 with a body that, before 0.35.0, said
 * `"status":"Success"` — a quirk authn has since fixed, though nothing here ever read `status`. It is
 * classified by its CAUSE and not by its code, because a 3xx falling into the 5xx arm would tell
 * someone to call an administrator about a directory that holds two matching entries for them —
 * true, but it reads as an outage.
 */
export const loginFailureCauseOf = (
  status: number,
  body: unknown,
  flow: LoginFlow,
): LoginFailureCause => {
  const reason = causeOf(body)

  if (reason !== null && RESTART_REASONS.has(reason)) {
    return { action: 'restart', reason, text: RESTART }
  }
  if (reason !== null && RESTART_HERE_REASONS.has(reason)) {
    return { action: 'restart', reason, text: RESTART_HERE }
  }
  if (reason !== null && REQUEST_ACCESS_REASONS.has(reason)) {
    return { action: 'request-access', reason, text: NOT_ADMITTED }
  }
  // Before ESCALATE_REASONS: these escalate too, but with copy that does not promise a retry.
  if (reason !== null && PLATFORM_REFUSAL_REASONS.has(reason)) {
    return { action: 'escalate', reason, text: MISCONFIGURED }
  }
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

  // Unknown or absent cause: fall through to the code, which authn guarantees carries the split —
  // but read it for the flow that produced it. See the note above.
  if (status >= 500) {
    return { action: 'escalate', reason, text: PLATFORM }
  }
  return flow === 'redirect'
    ? { action: 'escalate', reason, text: PLATFORM }
    : { action: 'retype', reason, text: REFUSED }
}
