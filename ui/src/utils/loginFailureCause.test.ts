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

import { loginFailureCauseOf } from './loginFailureCause'

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
      'LDAPUnavailable', 'PasswordSecretMissing', 'IssuanceFailed', 'UserLookupFailed',
      // 0.35.0's additions, all 500, all authn or its IdP failing rather than the caller.
      'TokenExchangeFailed', 'OIDCDiscoveryFailed', 'OIDCConfigInvalid',
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
    }
  })

  it('a config the page offered but authn does not have escalates despite its 404', () => {
    // The method list comes from authn's own /strategies, so offering a method that is not there is
    // our bug or a broken install — never something to retype. LDAPConfigNotFound established the
    // rule; 0.35.0 added the other two and they must follow it.
    for (const reason of ['LDAPConfigNotFound', 'OIDCConfigNotFound', 'OAuthConfigNotFound']) {
      expect(loginFailureCauseOf(404, body(reason), 'redirect').action, reason).toBe('escalate')
    }
  })

  it('a malformed request from the portal escalates: it is our bug, and 400 must not read as "retype"', () => {
    // These are 4xx, which is exactly where the old status-only reading sent people to retype. A
    // person cannot fix a missing ?name= or a missing X-Auth-Code by typing anything.
    for (const reason of ['MissingConfigName', 'MissingAuthorizationCode', 'InvalidRequestBody']) {
      const cause = loginFailureCauseOf(400, body(reason), 'redirect')
      expect(cause.action, reason).toBe('escalate')
      expect(cause.text, reason).not.toMatch(/check them/i)
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
