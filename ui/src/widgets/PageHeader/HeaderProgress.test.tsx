// @vitest-environment jsdom
/**
 * PageHeader `progress` (approved mockup; Diego's incident re-analysis that showed "no sign of life").
 * The times are absolute (HH:MM UTC), the minutes are the browser's own and tick only while live, and
 * a settled state shows its time and nothing that moves.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HeaderProgress, { clockLabel, elapsedLabel, elapsedMinutes } from './HeaderProgress'

const NOW = Date.parse('2026-11-21T12:06:15Z')

describe('HeaderProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('live: label, the start as HH:MM UTC, the elapsed minutes, a live mark and the hint', () => {
    render(<HeaderProgress progress={{ hint: 'Usually 2–3 min; longer when the model is rate-limited.', label: 'Re-analysis since', live: true, since: '2026-11-21T11:54:15Z' }} />)
    const line = screen.getByText(/Re-analysis since/).closest('[data-page-header="progress"]')!
    expect(line.textContent).toContain('Re-analysis since 11:54 UTC · 12 min')
    expect(line.textContent).toContain('live')
    expect(line.textContent).toContain('Usually 2–3 min; longer when the model is rate-limited.')
  })

  it('the minutes tick in the browser while live', () => {
    render(<HeaderProgress progress={{ label: 'Re-analysis since', live: true, since: '2026-11-21T11:54:15Z' }} />)
    act(() => { vi.advanceTimersByTime(5 * 60_000) })
    expect(screen.getByText(/17 min/)).toBeTruthy()
  })

  it('settled: the time only, no minutes, no live mark, no hint, nothing ticking', () => {
    const { container } = render(<HeaderProgress progress={{ hint: 'never shown', label: 'Resolved at', since: '2026-11-21T12:21:24Z' }} />)
    expect(container.textContent).toBe('Resolved at 12:21 UTC')
    act(() => { vi.advanceTimersByTime(30 * 60_000) })
    expect(container.textContent).toBe('Resolved at 12:21 UTC')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('an unparseable time renders nothing rather than "NaN"', () => {
    const { container } = render(<HeaderProgress progress={{ label: 'Re-analysis since', live: true, since: 'soon' }} />)
    expect(container.innerHTML).toBe('')
  })

  it('elapsed reads in the two largest units: minutes, then hours, then days', () => {
    expect(elapsedLabel(0)).toBe('0 min')
    expect(elapsedLabel(59)).toBe('59 min')
    expect(elapsedLabel(60)).toBe('1 h')
    expect(elapsedLabel(192)).toBe('3 h 12 min')
    expect(elapsedLabel(24 * 60 - 1)).toBe('23 h 59 min')
    expect(elapsedLabel(24 * 60)).toBe('1 d')
    // krateo-057's incident 8 days in Verifying, which read "11501 min".
    expect(elapsedLabel(11_501)).toBe('7 d 23 h')
    expect(elapsedLabel(8 * 24 * 60 + 2 * 60 + 7)).toBe('8 d 2 h')
  })

  it('a start on an earlier day carries its date; elapsed is never negative', () => {
    expect(clockLabel('2026-11-20T15:32:17Z', NOW)).toBe('2026-11-20 15:32 UTC')
    expect(clockLabel('2026-11-21T11:54:15Z', NOW)).toBe('11:54 UTC')
    expect(elapsedMinutes('2026-11-21T12:10:00Z', NOW)).toBe(0)
  })
})
