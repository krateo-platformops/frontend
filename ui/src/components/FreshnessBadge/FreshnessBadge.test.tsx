import { describe, expect, it } from 'vitest'

import { deriveFreshnessState, formatRelative } from './FreshnessBadge'

const NOW = 1_000_000_000_000

describe('formatRelative', () => {
  it('returns "never" when never fetched', () => {
    expect(formatRelative(0, NOW)).toBe('never')
    expect(formatRelative(-1, NOW)).toBe('never')
  })

  it('returns "just now" under a minute', () => {
    expect(formatRelative(NOW - 2_000, NOW)).toBe('just now')
    expect(formatRelative(NOW - 30_000, NOW)).toBe('just now')
  })

  it('says minutes, hours and days in words, as every time-ago does ("Dates and ages")', () => {
    expect(formatRelative(NOW - 60_000, NOW)).toBe('1 minute ago')
    expect(formatRelative(NOW - 2 * 60_000, NOW)).toBe('2 minutes ago')
    expect(formatRelative(NOW - 3 * 60 * 60_000, NOW)).toBe('3 hours ago')
    expect(formatRelative(NOW - 4 * 24 * 60 * 60_000, NOW)).toBe('4 days ago')
  })

  it('never returns a negative delta (clock skew guard)', () => {
    expect(formatRelative(NOW + 10_000, NOW)).toBe('just now')
    expect(formatRelative(NOW + 10 * 60_000, NOW)).toBe('just now')
  })
})

describe('deriveFreshnessState — the four-state matrix', () => {
  it('LIVE: armed, not stale, not fetching → cyan dot', () => {
    const state = deriveFreshnessState({ dataUpdatedAt: NOW, isFetching: false, isStale: false, liveArmed: true }, NOW)
    expect(state.tone).toBe('live')
    expect(state.label).toBe('Live')
    expect(state.showDot).toBe(true)
  })

  it('REFRESHING: fetching with prior data → amber, keeps old data, no dot', () => {
    const state = deriveFreshnessState({ dataUpdatedAt: NOW - 60_000, isFetching: true, isStale: true, liveArmed: true }, NOW)
    expect(state.tone).toBe('refreshing')
    expect(state.label).toBe('Refreshing…')
    expect(state.showDot).toBe(false)
  })

  it('REFRESHING wins over LIVE while a background fetch is in flight', () => {
    const state = deriveFreshnessState({ dataUpdatedAt: NOW, isFetching: true, isStale: false, liveArmed: true }, NOW)
    expect(state.tone).toBe('refreshing')
  })

  it('STALE: stale, not fetching → muted with relative time', () => {
    const state = deriveFreshnessState({ dataUpdatedAt: NOW - 2 * 60_000, isFetching: false, isStale: true, liveArmed: false }, NOW)
    expect(state.tone).toBe('stale')
    expect(state.label).toBe('Stale · 2 minutes ago')
    expect(state.showDot).toBe(false)
  })

  it('UPDATED (fallback): fresh but not live-armed → muted "Updated Nm ago"', () => {
    const state = deriveFreshnessState({ dataUpdatedAt: NOW - 5 * 60_000, isFetching: false, isStale: false, liveArmed: false }, NOW)
    expect(state.tone).toBe('stale')
    expect(state.label).toBe('Updated 5 minutes ago')
  })

  it('relative time advances with the clock without any refetch', () => {
    const props = { dataUpdatedAt: NOW, isFetching: false, isStale: true, liveArmed: false }
    expect(deriveFreshnessState(props, NOW + 60_000).label).toBe('Stale · 1 minute ago')
    expect(deriveFreshnessState(props, NOW + 120_000).label).toBe('Stale · 2 minutes ago')
  })
})
