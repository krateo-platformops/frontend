// @vitest-environment jsdom
/**
 * PageHeader `progress` (approved mockup; Diego's incident re-analysis that showed "no sign of life").
 * The start is a moment in the viewer's zone with the full date on hover ("Dates and ages", 2026-11-24),
 * the wait is an age the browser computes and ticks only while live, and a settled state shows its time
 * and nothing that moves.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatFull, formatMoment } from '../../utils/dateFormat'

import HeaderProgress from './HeaderProgress'

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

  it('live: label, the start as a moment in the viewer’s zone, the wait as an age, a live mark and the hint', () => {
    render(<HeaderProgress progress={{ hint: 'Usually 2–3 min; longer when the model is rate-limited.', label: 'Re-analysis since', live: true, since: '2026-11-21T11:54:15Z' }} />)
    const line = screen.getByText(/Re-analysis since/).closest('[data-page-header="progress"]')!
    expect(formatMoment('2026-11-21T11:54:15Z')).toMatch(/^21 Nov, \d{2}:54$/)
    expect(line.textContent).toContain(`Re-analysis since ${formatMoment('2026-11-21T11:54:15Z')} · 12 minutes`)
    expect(line.textContent).not.toContain('UTC')
    expect(line.textContent).toContain('live')
    expect(line.textContent).toContain('Usually 2–3 min; longer when the model is rate-limited.')
  })

  it('the start carries its full date on hover and focus', () => {
    const { container } = render(<HeaderProgress progress={{ label: 'Resolved at', since: '2026-11-21T12:21:24Z' }} />)
    const time = container.querySelector('time')!
    expect(time.getAttribute('dateTime')).toBe('2026-11-21T12:21:24.000Z')
    expect(formatFull('2026-11-21T12:21:24Z')).toMatch(/^Sat 21 November 2026, \d{2}:21:24 \(UTC([+-]\d+(:\d{2})?)?\)$/)
  })

  it('the wait ticks in the browser while live', () => {
    render(<HeaderProgress progress={{ label: 'Re-analysis since', live: true, since: '2026-11-21T11:54:15Z' }} />)
    act(() => { vi.advanceTimersByTime(5 * 60_000) })
    expect(screen.getByText('17 minutes')).toBeTruthy()
  })

  it('settled: the time only, no wait, no live mark, no hint, nothing ticking', () => {
    const { container } = render(<HeaderProgress progress={{ hint: 'never shown', label: 'Resolved at', since: '2026-11-21T12:21:24Z' }} />)
    const settled = `Resolved at ${formatMoment('2026-11-21T12:21:24Z')}`
    expect(container.textContent).toBe(settled)
    act(() => { vi.advanceTimersByTime(30 * 60_000) })
    expect(container.textContent).toBe(settled)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('an unparseable time renders nothing rather than "NaN"', () => {
    const { container } = render(<HeaderProgress progress={{ label: 'Re-analysis since', live: true, since: 'soon' }} />)
    expect(container.innerHTML).toBe('')
  })

  it('a long wait reads as an age in words, not "7 d 23 h" (krateo-057’s incident 8 days in Verifying)', () => {
    const since = new Date(NOW - 11_501 * 60_000).toISOString()
    const { container } = render(<HeaderProgress progress={{ label: 'Verifying since', live: true, since }} />)
    expect(container.textContent).toContain(' · 1 week')
  })

  it('a start a little ahead of the browser’s clock is a wait just begun, never negative', () => {
    const { container } = render(<HeaderProgress progress={{ label: 'Re-analysis since', live: true, since: '2026-11-21T12:10:00Z' }} />)
    expect(container.textContent).toContain(' · just now')
  })
})
