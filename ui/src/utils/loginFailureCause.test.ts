/**
 * The point of these is the FALL-THROUGH, not the table lookups.
 *
 * Any classifier passes its own enumerated cases — that proves the Set literals were typed
 * correctly and nothing else. What has to hold is the behaviour on inputs this file has never seen:
 * a cause newer than this code, a body that is not authn's shape at all, and the 300 quirk. Those
 * are the cases a release of authn will actually produce, and the ones a reader needs to trust.
 *
 * Since authn 0.35.0 there is a second axis: the SAME status and the SAME unknown cause must read
 * differently on a password form and on an oidc/oauth round trip, because only one of them had
 * anything typed into it. That pair is the most important assertion in this file.
 */
import { describe, expect, it } from 'vitest'

import { callbackFailureOf, LOGIN_FAILURE_TITLE, loginFailureCauseOf } from './loginFailureCause'

const body = (reason: string) => ({ details: { causes: [{ message: 'human text', reason }] } })

describe('loginFailureCauseOf', () => {
  it('a refused caller is told to retype, and is not told to call anyone', () => {
    const cause = loginFailureCauseOf(403, body('InvalidCredentials'), 'password')
    expect(cause.action).toBe('retype')
    expect(cause.reason).toBe('InvalidCredentials')
    expect(cause.text).not.toMatch(/administrator/i)
  })

  it("authn's own failure is escalated, and is NOT presented as a credential problem", () => {
    const own = [
      'LDAPUnavailable', 'IssuanceFailed', 'UserLookupFailed', 'PasswordLookupFailed',
      // 0.35.0's additions, all 500, all authn or its IdP failing rather than the caller.
      'TokenExchangeFailed', 'OIDCDiscoveryFailed',
      'ClientSecretLookupFailed', 'UserInfoFailed', 'RESTActionFailed',
      'OIDCConfigLookupFailed', 'OAuthConfigLookupFailed',
    ]
    for (const reason of own) {
      const cause = loginFailureCauseOf(500, body(reason), 'redirect')
      expect(cause.action, reason).toBe('escalate')
      // The whole defect was telling someone to check a password that was correct. If this text
      // ever says "check them and try again" for a server fault, the fix has been undone.
      expect(cause.text, reason).not.toMatch(/check them/i)
      expect(cause.text, reason).toMatch(/not a problem with what you typed/i)
      // A failure to reach or read something is the case a retry CAN fix, so this copy keeps it.
      expect(cause.text, reason).toMatch(/retry shortly/i)
    }
  })

  it('a config the page offered but authn does not have escalates despite its 404', () => {
    // The method list comes from authn's own /strategies, so offering a method that is not there is
    // our bug or a broken install — never something to retype. LDAPConfigNotFound established the
    // rule; 0.35.0 added the other two and they must follow it.
    for (const reason of ['LDAPConfigNotFound', 'OIDCConfigNotFound', 'OAuthConfigNotFound']) {
      const cause = loginFailureCauseOf(404, body(reason), 'redirect')
      expect(cause.action, reason).toBe('escalate')
      // A config that is not there does not appear by waiting: no "retry shortly".
      expect(cause.text, reason).not.toMatch(/retry shortly/i)
      expect(cause.text, reason).toMatch(/retrying will not help/i)
    }
  })

  it('a malformed request from the portal escalates: it is our bug, and 400 must not read as "retype"', () => {
    // These are 4xx, which is exactly where the old status-only reading sent people to retype. A
    // person cannot fix a missing ?name= or a missing X-Auth-Code by typing anything.
    for (const reason of ['MissingConfigName', 'MissingAuthorizationCode', 'InvalidRequestBody']) {
      const cause = loginFailureCauseOf(400, body(reason), 'redirect')
      expect(cause.action, reason).toBe('escalate')
      expect(cause.text, reason).not.toMatch(/check them/i)
      // Our bug or the install's, identical on every attempt. These used to share PLATFORM's
      // "retry shortly" — the same class of wrong advice as the GroupNotAllowed defect.
      expect(cause.text, reason).not.toMatch(/retry shortly/i)
      expect(cause.text, reason).toMatch(/retrying will not help/i)
      expect(cause.text, reason).toMatch(/not a problem with what you typed/i)
      expect(cause.text, reason).toMatch(/administrator/i)
    }
    // And the same holds on the password form, where the 400 is equally not the person's text.
    expect(loginFailureCauseOf(400, body('InvalidRequestBody'), 'password').action).toBe('escalate')
  })

  // THE 0.35.0 CASE THAT NEEDED A THIRD ACTION.

  it('a rejected authorization code says start over, names no credentials, and does not promise one retry will fix it', () => {
    const cause = loginFailureCauseOf(403, body('AuthorizationCodeRejected'), 'redirect')
    expect(cause.action).toBe('restart')
    // Nothing was typed, so this must never ask for a retype — it is a 403, which is precisely
    // where the password form's reading sends people to check their credentials.
    expect(cause.text).not.toMatch(/check them/i)
    expect(cause.text).not.toMatch(/credentials were not accepted/i)
    expect(cause.text).toMatch(/start the sign-in again/i)
    // authn confirmed the cause also covers redirect_uri mismatch and a bad PKCE verifier, which no
    // number of retries fixes, and it cannot tell those apart from an expiry. So the copy has to
    // hand off on the second failure rather than send someone round a loop that cannot terminate.
    expect(cause.text).toMatch(/second time/i)
    expect(cause.text).toMatch(/administrator/i)
  })

  it('a missing PKCE verifier says start over HERE, and does not claim the code was refused', () => {
    // MissingCodeVerifier is a 400 authn sends before it calls the IdP: this browser had no
    // verifier to send (callback reloaded, another browser, storage cleared). Nothing was refused,
    // so RESTART's "the code from your identity provider was refused" would be a false statement.
    const cause = loginFailureCauseOf(400, body('MissingCodeVerifier'), 'redirect')
    expect(cause.action).toBe('restart')
    expect(cause.reason).toBe('MissingCodeVerifier')
    expect(cause.text).toMatch(/could not be finished in this browser/i)
    expect(cause.text).toMatch(/start the sign-in again/i)
    expect(cause.text).not.toMatch(/refused/i)
    // It is a 400, which the password reading would send to "check them".
    expect(cause.text).not.toMatch(/check them/i)
    // A plain-http portal or a cross-origin redirectURI loses the verifier on every attempt, so the
    // copy has to hand off rather than loop.
    expect(cause.text).toMatch(/keeps happening/i)
    expect(cause.text).toMatch(/administrator/i)
  })

  // THE CASE THAT NEEDED A FOURTH ACTION.

  it('a person the control plane will not admit is told to ask for access — not to retry, not that the credentials failed', () => {
    // GroupNotAllowed: the IdP signed them in, the code and the ID token were accepted, and the
    // OIDCConfig's allowedGroups then refused them. It used to fall through to escalate, and the
    // page said "the platform could not check your credentials … retry shortly" — false on every
    // count. This is the reported defect; each assertion below is one of its wrong claims.
    const cause = loginFailureCauseOf(403, body('GroupNotAllowed'), 'redirect')
    expect(cause.action).toBe('request-access')
    expect(cause.reason).toBe('GroupNotAllowed')
    expect(cause.text).toMatch(/not allowed into this control plane/i)
    expect(cause.text).toMatch(/ask its owner/i)
    // The credentials WERE checked, and they were fine.
    expect(cause.text).not.toMatch(/could not check/i)
    expect(cause.text).not.toMatch(/credentials were not accepted/i)
    expect(cause.text).not.toMatch(/check them/i)
    // No retry admits someone who is not in the group.
    expect(cause.text).not.toMatch(/retry|try again|start the sign-in again/i)
  })

  it('GroupNotAllowed is read by its cause, so the flow does not change the answer', () => {
    // authn sends it only from /oidc/login and /oidc/stepup — OAuthConfig has no allowedGroups, and
    // the password routes never send it. The classification follows the cause anyway, so a route
    // that gains the field later is already covered and cannot fall back into "retype".
    expect(loginFailureCauseOf(403, body('GroupNotAllowed'), 'password').action).toBe('request-access')
  })

  it('a refused IdP response escalates WITHOUT promising a retry, because retrying is futile', () => {
    // authn's own comment on these four: "retrying unchanged fails again". An OIDCConfig pointing
    // at the wrong issuer refuses identically forever, so the ordinary platform copy — which says
    // "retry shortly" — would send someone round a loop with no exit.
    for (const reason of ['IDTokenInvalid', 'IssuerMismatch', 'AudienceMismatch', 'TokenExpired']) {
      const cause = loginFailureCauseOf(403, body(reason), 'redirect')
      expect(cause.action, reason).toBe('escalate')
      expect(cause.text, reason).toMatch(/retrying will not help/i)
      expect(cause.text, reason).not.toMatch(/retry shortly/i)
      // Still not the person's fault, and still nothing to retype.
      expect(cause.text, reason).not.toMatch(/check them/i)
    }
  })

  it('TokenExpired here is the ID token, NOT the session token authFailureCause knows', () => {
    // Same string, different subject: authFailureCause.ts treats TokenExpired as "your session
    // ended, sign in again" on a resource 401. On the LOGIN route it is the ID token the IdP just
    // issued, and the advice is not "sign in again" — it is "this method is misconfigured". If
    // someone ever unifies the two sets, this is the test that should stop them.
    const cause = loginFailureCauseOf(403, body('TokenExpired'), 'redirect')
    expect(cause.text).not.toMatch(/sign in again/i)
    expect(cause.text).toMatch(/identity provider/i)
  })

  it('a 500 authn marks "Tell an administrator" does NOT say "retry shortly" — the guidance wins over the code', () => {
    // docs/api.md gives these seven "Tell an administrator", not "Retry later": a configuration
    // problem that fails identically until someone fixes it. Read by status alone they are 500s,
    // and every 500 used to say "retry shortly". IssuerUnknown, IssuerConflict and LDAPConfigInvalid
    // were also missed once before, when this file was built from release notes.
    const configuration = [
      'IssuerUnknown', 'IssuerConflict', 'OIDCConfigInvalid', 'LDAPConfigInvalid',
      'PasswordSecretMissing', 'LDAPBindFailed', 'LDAPSearchFailed',
    ]
    for (const reason of configuration) {
      for (const flow of ['password', 'redirect'] as const) {
        const cause = loginFailureCauseOf(500, body(reason), flow)
        expect(cause.action, reason).toBe('escalate')
        expect(cause.text, reason).not.toMatch(/retry shortly/i)
        expect(cause.text, reason).toMatch(/retrying will not help/i)
        expect(cause.text, reason).toMatch(/not a problem with what you typed/i)
        expect(cause.text, reason).toMatch(/administrator/i)
      }
    }
  })

  // THE CASES THAT MATTER. Each is something a future authn release or a proxy really produces.

  it('an UNKNOWN cause falls through to the status code, and reads the 4xx FOR THE FLOW', () => {
    // authn's contract is that causes are only added. So a cause this file has never heard of is
    // newer than this file, not broken — and the code still carries the user-facing split.
    expect(loginFailureCauseOf(500, body('SomeCause20280101'), 'password').action).toBe('escalate')
    expect(loginFailureCauseOf(500, body('SomeCause20280101'), 'redirect').action).toBe('escalate')

    // THIS PAIR IS THE POINT. Same status, same unknown cause, opposite answers — because only the
    // password form had anything typed into it. Reading the redirect 4xx as "retype" would print
    // "check them and try again" on a page with no field to check.
    expect(loginFailureCauseOf(403, body('SomeCause20280101'), 'password').action).toBe('retype')
    expect(loginFailureCauseOf(403, body('SomeCause20280101'), 'redirect').action).toBe('escalate')
    expect(loginFailureCauseOf(403, body('SomeCause20280101'), 'redirect').text).not.toMatch(/check them/i)

    // And the redirect 4xx promises no retry. A refusal is an answer, not an outage — this is exactly
    // what GroupNotAllowed said while it was unknown here. The raw cause stays, for the administrator.
    const refused = loginFailureCauseOf(403, body('SomeCause20280101'), 'redirect')
    expect(refused.text).not.toMatch(/retry shortly/i)
    expect(refused.text).toMatch(/retrying will not help/i)
    expect(refused.text).toMatch(/administrator/i)
    expect(refused.reason).toBe('SomeCause20280101')
    // An unknown 5xx keeps PLATFORM: a server failure is where waiting can help.
    expect(loginFailureCauseOf(500, body('SomeCause20280101'), 'redirect').text).toMatch(/retry shortly/i)

    // The unrecognised reason is still reported, so it reaches logs rather than vanishing.
    expect(loginFailureCauseOf(500, body('SomeCause20280101'), 'password').reason).toBe('SomeCause20280101')
  })

  it('a body that is not authn\'s shape still classifies, and reports no reason', () => {
    // A proxy returning HTML, an empty body, a parse that yielded a string. None of these may throw:
    // the sign-in page has nothing else to show if the classifier dies.
    for (const junk of [null, undefined, '<html>502 Bad Gateway</html>', 42, {}, { details: {} }, { details: { causes: [] } }]) {
      const label = JSON.stringify(junk)
      expect(loginFailureCauseOf(502, junk, 'password').action, label).toBe('escalate')
      expect(loginFailureCauseOf(502, junk, 'password').reason, label).toBeNull()
      expect(loginFailureCauseOf(403, junk, 'password').action, label).toBe('retype')
      // A proxy answering 403 with HTML on the oidc callback must not become "check your password".
      expect(loginFailureCauseOf(403, junk, 'redirect').action, label).toBe('escalate')
    }
  })

  it('a cause with a non-string reason is treated as absent rather than trusted', () => {
    expect(loginFailureCauseOf(500, { details: { causes: [{ reason: 42 }] } }, 'password').reason).toBeNull()
    expect(loginFailureCauseOf(500, { details: { causes: [{ reason: '' }] } }, 'password').reason).toBeNull()
  })

  it('AmbiguousUser is classified by its cause, not by its 3xx code', () => {
    // It arrives as 300. Before 0.35.0 its body also said "status":"Success" — an authn quirk since
    // fixed, though nothing here ever read `status`. Read by code alone it would land in the retype
    // arm and tell someone to check a password that is fine. It needs its own message: neither
    // "retype" nor "there is an outage".
    const cause = loginFailureCauseOf(300, body('AmbiguousUser'), 'password')
    expect(cause.action).toBe('escalate')
    expect(cause.text).toMatch(/more than one directory entry/i)
    expect(cause.text).not.toMatch(/retry shortly/i)
  })

  it('never surfaces authn\'s own message text', () => {
    // authn's messages are for humans and may change; branching or displaying them couples us to
    // wording they explicitly reserve the right to alter. authn also keeps the IdP's own
    // error_description out of the response on purpose, because it names internal endpoints.
    const cause = loginFailureCauseOf(403, { details: { causes: [{ message: 'LEAKED', reason: 'InvalidCredentials' }] }, message: 'ALSO LEAKED' }, 'password')
    expect(cause.text).not.toMatch(/LEAKED/)
  })
})

