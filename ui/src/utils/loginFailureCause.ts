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

/**
 * The heading for each action, shared by the callback page's <Result> and both pages'
 * notifications.
 *
 * A Record, not a ternary, so that a new action has to choose its own title here rather than
 * inherit the ternary's else. `request-access` would otherwise have read "Authentication error" —
 * wrong for a person whose authentication worked and who was refused only admission.
 *
 * `restart` is "Sign-in not completed", not "Authentication error": every restart cause is an
 * attempt that did not finish — a cancelled consent, a spent code, a lost verifier — and none of
 * them is an authentication that failed.
 */
export const LOGIN_FAILURE_TITLE: Record<LoginFailureAction, string> = {
  escalate: 'Sign-in unavailable',
  'request-access': 'Access not granted',
  restart: 'Sign-in not completed',
  retype: 'Authentication error',
}

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
 * THE SOURCE OF TRUTH IS authn's `docs/api.md`, which enumerates every cause with its code. At
 * authn 0.36.0 it lists 46, and those are exactly the 46 `CauseType` constants in authn's source.
 * It is NOT the release notes for any one version. Those tables cover only what that release
 * changed, and reading one as though it were the whole contract is exactly how the four ID-token
 * 403s below went unhandled here. The `(0.35.0)` markers record when a cause appeared, as a reading
 * aid; they do not mean this list came from that release.
 *
 * WHAT WAS AND WAS NOT CHECKED. An earlier version of this comment said the list here had been
 * checked against all 45 documented causes. What had been checked was the DOCUMENT against authn's
 * SOURCE — not this file against the document. `GroupNotAllowed` has been in docs/api.md since
 * authn 0.34.0 and was missing here until a person refused by allowedGroups was told to retry
 * shortly; `MissingCodeVerifier` (0.36.0) was missing too. As of authn 0.36.0 this file names every
 * cause the basic, ldap, oidc and oauth login routes can send. The 11 documented causes it does NOT
 * name belong to `/oidc/stepup` (4) and `/serviceaccount/login` (7), which neither sign-in page
 * calls.
 *
 * authn's own `TestEveryCauseIsDocumented` fails its build if the source declares a cause with no
 * row in that document, so the document is complete by construction.
 *
 * Grouped by what the person can do, NOT by status code, because that is the only question the
 * page has to answer. authn's "Caller should" column answers it for every cause, and where that
 * column and the status code disagree — a 500 marked "Tell an administrator" — the column wins. The codes are recorded in the comments so a reader can line this up against
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
 *
 *     authn's docs say "Fix the client" for it. That is written for a client that NEVER sends a
 *     verifier. The portal always sends one when it sent a challenge, and it only fails to send a
 *     challenge in the plain-http case above, so for the portal the ordinary cause is a verifier
 *     that was stored and then lost.
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
 * authn's own failures that a retry CAN fix: authn's docs/api.md gives each of these "Retry later"
 * — a dependency failed, possibly for a moment. They carry PLATFORM's "retry shortly".
 *
 * THE LINE IS authn's GUIDANCE, NOT THE STATUS CODE. Every cause here is a 500, but so are seven
 * causes authn marks "Tell an administrator" — a configuration problem that fails identically until
 * someone fixes it. Those are in PLATFORM_FAULT_REASONS below. Reading "500" as "retry" gave all
 * seven the "retry shortly" copy, which for them is false.
 *
 *   500  IssuanceFailed             could not mint the token
 *   500  LDAPConfigLookupFailed     could not read the LDAPConfig
 *   500  LDAPUnavailable            the directory is unreachable
 *   500  PasswordLookupFailed       could not read the password key
 *   500  UserLookupFailed           could not read the User
 *   500  TokenExchangeFailed        (0.35.0) token endpoint unreachable/failing, invalid_client
 *   500  OIDCConfigLookupFailed     (0.35.0)
 *   500  OAuthConfigLookupFailed    (0.35.0)
 *   500  OIDCDiscoveryFailed        (0.35.0)
 *   500  ClientSecretLookupFailed   (0.35.0)
 *   500  UserInfoFailed             (0.35.0)
 *   500  RESTActionFailed           (0.35.0)
 */
