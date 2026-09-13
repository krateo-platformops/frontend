import { describe, expect, it } from 'vitest'

import { CONFIRM_OUTRANKS_ALL, LAYER } from './layers'

/*
 * The trapped-gate bug is the reason this file exists: a publish confirm once opened BEHIND the
 * Autopilot preview and became untouchable, because both surfaces defaulted to antd's
 * `zIndexPopupBase` and the tie went to DOM order.
 *
 * These assertions are cheap and the failure they prevent is not: a page you cannot use.
 */
describe('overlay layer stack (C23)', () => {
  it('puts the blast-radius confirm above every other surface', () => {
    expect(CONFIRM_OUTRANKS_ALL).toBe(true)
    for (const [name, value] of Object.entries(LAYER)) {
      if (name === 'CONFIRM') { continue }
      expect(value, `${name} must sit below CONFIRM`).toBeLessThan(LAYER.CONFIRM)
    }
  })

  it('orders the surfaces: page drawer < preview < notifications < confirm', () => {
    expect(LAYER.DRAWER).toBeLessThan(LAYER.PREVIEW)
    expect(LAYER.PREVIEW).toBeLessThan(LAYER.NOTIFICATIONS)
    expect(LAYER.NOTIFICATIONS).toBeLessThan(LAYER.CONFIRM)
  })

  it('gives every surface a distinct value, so no ordering falls back to DOM order', () => {
    const values = Object.values(LAYER)
    expect(new Set(values).size).toBe(values.length)
  })
})
