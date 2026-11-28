// @vitest-environment jsdom
/**
 * §6 (audit): a Statistic must distinguish a GENUINE computed value (including 0) from
 * data-missing. A null/undefined/empty value renders a muted em-dash; a real 0 renders "0".
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Statistic from './Statistic'
import type { StatisticWidgetData } from './Statistic'

afterEach(cleanup)

function renderStat(data: Partial<StatisticWidgetData>) {
  const { container } = render(
    <Statistic
      resourcesRefs={{ items: [] }}
      uid='s'
      widget={{} as never}
      widgetData={{ ...data } as StatisticWidgetData}
    />,
  )
  return container.querySelector('.ant-statistic-content') as HTMLElement
}

describe('Statistic widget — genuine 0 vs data-missing (audit §6)', () => {
  it('a genuine 0 renders as "0" (not a missing marker)', () => {
    const el = renderStat({ value: 0 })
    expect(el.textContent).toContain('0')
    expect(el.textContent).not.toContain('—')
  })

  it('an empty value renders the muted em-dash', () => {
    const el = renderStat({ value: '' })
    expect(el.textContent).toContain('—')
  })

  it('a real numeric value renders normally', () => {
    const el = renderStat({ value: 42 })
    expect(el.textContent).toContain('42')
  })
})

describe('Statistic `format` ("Dates and ages", 2026-11-24)', () => {
  const NOW = Date.parse('2026-11-25T15:00:00Z')
  beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('an ISO value is written in its form, in the browser: never a jq "5m ago" frozen in the cache', () => {
    const el = renderStat({ format: 'ago', value: '2026-11-25T14:55:00Z' })
    expect(el.textContent).toBe('5 minutes ago')
    expect(el.querySelector('time')?.getAttribute('dateTime')).toBe('2026-11-25T14:55:00.000Z')
  })

  it('a value that is not a time, or no format, is shown as it came', () => {
    expect(renderStat({ format: 'ago', value: '5m ago' }).textContent).toBe('5m ago')
    cleanup()
    expect(renderStat({ value: '2026-11-25T14:55:00Z' }).querySelector('time')).toBeNull()
  })
})
