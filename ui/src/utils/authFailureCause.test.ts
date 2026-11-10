/**
 * `authFailureCauseOf` — which of the three outcomes a 401 maps to.
 *
 * The case that matters most is `StepUpNotEnabled` / `StepUpMisconfigured` mapping to
 * `configuration-fault` rather than `step-up`. Getting that wrong shows the person a prompt that
 * cannot succeed: they re-authenticate, get the same 401, and loop forever while the real fault —
 * a cluster setting — is reported to nobody.
 */
import { describe, expect, it } from 'vitest'

import { accountCannotReachLevel, AUTH_FAILURE_REASONS, authFailureCauseOf, isUserActionable, stepUpCredentialStillMissing } from './authFailureCause'

/** A 401 Status body as snowplow sends it, with only the fields the classifier reads. */
const body = (reason: unknown) => ({
  code: 401,
  details: { causes: [{ reason }] },
  message: 'unauthorized',
  reason: 'Unauthorized',
})

describe('the reasons a person can act on', () => {
  it('StepUpRequired and InsufficientAssurance ask for a step-up', () => {
    for (const reason of [AUTH_FAILURE_REASONS.stepUpRequired, AUTH_FAILURE_REASONS.insufficientAssurance]) {
      expect(authFailureCauseOf(body(reason))).toEqual({ action: 'step-up', reason })
    }
  })

  it('StaleAuthentication and SessionCredentialMissing ask for a fresh sign-in', () => {
    for (const reason of [AUTH_FAILURE_REASONS.staleAuthentication, AUTH_FAILURE_REASONS.sessionCredentialMissing]) {
      expect(authFailureCauseOf(body(reason))).toEqual({ action: 'reauthenticate', reason })
    }
  })
})

describe('the reasons NO prompt can fix', () => {
  it('StepUpNotEnabled and StepUpMisconfigured are configuration faults, never a step-up prompt', () => {
    for (const reason of [AUTH_FAILURE_REASONS.stepUpNotEnabled, AUTH_FAILURE_REASONS.stepUpMisconfigured]) {
      const cause = authFailureCauseOf(body(reason))
      expect(cause).toEqual({ action: 'configuration-fault', reason })
      // The whole point: do not offer an action that cannot succeed.
      expect(isUserActionable(cause)).toBe(false)
      expect(cause.action).not.toBe('step-up')
    }
  })

  it('every other reason IS user-actionable', () => {
    for (const reason of [
      AUTH_FAILURE_REASONS.stepUpRequired,
      AUTH_FAILURE_REASONS.insufficientAssurance,
      AUTH_FAILURE_REASONS.staleAuthentication,
      AUTH_FAILURE_REASONS.sessionCredentialMissing,
    ]) {
      expect(isUserActionable(authFailureCauseOf(body(reason)))).toBe(true)
    }
  })
})

describe('anything it does not recognise falls back to a fresh sign-in', () => {
  it('an unknown reason string does NOT become step-up or a configuration fault', () => {
    // Guessing step-up risks the unsatisfiable-prompt loop; guessing configuration-fault tells
    // someone their cluster is broken on the strength of a string we do not know.
    const cause = authFailureCauseOf(body('SomethingAuthnAddedLater'))
    expect(cause).toEqual({ action: 'reauthenticate', reason: 'SomethingAuthnAddedLater' })
  })

  it('keeps the unrecognised reason verbatim, so support can quote it', () => {
    expect(authFailureCauseOf(body('WeirdNewReason')).reason).toBe('WeirdNewReason')
  })

  it('handles a body with no discriminator at all — the pre-1029 snowplow', () => {
    for (const value of [
      { code: 401, message: 'unauthorized', reason: 'Unauthorized' },
      { details: {} },
      { details: { causes: [] } },
      { details: { causes: [{}] } },
      {},
      null,
      undefined,
    ]) {
      expect(authFailureCauseOf(value)).toEqual({ action: 'reauthenticate', reason: null })
    }
  })

  it('does not trust the reason to be a string', () => {
    for (const reason of [42, true, null, {}, ['StepUpRequired']]) {
      expect(authFailureCauseOf(body(reason))).toEqual({ action: 'reauthenticate', reason: null })
    }
  })

  it('survives a body that is not an object', () => {
    for (const value of ['unauthorized', 42, true, []]) {
      expect(authFailureCauseOf(value)).toEqual({ action: 'reauthenticate', reason: null })
    }
  })

  it('reads only the FIRST cause, which is what the contract specifies', () => {
    const value = { details: { causes: [{ reason: AUTH_FAILURE_REASONS.stepUpRequired }, { reason: AUTH_FAILURE_REASONS.stepUpNotEnabled }] } }
    expect(authFailureCauseOf(value).action).toBe('step-up')
  })
})