const ESCALATE_REASONS = new Set([
  'ClientSecretLookupFailed',
  'IssuanceFailed',
  'LDAPConfigLookupFailed',
  'LDAPUnavailable',
  'OAuthConfigLookupFailed',
  'OIDCConfigLookupFailed',
  'OIDCDiscoveryFailed',
  'PasswordLookupFailed',
  'RESTActionFailed',
  'TokenExchangeFailed',
  'UserInfoFailed',
  'UserLookupFailed',
])

/*
 * Failures that are OURS — the portal's or the install's — and that no retry can change. They used
 * to share PLATFORM's copy, which says "retry shortly": the same class of wrong advice this file
 * exists to remove, because each of these fails identically on every attempt. authn's guidance for
 * every one is "Fix the client" or "Tell an administrator", never "Retry later".
 *
 *   the portal sent a request authn cannot act on. authn: "Fix the client" — and the client is us.
 *   400  MissingConfigName          (0.35.0) no ?name=. Both pages build the request from authn's
 *                                   own /strategies entry (Auth.tsx from its `name`, Login.tsx from
 *                                   its `path`), so only a broken entry or a portal bug produces it.
 *   400  MissingAuthorizationCode   (0.35.0) no X-Auth-Code, or an empty one. NOT a restart case:
 *                                   Auth.tsx exchanges only when the callback carries a non-empty
 *                                   `?code=`, and sends it as that header unchanged. A callback that
 *                                   arrives WITHOUT a code never reaches authn at all. So this needs
 *                                   something between the browser and authn dropping the header —
 *                                   an install fault, and the next attempt meets the same proxy.
 *   400  InvalidRequestBody         (0.35.0) the ldap body is not JSON. The form sends NO body —
 *                                   the credentials go in the Basic header, and authn accepts an
 *                                   empty body — so this too needs something in between.
 *
 *   the named config does not exist. authn: "Tell an administrator". The method list both pages
 *   offer comes from authn's own /strategies, so offering a method that is not there is our bug or
 *   a broken install, never something to retype — and it does not appear by waiting.
 *   404  LDAPConfigNotFound
 *   404  OIDCConfigNotFound         (0.35.0)
 *   404  OAuthConfigNotFound        (0.35.0)
 *
 *   authn's own 500s whose guidance is "Tell an administrator": configuration, not a moment's
 *   outage. These were all in ESCALATE_REASONS, and so all said "retry shortly".
 *   500  IssuerUnknown              the OIDCConfig has neither discoveryURL nor issuer
 *   500  IssuerConflict             spec.issuer differs from the discovery document's issuer
 *   500  OIDCConfigInvalid          (0.35.0) authorize/token endpoint known from neither spec nor
 *                                   discovery
 *   500  LDAPConfigInvalid          the LDAPConfig is unusable
 *   500  PasswordSecretMissing      the User's password Secret is absent
 *   500  LDAPBindFailed             authn's OWN service-account bind was refused — not the person's
 *   500  LDAPSearchFailed           the directory search errored
 */
