// @vitest-environment jsdom
/**
 * `xTimeUnit` on a BarChart (audit TIME-2; approved design "Dates and ages", 2026-11-24). Token usage's bars
 * were labelled by a server strftime in UTC ("Mon 14:00") while the text beside them, and every line chart,
 * read another hour. The RESTAction now sends epochs and the chart labels them in the viewer's zone with the
 * shared formatter. G2 draws to a canvas, so what the widget hands it is read here.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatFull, formatMoment } from '../../utils/dateFormat'

import type { BarChartWidgetData } from './BarChart'
import BarChart, { barTimeLabels, barTimeTitle } from './BarChart'

const { columnProps } = vi.hoisted(() => ({ columnProps: [] as Record<string, unknown>[] }))
vi.mock('@ant-design/plots', () => ({
  Column: (props: Record<string, unknown>) => {
    columnProps.push(props)
    return null
  },
}))
vi.mock('../../hooks/useMeasuredWidth', () => ({ useMeasuredWidth: () => ({ ref: () => undefined, width: 600 }) }))

/** A local moment, as the epoch seconds a RESTAction sends. */
const at = (month: number, day: number, hour: number, year = 2026) => new Date(year, month, day, hour).getTime() / 1000

interface Drawn {
  axis: { x: { labelFill?: string; labelFormatter?: (value: unknown) => unknown } }
  data: { x: unknown }[]
  tooltip?: { title: (row: object) => unknown }
}
const draw = (over: Partial<BarChartWidgetData>): Drawn => {
  render(<BarChart resourcesRefs={{ items: [] }} uid='b' widget={{} as never} widgetData={{ data: [], xField: 'x', xTimeUnit: 'hour', yField: 'y', ...over }} />)
  return columnProps.at(-1) as unknown as Drawn
}

beforeEach(() => {
  columnProps.length = 0
  vi.useFakeTimers({ now: new Date(2026, 10, 25, 12), toFake: ['Date'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('BarChart on a time axis', () => {
  it('hourly bars: the clock, and the day where it changes', () => {
    const epochs = [at(10, 24, 22), at(10, 24, 23), at(10, 25, 0), at(10, 25, 1)]
    expect([...barTimeLabels(epochs, 'hour').values()]).toEqual([formatMoment(new Date(2026, 10, 24, 22)), '23:00', '25 Nov', '01:00'])
    expect(formatMoment(new Date(2026, 10, 24, 22))).toBe('24 Nov, 22:00')
  })

  it('a new day that does not start at midnight names its day and its hour', () => {
    expect([...barTimeLabels([at(10, 24, 21), at(10, 25, 3)], 'hour').values()]).toEqual(['24 Nov, 21:00', '25 Nov, 03:00'])
  })

  it('daily bars: each its day, with the year when it is another year', () => {
    expect([...barTimeLabels([at(11, 31, 0, 2025), at(0, 1, 0), at(10, 24, 0)], 'day').values()]).toEqual(['31 Dec 2025', '1 Jan', '24 Nov'])
  })

  it('stacked series share one bucket: one label per epoch, in time order whatever the row order', () => {
    const labels = barTimeLabels([at(10, 24, 23), at(10, 24, 22), at(10, 24, 23), 'not a time'], 'hour')
    expect([...labels.keys()]).toEqual([at(10, 24, 22), at(10, 24, 23)])
  })

  it('the widget keeps the epochs as numbers (a band keys its bars by value) and labels them', () => {
    const data = [{ s: 'a', x: at(10, 24, 23), y: 1 }, { s: 'b', x: at(10, 24, 23), y: 2 }, { s: 'a', x: at(10, 25, 0), y: 3 }]
    const drawn = draw({ colorField: 's', data, stack: true })
    expect(drawn.data).toEqual(data)
    expect([drawn.axis.x.labelFormatter?.(at(10, 24, 23)), drawn.axis.x.labelFormatter?.(at(10, 25, 0))]).toEqual(['24 Nov, 23:00', '25 Nov'])
    expect(drawn.axis.x.labelFill).toBeTruthy()
  })

  it('the tooltip is the full date with the viewer’s zone, as every time’s hover is', () => {
    const drawn = draw({ data: [{ x: at(10, 24, 14), y: 1 }] })
    const title = drawn.tooltip?.title({ x: at(10, 24, 14) })
    expect(title).toBe(formatFull(new Date(2026, 10, 24, 14)))
    expect(title).toMatch(/^Tue 24 November 2026, 14:00:00 \(UTC([+-]\d+(:\d{2})?)?\)$/)
    expect(barTimeTitle(at(10, 24, 14), 'day')).toBe('Tue 24 November 2026')
  })

  it('without xTimeUnit the server’s labels pass through, with nothing of a time axis', () => {
    const drawn = draw({ data: [{ x: 'Mon 14:00', y: 1 }], xTimeUnit: undefined })
    expect(drawn.data).toEqual([{ x: 'Mon 14:00', y: 1 }])
    expect([drawn.axis.x.labelFormatter, drawn.tooltip]).toEqual([undefined, undefined])
    expect(Object.keys(columnProps.at(-1)!)).not.toContain('tooltip')
  })
})