describe('IssuanceFailed (authn sends it on 500)', () => {
  it('is its own outcome — neither configuration-fault nor reauthenticate', () => {
    const cause = authFailureCauseOf(body(AUTH_FAILURE_REASONS.issuanceFailed))
    expect(cause.action).toBe('server-fault')
    expect(isUserActionable(cause)).toBe(false)
  })
})

describe('the SAME reason means different things at the two origins (authn#58)', () => {
  it('StaleAuthentication: sign in again on a resource 401, redo the step-up at the exchange', () => {
    // On a 401 the session is old. At the exchange the session credential is FINE — the IdP
    // returned an auth_time older than max_age, so signing in again fixes nothing.
    expect(authFailureCauseOf(body(AUTH_FAILURE_REASONS.staleAuthentication), 'resource-401').action).toBe('reauthenticate')
    expect(authFailureCauseOf(body(AUTH_FAILURE_REASONS.staleAuthentication), 'step-up-exchange').action).toBe('step-up')
  })

  it('InsufficientAssurance stays a step-up at BOTH origins — it is offered once', () => {
    // Deciding that a second identical refusal is a dead end needs attempt state, which is the
    // step-up flow's job, not the classifier's. See accountCannotReachLevel.
    for (const origin of ['resource-401', 'step-up-exchange'] as const) {
      expect(authFailureCauseOf(body(AUTH_FAILURE_REASONS.insufficientAssurance), origin).action).toBe('step-up')
    }
  })

  it('defaults to resource-401, which is the only path wired today', () => {
    expect(authFailureCauseOf(body(AUTH_FAILURE_REASONS.staleAuthentication)).action).toBe('reauthenticate')
  })

  it('the misconfiguration and server-fault reasons are origin-independent', () => {
    for (const reason of [
      AUTH_FAILURE_REASONS.stepUpNotEnabled,
      AUTH_FAILURE_REASONS.stepUpMisconfigured,
      AUTH_FAILURE_REASONS.issuanceFailed,
    ]) {
      const onResource = authFailureCauseOf(body(reason), 'resource-401')
      const atExchange = authFailureCauseOf(body(reason), 'step-up-exchange')
      expect(onResource).toEqual(atExchange)
      expect(isUserActionable(onResource)).toBe(false)
    }
  })

  it('a step-up offered once and refused again is a dead end, not a third prompt', () => {
    const cause = accountCannotReachLevel(AUTH_FAILURE_REASONS.insufficientAssurance)
    expect(isUserActionable(cause)).toBe(false)
    expect(cause.reason).toBe(AUTH_FAILURE_REASONS.insufficientAssurance)
  })
})

