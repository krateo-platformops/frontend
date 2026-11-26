// @vitest-environment jsdom
/**
 * Every time on screen carries its full date on hover AND focus (approved design "Dates and ages",
 * 2026-11-24): "Wed 4 November 2026, 11:10:27 (UTC+1)", in the viewer's zone. A value that is not a time
 * is shown as it came, with no tooltip and no tab stop.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatFull } from '../../utils/dateFormat'

import TimeText from './TimeText'

vi.stubGlobal('ResizeObserver', class { disconnect = vi.fn(); observe = vi.fn(); unobserve = vi.fn() })

const NOW = Date.parse('2026-11-25T15:00:00Z')
const AT = '2026-11-04T10:10:27Z'

beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date'] }) })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const tooltip = () => document.querySelector('.ant-tooltip:not(.ant-tooltip-hidden)')

describe('TimeText', () => {
  it('writes the form, and holds the instant in a <time>', () => {
    render(<TimeText form='age' value={AT} />)
    const time = screen.getByText('3 weeks')
    expect(time.tagName).toBe('TIME')
    expect(time.getAttribute('dateTime')).toBe('2026-11-04T10:10:27.000Z')
  })

  it('hover shows the full date', async () => {
    render(<TimeText form='ago' value={AT} />)
    fireEvent.mouseEnter(screen.getByText('3 weeks ago'))
    await waitFor(() => { expect(tooltip()?.textContent).toBe(formatFull(AT)) })
    expect(formatFull(AT)).toMatch(/^Wed 4 November 2026, \d{2}:10:27 \(UTC([+-]\d+(:\d{2})?)?\)$/)
  })

  it('keyboard focus shows it too, and Escape closes it where focus stays', async () => {
    render(<TimeText form='moment' value={AT} />)
    const time = screen.getByText(/^4 Nov, \d{2}:10$/)
    expect(time.getAttribute('tabindex')).toBe('0')
    const matches = vi.spyOn(time, 'matches').mockReturnValue(true)
    act(() => { time.focus() })
    await waitFor(() => { expect(tooltip()?.textContent).toBe(formatFull(AT)) })
    fireEvent.keyDown(time, { key: 'Escape' })
    await waitFor(() => { expect(tooltip()).toBeNull() })
    matches.mockRestore()
  })

  it('a caller’s own text is kept', () => {
    render(<TimeText form='age' value={AT}>3 weeks</TimeText>)
    expect(screen.getByText('3 weeks').tagName).toBe('TIME')
  })

  it('a value that is not a time: as it came, no tooltip, no tab stop', () => {
    const { container } = render(<TimeText form='age' value='49d ago' />)
    expect(container.innerHTML).toBe('<span>49d ago</span>')
  })
})
