/**
 * `authFailureCauseOf` — which of the three outcomes a 401 maps to.
 *
 * The case that matters most is `StepUpNotEnabled` / `StepUpMisconfigured` mapping to
 * `configuration-fault` rather than `step-up`. Getting that wrong shows the person a prompt that
 * cannot succeed: they re-authenticate, get the same 401, and loop forever while the real fault —
 * a cluster setting — is reported to nobody.
 */
import { describe, expect, it } from 'vitest'

import { accountCannotReachLevel, AUTH_FAILURE_REASONS, authFailureCauseOf, isUserActionable } from './authFailureCause'

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
