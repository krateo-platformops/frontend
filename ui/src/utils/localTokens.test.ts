import { afterEach, describe, expect, it, vi } from 'vitest'

import { DISPLAY_NAME_FALLBACK, DISPLAY_NAME_TOKEN, LOCAL_TIME_OF_DAY_TOKEN, localTimeOfDay, resolveLocalTokens, viewerDisplayName } from './localTokens'

/** A Date at a fixed LOCAL hour (minutes/seconds irrelevant to the bucketing). */
const atHour = (hour: number): Date => new Date(2026, 0, 1, hour, 0, 0)

describe('localTimeOfDay', () => {
  it('buckets <12 as morning', () => {
    expect(localTimeOfDay(atHour(0))).toBe('morning')
    expect(localTimeOfDay(atHour(9))).toBe('morning')
    expect(localTimeOfDay(atHour(11))).toBe('morning')
  })

  it('buckets 12..17 as afternoon', () => {
    expect(localTimeOfDay(atHour(12))).toBe('afternoon')
    expect(localTimeOfDay(atHour(14))).toBe('afternoon')
    expect(localTimeOfDay(atHour(17))).toBe('afternoon')
  })

  it('buckets >=18 as evening', () => {
    expect(localTimeOfDay(atHour(18))).toBe('evening')
    expect(localTimeOfDay(atHour(23))).toBe('evening')
  })
})

describe('resolveLocalTokens', () => {
  it('replaces the {localTimeOfDay} token with the current browser-local bucket', () => {
    // The greeting case: jq emits "Good {localTimeOfDay}, Admin"; the widget resolves it
    // client-side so it reflects the viewer's clock, not snowplow's frozen server `now`.
    const out = resolveLocalTokens(`Good ${LOCAL_TIME_OF_DAY_TOKEN}, Admin`)
    expect(out).toMatch(/^Good (morning|afternoon|evening), Admin$/)
    expect(out).not.toContain(LOCAL_TIME_OF_DAY_TOKEN)
  })

  it('replaces EVERY occurrence of the token', () => {
    const out = resolveLocalTokens(`${LOCAL_TIME_OF_DAY_TOKEN}/${LOCAL_TIME_OF_DAY_TOKEN}`)
    expect(out).not.toContain(LOCAL_TIME_OF_DAY_TOKEN)
    expect(out).toMatch(/^(morning|afternoon|evening)\/(morning|afternoon|evening)$/)
  })

  it('returns token-free text unchanged (no needless allocation path)', () => {
    expect(resolveLocalTokens('Welcome')).toBe('Welcome')
  })

  it('passes a non-string (undefined) through unchanged', () => {
    expect(resolveLocalTokens(undefined)).toBeUndefined()
  })
})

describe('viewerDisplayName (pure name-or-fallback)', () => {
  it('returns the displayName when it is a non-blank string', () => {
    expect(viewerDisplayName('Diego')).toBe('Diego')
  })

  it('falls back to "there" for undefined / empty / whitespace-only', () => {
    expect(viewerDisplayName(undefined)).toBe(DISPLAY_NAME_FALLBACK)
    expect(viewerDisplayName('')).toBe(DISPLAY_NAME_FALLBACK)
    expect(viewerDisplayName('   ')).toBe(DISPLAY_NAME_FALLBACK)
  })
})

// A5 greeting client-render: under api.SNOWPLOW_IDENTITY_INJECTION the frontend stops volunteering
// identity to snowplow, so the greeting name is resolved in the browser from the login state
// (localStorage `K_user` via getUserInfo). The node test env has no localStorage → stub getItem.
const stubUser = (displayName?: string) => {
  const raw = displayName === undefined ? null : JSON.stringify({ user: { displayName } })
  vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'K_user' ? raw : null) })
}

describe('resolveLocalTokens — {displayName} (greeting client-render)', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('replaces {displayName} with the login name from localStorage', () => {
    stubUser('Diego')
    const out = resolveLocalTokens(`Good ${LOCAL_TIME_OF_DAY_TOKEN}, ${DISPLAY_NAME_TOKEN}`)
    expect(out).toMatch(/^Good (morning|afternoon|evening), Diego$/)
    expect(out).not.toContain(DISPLAY_NAME_TOKEN)
  })

  it('falls back to "Good <bucket>, there" when logged out (matches chart .displayName // "there")', () => {
    stubUser(undefined)
    expect(resolveLocalTokens(`Good ${LOCAL_TIME_OF_DAY_TOKEN}, ${DISPLAY_NAME_TOKEN}`))
      .toMatch(/^Good (morning|afternoon|evening), there$/)
  })
})
