/**
 * `authFailurePresentation` — and above all `showAuthForm`.
 *
 * `showAuthForm: false` for a configuration fault is the behaviour this whole change exists for.
 * If it ever flips to true, the portal shows a sign-in form for a cluster that cannot issue the
 * credential, and the person re-authenticates in a loop that can never succeed.
 */
import { describe, expect, it } from 'vitest'

import { AUTH_FAILURE_REASONS } from './authFailureCause'
import { authFailurePresentation } from './authFailureCopy'

describe('a configuration fault offers NO sign-in form', () => {
  it('shows no form for either misconfiguration reason', () => {
    for (const reason of [AUTH_FAILURE_REASONS.stepUpNotEnabled, AUTH_FAILURE_REASONS.stepUpMisconfigured]) {
      const shown = authFailurePresentation({ action: 'configuration-fault', reason })
      expect(shown.showAuthForm).toBe(false)
      expect(shown.title).toBe('Elevated access is not configured')
    }
  })

  it('says signing in again will NOT help, and names who can fix it', () => {
    const { description } = authFailurePresentation({ action: 'configuration-fault', reason: 'StepUpNotEnabled' })
    expect(description).toMatch(/will not help/i)
    expect(description).toMatch(/administrator/i)
  })

  it('does not apologise or tell the person to try later', () => {
    const { description } = authFailurePresentation({ action: 'configuration-fault', reason: null })
    expect(description).not.toMatch(/sorry|oops|try (again )?later/i)
  })
})

describe('the two actionable outcomes DO offer the form', () => {
  it('step-up asks for additional verification', () => {
    const shown = authFailurePresentation({ action: 'step-up', reason: AUTH_FAILURE_REASONS.stepUpRequired })
    expect(shown.showAuthForm).toBe(true)
    expect(shown.title).toBe('Additional verification required')
  })

  it('reauthenticate keeps the wording the portal already used', () => {
    const shown = authFailurePresentation({ action: 'reauthenticate', reason: null })
    expect(shown.showAuthForm).toBe(true)
    expect(shown.title).toBe('Session expired')
    expect(shown.description).toContain('right where you left off')
  })

  it('a step-up surface does NOT claim the session expired — it has not', () => {
    const shown = authFailurePresentation({ action: 'step-up', reason: AUTH_FAILURE_REASONS.insufficientAssurance })
    expect(shown.title).not.toMatch(/expired/i)
    expect(shown.description).not.toMatch(/expired/i)
  })
})

describe('IssuanceFailed is a server fault, not a configuration fault and not their session', () => {
  it('offers no form, and does not blame a setting or the account', () => {
    const shown = authFailurePresentation({ action: 'server-fault', reason: AUTH_FAILURE_REASONS.issuanceFailed })
    expect(shown.showAuthForm).toBe(false)
    // Saying "ask an administrator to configure step-up" would send them to fix something that is
    // already correct — the cluster IS configured, and issuance failed anyway.
    expect(shown.description).not.toMatch(/configure/i)
    expect(shown.description).toMatch(/not a problem with your account/i)
    expect(shown.title).not.toMatch(/expired|not configured/i)
  })
})
