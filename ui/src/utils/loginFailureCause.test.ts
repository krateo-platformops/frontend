/**
 * The point of these is the FALL-THROUGH, not the table lookups.
 *
 * Any classifier passes its own enumerated cases — that proves the Set literals were typed
 * correctly and nothing else. What has to hold is the behaviour on inputs this file has never seen:
 * a cause newer than this code, a body that is not authn's shape at all, and the 300 quirk. Those
 * are the cases a release of authn will actually produce, and the ones a reader needs to trust.
 */
import { describe, expect, it } from 'vitest'

import { loginFailureCauseOf } from './loginFailureCause'

const body = (reason: string) => ({ details: { causes: [{ message: 'human text', reason }] } })

describe('loginFailureCauseOf', () => {
  it('a refused caller is told to retype, and is not told to call anyone', () => {
    const cause = loginFailureCauseOf(403, body('InvalidCredentials'))
    expect(cause.action).toBe('retype')
    expect(cause.reason).toBe('InvalidCredentials')
    expect(cause.text).not.toMatch(/administrator/i)
  })

  it("authn's own failure is escalated, and is NOT presented as a credential problem", () => {
    for (const reason of ['LDAPUnavailable', 'PasswordSecretMissing', 'IssuanceFailed', 'UserLookupFailed']) {
      const cause = loginFailureCauseOf(500, body(reason))
      expect(cause.action, reason).toBe('escalate')
      // The whole defect was telling someone to check a password that was correct. If this text
      // ever says "check them and try again" for a server fault, the fix has been undone.
      expect(cause.text, reason).not.toMatch(/check them/i)
      expect(cause.text, reason).toMatch(/not a problem with what you typed/i)
    }
  })

  it('LDAPConfigNotFound escalates despite its 404 — the form offers the method, so it is not the user\'s fault', () => {
    expect(loginFailureCauseOf(404, body('LDAPConfigNotFound')).action).toBe('escalate')
  })

  // THE CASES THAT MATTER. Each is something a future authn release or a proxy really produces.

  it('an UNKNOWN cause falls through to the status code, in both directions', () => {
    // authn's contract is that causes are only added. So a cause this file has never heard of is
    // newer than this file, not broken — and the code still carries the user-facing split.
    expect(loginFailureCauseOf(500, body('SomeCause20280101')).action).toBe('escalate')
    expect(loginFailureCauseOf(403, body('SomeCause20280101')).action).toBe('retype')
    // The unrecognised reason is still reported, so it reaches logs rather than vanishing.
    expect(loginFailureCauseOf(500, body('SomeCause20280101')).reason).toBe('SomeCause20280101')
  })

  it('a body that is not authn\'s shape still classifies, and reports no reason', () => {
    // A proxy returning HTML, an empty body, a parse that yielded a string. None of these may throw:
    // the login form has nothing else to show if the classifier dies.
    for (const junk of [null, undefined, '<html>502 Bad Gateway</html>', 42, {}, { details: {} }, { details: { causes: [] } }]) {
      expect(loginFailureCauseOf(502, junk).action, JSON.stringify(junk)).toBe('escalate')
      expect(loginFailureCauseOf(502, junk).reason, JSON.stringify(junk)).toBeNull()
      expect(loginFailureCauseOf(403, junk).action, JSON.stringify(junk)).toBe('retype')
    }
  })

  it('a cause with a non-string reason is treated as absent rather than trusted', () => {
    expect(loginFailureCauseOf(500, { details: { causes: [{ reason: 42 }] } }).reason).toBeNull()
    expect(loginFailureCauseOf(500, { details: { causes: [{ reason: '' }] } }).reason).toBeNull()
  })

  it('AmbiguousUser is classified by its cause, not by its 3xx code', () => {
    // It arrives as 300 with a body saying "status":"Success" — an authn quirk on their follow-up
    // list. Read by code alone it would land in the retype arm and tell someone to check a
    // password that is fine. It needs its own message: neither "retype" nor "there is an outage".
    const cause = loginFailureCauseOf(300, body('AmbiguousUser'))
    expect(cause.action).toBe('escalate')
    expect(cause.text).toMatch(/more than one directory entry/i)
    expect(cause.text).not.toMatch(/retry shortly/i)
  })

  it('never surfaces authn\'s own message text', () => {
    // authn's messages are for humans and may change; branching or displaying them couples us to
    // wording they explicitly reserve the right to alter.
    const cause = loginFailureCauseOf(403, { details: { causes: [{ message: 'LEAKED', reason: 'InvalidCredentials' }] }, message: 'ALSO LEAKED' })
    expect(cause.text).not.toMatch(/LEAKED/)
  })
})
