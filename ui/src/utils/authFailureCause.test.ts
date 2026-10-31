/**
 * `authFailureCauseOf` — which of the three outcomes a 401 maps to.
 *
 * The case that matters most is `StepUpNotEnabled` / `StepUpMisconfigured` mapping to
 * `configuration-fault` rather than `step-up`. Getting that wrong shows the person a prompt that
 * cannot succeed: they re-authenticate, get the same 401, and loop forever while the real fault —
 * a cluster setting — is reported to nobody.
 */
import { describe, expect, it } from 'vitest'

import { AUTH_FAILURE_REASONS, authFailureCauseOf, isUserActionable } from './authFailureCause'

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
