import { describe, expect, it } from 'vitest'

import { AGENT_SUBMITTABLE_LABEL, mayAgentDispatch } from './actionBridge'

/**
 * A form's submit action lives in `widgetData.actions` — the same map lookupAction scans — so
 * `runAction` could dispatch it by id and the portal's stated invariant, "Autopilot never
 * submits", was already untrue. Submits are now default-closed and opt in per widget.
 */
const widget = (over: Record<string, unknown> = {}, labels?: Record<string, string>) => ({
  metadata: labels ? { labels, name: 'w' } : { name: 'w' },
  spec: { widgetData: { submitActionId: 'submit', ...over } },
})

describe('mayAgentDispatch — which actions the agent may trigger', () => {
  it('allows an ordinary action: pressing a button the user can see is the whole capability', () => {
    expect(mayAgentDispatch(widget(), 'toggle-pause')).toBe(true)
  })

  it('REFUSES a submit on a widget with no label — default closed', () => {
    expect(mayAgentDispatch(widget(), 'submit')).toBe(false)
  })

  it('allows a submit once the widget opts in', () => {
    expect(mayAgentDispatch(widget({}, { [AGENT_SUBMITTABLE_LABEL]: 'true' }), 'submit')).toBe(true)
  })

  it('fails CLOSED on anything that is not exactly "true"', () => {
    for (const value of ['True', 'yes', '1', '', 'false']) {
      expect(mayAgentDispatch(widget({}, { [AGENT_SUBMITTABLE_LABEL]: value }), 'submit')).toBe(false)
    }
  })

  it('covers a selector-routed submit, not just the static id', () => {
    // submitActionSelector picks the action at submit time from a field value, so gating only
    // submitActionId would leave every conditional submit wide open.
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