describe('callbackFailureOf — a callback that came back without a code', () => {
  it('no code and no error is a page opened directly: start again, blame nobody', () => {
    for (const error of [null, '']) {
      const cause = callbackFailureOf(error)
      expect(cause.action).toBe('restart')
      expect(cause.reason).toBeNull()
      expect(cause.text).toMatch(/no sign-in to finish here/i)
      expect(cause.text).toMatch(/start the sign-in again/i)
    }
  })

  it('access_denied says it was cancelled or declined, offers to start again, and does not blame the platform', () => {
    const cause = callbackFailureOf('access_denied')
    expect(cause.action).toBe('restart')
    expect(cause.reason).toBe('access_denied')
    expect(cause.text).toMatch(/cancelled or declined/i)
    expect(cause.text).toMatch(/start the sign-in again/i)
    expect(cause.text).not.toMatch(/platform|fault|unavailable|misconfigured/i)
  })

  it('a refused request (RFC 6749 §4.1.2.1) is configuration: tell an administrator, no retry', () => {
    for (const error of ['invalid_request', 'unauthorized_client', 'unsupported_response_type', 'invalid_scope']) {
      const cause = callbackFailureOf(error)
      expect(cause.action, error).toBe('escalate')
      expect(cause.reason, error).toBe(error)
      expect(cause.text, error).toMatch(/retrying will not help/i)
      expect(cause.text, error).toMatch(/administrator/i)
      expect(cause.text, error).not.toMatch(/retry shortly|in a moment/i)
    }
  })

  it('server_error and temporarily_unavailable are the two where trying again may help', () => {
    for (const error of ['server_error', 'temporarily_unavailable']) {
      const cause = callbackFailureOf(error)
      expect(cause.action, error).toBe('restart')
      expect(cause.text, error).toMatch(/start the sign-in again in a moment/i)
      expect(cause.text, error).toMatch(/if it keeps happening/i)
      expect(cause.text, error).not.toMatch(/retrying will not help/i)
    }
  })

  it('an unrecognised error code escalates without promising a retry, and keeps the code for the administrator', () => {
    const cause = callbackFailureOf('interaction_required')
    expect(cause.action).toBe('escalate')
    expect(cause.reason).toBe('interaction_required')
    expect(cause.text).toMatch(/retrying will not help/i)
  })

  it('an `error` that is not shaped like a code is never echoed: the URL is anyone\'s to write', () => {
    // A link to /auth?error=... must not put a sentence of the sender's choosing on this origin,
    // not even inside "(cause)". The classification still happens — as an unknown refusal.
    for (const error of ['Call 555-0100 to restore access', '<img src=x onerror=alert(1)>', 'a'.repeat(41), 'ACCESS_DENIED']) {
      const cause = callbackFailureOf(error)
      expect(cause.reason, error).toBeNull()
      expect(cause.text, error).not.toContain(error)
      expect(cause.action, error).toBe('escalate')
    }
  })
})

describe('LOGIN_FAILURE_TITLE', () => {
  it('a restart is "Sign-in not completed": none of its causes is an authentication that failed', () => {
    expect(LOGIN_FAILURE_TITLE.restart).toBe('Sign-in not completed')
    expect(LOGIN_FAILURE_TITLE.escalate).toBe('Sign-in unavailable')
    expect(LOGIN_FAILURE_TITLE['request-access']).toBe('Access not granted')
  })
})