const PLATFORM_FAULT_REASONS = new Set([
  'InvalidRequestBody',
  'IssuerConflict',
  'IssuerUnknown',
  'LDAPBindFailed',
  'LDAPConfigInvalid',
  'LDAPConfigNotFound',
  'LDAPSearchFailed',
  'MissingAuthorizationCode',
  'MissingConfigName',
  'OAuthConfigNotFound',
  'OIDCConfigInvalid',
  'OIDCConfigNotFound',
  'PasswordSecretMissing',
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
/*
 * For the 4xx that are ours (PLATFORM_FAULT_REASONS). Keeps PLATFORM's "not a problem with what you
 * typed" and drops its "retry shortly", which is false for every cause that reaches it.
 */
const PLATFORM_FAULT = 'Sign-in could not be completed because of a fault on the platform\'s side. '
  + 'This is not a problem with what you typed, and retrying will not help — tell an administrator.'
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
 * And it escalates with PLATFORM_FAULT, not PLATFORM: a refusal is an answer, not an outage, and
 * nothing says the next attempt will be answered differently. It used to say "retry shortly" — which
 * is exactly what `GroupNotAllowed` said while it was unknown here. The unknown reason still rides
 * along in `reason`, so the page can show it in "(cause)" for whoever has to look it up. An unknown
 * 5xx keeps PLATFORM: a server failure is the case where waiting can help.
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
  if (reason !== null && PLATFORM_FAULT_REASONS.has(reason)) {
    return { action: 'escalate', reason, text: PLATFORM_FAULT }
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
    ? { action: 'escalate', reason, text: PLATFORM_FAULT }
    : { action: 'retype', reason, text: REFUSED }
}

/*
 * THE CALLBACK THAT CARRIES NO CODE.
 *
 * The IdP sends the browser back to /auth either with `?code=` or, per RFC 6749 §4.1.2.1, with
 * `?error=` (and optionally `error_description`) — when the person cancels or declines consent, or
 * when the IdP refuses the request itself. A visit to /auth with neither is a bookmark, a reload of
 * a spent callback, or a link. None of these reaches authn, so there is no authn cause to read: the
 * `error` code is the only classification there is.
 *
 * `access_denied` is "the resource owner or authorization server denied the request". Usually the
 * person pressed Cancel; sometimes the IdP's own policy declined the account. The copy says both,
 * blames nobody, and offers the one remedy that works for the first.
 */
/*
 * The request itself was refused — configuration, so no retry helps:
 *   invalid_request            a malformed authorization request: our URL, or the OIDCConfig behind it
 *   invalid_scope              a scope the IdP does not know or will not grant this client
 *   unauthorized_client        this client may not use the code flow at this IdP
 *   unsupported_response_type  the IdP does not offer `response_type=code` to this client
 */
const IDP_CONFIG_ERRORS = new Set([
  'invalid_request',
  'invalid_scope',
  'unauthorized_client',
  'unsupported_response_type',
])
/*
 * The IdP failed, and trying again may help:
 *   server_error               RFC 6749's stand-in for a 500
 *   temporarily_unavailable    overloaded or in maintenance — the stand-in for a 503
 */
const IDP_TRANSIENT_ERRORS = new Set([
  'server_error',
  'temporarily_unavailable',
])

/*
 * An `error` value is shown in "(cause)" only when it is shaped like an OAuth error code. The value
 * comes from the URL, and the URL is anyone's to write: a link to /auth?error=... must not be able
 * to put a sentence on this origin. RFC 6749's own codes are all lowercase-and-underscore.
 */
const ERROR_CODE_SHAPE = /^[a-z_]{1,40}$/

const NO_SIGN_IN = 'There is no sign-in to finish here: this page was opened without an answer from '
  + 'your identity provider. Start the sign-in again.'
const DECLINED = 'The sign-in was cancelled or declined at your identity provider, so you were not '
  + 'signed in. Start the sign-in again to continue. If you did not cancel it, your identity provider '
  + 'declined this account — ask an administrator.'
const IDP_BUSY = 'Your identity provider could not complete the sign-in just now. This is not a '
  + 'problem with anything you did — start the sign-in again in a moment, and tell an administrator '
  + 'if it keeps happening.'
const IDP_REFUSED = 'Your identity provider refused the sign-in request, which means this sign-in '
  + 'method is not set up correctly. This is not a problem with anything you did, and retrying will '
  + 'not help — tell an administrator.'

/**
 * Classify an oidc/oauth callback that arrived WITHOUT an authorization code, from its `?error=`.
 *
 * `error_description` is deliberately not an argument. It is free text from the URL, so rendering
 * it — even as plain text — would let any link print a message of its choosing on the portal's own
 * origin ("call this number to restore access"). The code is enough to say what happened; an
 * administrator reading the IdP's log has the description there.
 *
 * An unrecognised `error` is read like an unrecognised refusal on the redirect flow: escalate, no
 * promise that a retry helps.
 */
export const callbackFailureOf = (error: string | null): LoginFailureCause => {
  if (error === null || error === '') {
    return { action: 'restart', reason: null, text: NO_SIGN_IN }
  }
  const reason = ERROR_CODE_SHAPE.test(error) ? error : null
  if (error === 'access_denied') {
    return { action: 'restart', reason, text: DECLINED }
  }
  if (IDP_TRANSIENT_ERRORS.has(error)) {
    return { action: 'restart', reason, text: IDP_BUSY }
  }
  if (IDP_CONFIG_ERRORS.has(error)) {
    return { action: 'escalate', reason, text: IDP_REFUSED }
  }
  return { action: 'escalate', reason, text: IDP_REFUSED }
}