describe('which TOKEN the request carried — the input no server response can give (authn#58)', () => {
  /*
   * When a step-up JWT expires, snowplow rejects it at JWT validation, before any Secret is
   * selected. The answer is its GENERIC expired-token 401: not StepUpRequired, not
   * SessionCredentialMissing, possibly no reason at all. On the wire that is indistinguishable
   * from an expired session, so no amount of body-reading resolves it. Only the caller knows.
   */
  it('an unrecognised 401 on a STEP-UP token is a step-up, not a session sign-in', () => {
    for (const value of [{}, null, { details: { causes: [] } }, { message: 'token expired' }]) {
      expect(authFailureCauseOf(value, { tokenKind: 'step-up' }).action).toBe('step-up')
    }
  })

  it('the same unrecognised 401 on a SESSION token is a session sign-in', () => {
    for (const value of [{}, null, { message: 'token expired' }]) {
      expect(authFailureCauseOf(value, { tokenKind: 'session' }).action).toBe('reauthenticate')
    }
  })

  it('a RECOGNISED reason still wins over the token kind', () => {
    // snowplow naming a specific fault is better information than the token kind. A step-up token
    // hitting a misconfigured cluster must still dead-end, not re-prompt.
    for (const reason of [AUTH_FAILURE_REASONS.stepUpNotEnabled, AUTH_FAILURE_REASONS.stepUpMisconfigured]) {
      expect(authFailureCauseOf(body(reason), { tokenKind: 'step-up' }).action).toBe('configuration-fault')
    }
    expect(authFailureCauseOf(body(AUTH_FAILURE_REASONS.issuanceFailed), { tokenKind: 'step-up' }).action).toBe('server-fault')
  })

  it('defaults to the session token, which is what every wired call site sends today', () => {
    expect(authFailureCauseOf({}).action).toBe('reauthenticate')
  })

  it('still accepts a bare origin string, so existing call sites keep working', () => {
    expect(authFailureCauseOf(body(AUTH_FAILURE_REASONS.staleAuthentication), 'step-up-exchange').action).toBe('step-up')
    expect(authFailureCauseOf(body(AUTH_FAILURE_REASONS.staleAuthentication), 'resource-401').action).toBe('reauthenticate')
  })

  // TOKEN-STATE REASONS (snowplow#1096). These describe the credential that was SENT, so the right
  // outcome depends on WHICH credential that was — the reason alone cannot say.

  it('a token-state reason on a SESSION request is a re-authenticate', () => {
    for (const reason of [AUTH_FAILURE_REASONS.tokenExpired, AUTH_FAILURE_REASONS.tokenInvalid, AUTH_FAILURE_REASONS.tokenMissing]) {
      expect(authFailureCauseOf(body(reason)).action, reason).toBe('reauthenticate')
      expect(authFailureCauseOf(body(reason)).reason, reason).toBe(reason)
    }
  })

  it('the SAME reason on a STEP-UP request is a step-up, never a session sign-in', () => {
    // The session credential was not what failed, so offering a sign-in form would ask the person
    // to fix something that is not broken — and would drop them out of a session still valid.
    for (const reason of [AUTH_FAILURE_REASONS.tokenExpired, AUTH_FAILURE_REASONS.tokenInvalid, AUTH_FAILURE_REASONS.tokenMissing]) {
      expect(authFailureCauseOf(body(reason), { tokenKind: 'step-up' }).action, reason).toBe('step-up')
    }
  })

  it('REGRESSION GUARD: a token-state reason must never be classified by a reason table', () => {
    // The trap this pins (snowplow#1096 review): adding these three to BY_REASON as
    // 'reauthenticate' makes `known` truthy, which skips the tokenKind step-up guard — so an
    // expired STEP-UP token would show a full sign-in for a session that never failed. Completing
    // the table looks like tidying. If this test fails, that is what happened.
    expect(authFailureCauseOf(body(AUTH_FAILURE_REASONS.tokenExpired), { tokenKind: 'step-up' }).action)
      .not.toBe('reauthenticate')
  })

  it('an ABSOLUTE reason still beats the token kind, which is the existing design', () => {
    // Not an oversight and not changed: a step-up request failing because the SESSION credential
    // is missing really is fixed by signing in again, even though the step-up token carried it.
    expect(authFailureCauseOf(body(AUTH_FAILURE_REASONS.sessionCredentialMissing), { tokenKind: 'step-up' }).action)
      .toBe('reauthenticate')
    // And a cluster that cannot do step-up at all stays an honest dead end rather than a prompt.
    expect(authFailureCauseOf(body(AUTH_FAILURE_REASONS.stepUpNotEnabled), { tokenKind: 'step-up' }).action)
      .toBe('configuration-fault')
  })

  it('StepUpRequired prompts a step-up; only the flow can call the second one a fault', () => {
    // snowplow emits StepUpRequired when a validated loa:2 token's step-up Secret was swept. A
    // fresh step-up makes authn reissue it, so the first one is not a fault.
    expect(authFailureCauseOf(body(AUTH_FAILURE_REASONS.stepUpRequired)).action).toBe('step-up')
    // A second one straight after a SUCCESSFUL step-up is a fault — but that needs attempt state,
    // which a pure classifier does not have. The flow counts and calls this.
    expect(stepUpCredentialStillMissing(AUTH_FAILURE_REASONS.stepUpRequired))
      .toEqual({ action: 'configuration-fault', reason: 'StepUpRequired' })
    expect(isUserActionable(stepUpCredentialStillMissing(AUTH_FAILURE_REASONS.stepUpRequired))).toBe(false)
  })

  it('KeyNotPublished (snowplow#1315) follows the token kind like the other token-state reasons', () => {
    // A retired signing key invalidates whichever token it signed. A session token is fixed by
    // signing in again; a step-up token by stepping up again — the session never failed.
    const reason = AUTH_FAILURE_REASONS.keyNotPublished
    expect(authFailureCauseOf(body(reason))).toEqual({ action: 'reauthenticate', reason })
    expect(authFailureCauseOf(body(reason), { tokenKind: 'step-up' })).toEqual({ action: 'step-up', reason })
  })

  it('token-state spellings are snowplow\'s exactly, and a casing slip degrades safely', () => {
    // Pinned as literals because snowplow's table is case-sensitive. A casing difference must not
    // throw or mis-route; it falls through to the safe default.
    expect(AUTH_FAILURE_REASONS.tokenExpired).toBe('TokenExpired')
    expect(AUTH_FAILURE_REASONS.tokenInvalid).toBe('TokenInvalid')
    expect(AUTH_FAILURE_REASONS.tokenMissing).toBe('TokenMissing')
    // As read from snowplow's merged credential_status.go (CauseKeyNotPublished, d328f6e).
    expect(AUTH_FAILURE_REASONS.keyNotPublished).toBe('KeyNotPublished')
    expect(authFailureCauseOf(body('tokenexpired'), { tokenKind: 'step-up' }).action).toBe('step-up')
    expect(authFailureCauseOf(body('tokenexpired')).action).toBe('reauthenticate')
  })
})
