import { describe, expect, it } from 'vitest'

import { SUBMIT_REFUSED, mayAgentDispatch } from './actionBridge'

/**
 * "The agent must never submit anything" (owner, 2026-09-15).
 *
 * This was reachable by accident: a Form's submit action lives in `widgetData.actions` — the same
 * map lookupAction scans — so runAction could dispatch it by id, and the invariant held only
 * because nothing had asked the model to try. These pin the refusal, and pin that it is
 * UNCONDITIONAL: there is no label, flag or field that turns it back on.
 */
const widget = (over: Record<string, unknown> = {}, labels?: Record<string, string>) => ({
  metadata: labels ? { labels, name: 'w' } : { name: 'w' },
  spec: { widgetData: { submitActionId: 'submit', ...over } },
})

describe('mayAgentDispatch — the agent never submits', () => {
  it('allows an ordinary action: pressing a button the user can see is the whole capability', () => {
    expect(mayAgentDispatch(widget(), 'toggle-pause')).toBe(true)
  })

  it('REFUSES a form submit', () => {
    expect(mayAgentDispatch(widget(), 'submit')).toBe(false)
  })

  it('still refuses when a widget tries to opt in by label — there is no opt-in', () => {
    // The label was briefly the mechanism. It is not one now: a permission that can be granted
    // acquires an exception the first time someone is in a hurry, which is the opposite of
    // "never". A lint in portal-kpo fails the build if any widget carries it.
    const opted = widget({}, { 'krateo.io/agent-submittable': 'true' })
    expect(mayAgentDispatch(opted, 'submit')).toBe(false)
  })

  it('refuses a selector-routed submit, not just the static id', () => {
    // submitActionSelector picks the action at submit time from a field value, so refusing only
    // submitActionId would leave every conditional submit reachable.
    const form = widget({ submitActionId: undefined, submitActionSelector: { default: 'post-local', map: { remote: 'post-remote' } } })
    expect(mayAgentDispatch(form, 'post-local')).toBe(false)
    expect(mayAgentDispatch(form, 'post-remote')).toBe(false)
    expect(mayAgentDispatch(form, 'some-button')).toBe(true)
  })

  it('reads the RESOLVED status widgetData when present, like the renderer does', () => {
    const form = { metadata: { name: 'w' }, spec: { widgetData: {} }, status: { widgetData: { submitActionId: 'go' } } }
    expect(mayAgentDispatch(form, 'go')).toBe(false)
  })
})

describe('a refused submit is reported as a REFUSAL, not as a missing control', () => {
  it('SUBMIT_REFUSED is a distinct signal from null', () => {
    // They shared `null`, so the bridge told the user "no control submit on create-form" about a
    // button plainly on screen. A18: a verb that cannot act says so — saying something FALSE
    // instead sends the person hunting for a control that is right in front of them.
    expect(SUBMIT_REFUSED).not.toBeNull()
    expect(typeof SUBMIT_REFUSED).toBe('string')
  })
})
