// @vitest-environment jsdom
/**
 * BarChart's zero hairline and `slotField` (approved charts mockup, 2026-11-25; audit CHART-1, CHART-3). G2 draws to
 * a canvas, so what the widget hands it is read here: the per-bar style G2 evaluates for each row, the marks and the
 * tooltip. The drawing and the hovers were looked at in a browser.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getColorCode } from '../../theme/palette'

import type { BarChartWidgetData } from './BarChart'
import BarChart from './BarChart'

const { columnProps } = vi.hoisted(() => ({ columnProps: [] as Record<string, unknown>[] }))
vi.mock('@ant-design/plots', () => ({
  Column: (props: Record<string, unknown>) => {
    columnProps.push(props)
    return null
  },
}))
vi.mock('../../hooks/useMeasuredWidth', () => ({ useMeasuredWidth: () => ({ ref: () => undefined, width: 600 }) }))

type Row = Record<string, unknown>
type StyleFn = (row: Row) => unknown
interface Drawn {
  annotations?: { data: Row[]; encode: Record<string, unknown>; labels?: { text: () => string }[]; style: Record<string, unknown>; type: string }[]
  data: Row[]
  interaction?: { tooltip: { filter: (item: { value?: unknown }) => boolean } }
  style: Record<string, StyleFn>
  tooltip?: { items?: ((row: Row) => unknown)[]; title: (row: Row) => unknown }
}
const draw = (over: Partial<BarChartWidgetData>): Drawn => {
  render(<BarChart resourcesRefs={{ items: [] }} uid='b' widget={{} as never} widgetData={{ data: [], xField: 'x', yField: 'y', ...over }} />)
  return columnProps.at(-1) as unknown as Drawn
}
/** The style G2 gives one row's bar: every callback evaluated, the ones that leave the default (undefined) left out. */
const styleOf = (drawn: Drawn, row: Row): Record<string, unknown> => Object.fromEntries(
  Object.entries(drawn.style).map(([key, fn]): [string, unknown] => [key, fn(row)]).filter(([, value]) => value !== undefined),
)

const at = (date: number, hour = 0) => new Date(2026, 10, date, hour).getTime() / 1000

beforeEach(() => {
  columnProps.length = 0
  vi.useFakeTimers({ now: new Date(2026, 10, 25, 12), toFake: ['Date'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('BarChart: a measured zero', () => {
  it('is a 2px hairline on the baseline in the neutral grey, never the series colour; other bars are untouched', () => {
    const drawn = draw({ data: [{ x: 'a', y: 0 }, { x: 'b', y: 3 }] })
    expect(styleOf(drawn, { x: 'a', y: 0 })).toEqual({ fill: getColorCode('faint'), minHeight: 2 })
    expect(styleOf(drawn, { x: 'b', y: 3 })).toEqual({})
  })

  it('in a stack, only where the whole stack is zero (a zero inside a stack with height is no bar)', () => {
    const data = [{ k: 'p', x: 'a', y: 0 }, { k: 'q', x: 'a', y: 2 }, { k: 'p', x: 'b', y: 0 }, { k: 'q', x: 'b', y: 0 }]
    const drawn = draw({ colorField: 'k', data, stack: true })
    expect(styleOf(drawn, data[0])).toEqual({})
    expect(styleOf(drawn, data[2]).minHeight).toBe(2)
  })
})

describe('BarChart slotField', () => {
  const DAYS = [
    { s: 'Opened', x: at(23), y: 3 }, { s: 'Resolved', x: at(23), y: 0 },
    { s: 'Opened', slot: 'missing', x: at(24), y: null }, { s: 'Resolved', slot: 'missing', x: at(24) },
    { s: 'Opened', slot: 'partial', x: at(25), y: 2 }, { s: 'Resolved', slot: 'partial', x: at(25), y: 0 },
  ]
  const drawDays = () => draw({ colorField: 's', data: DAYS, group: true, slotField: 'slot', xTimeUnit: 'day' })

  it('a bar still filling: a faint fill in a dashed outline of its own colour (stroke left to G2: the series colour)', () => {
    const drawn = drawDays()
    expect(styleOf(drawn, DAYS[4])).toEqual({ fillOpacity: 0.18, lineDash: [3, 2], lineWidth: 1.3 })
    expect(styleOf(drawn, DAYS[5])).toEqual({ fill: getColorCode('faint'), fillOpacity: 0.18, lineDash: [3, 2], lineWidth: 1.3, minHeight: 2, stroke: getColorCode('faint') })
  })

  it('a slot with no data draws no bar and no hairline, but keeps its rows so its column still answers a hover', () => {
    const drawn = drawDays()
    expect(drawn.data.filter((row) => row.slot === 'missing').map((row) => row.y)).toEqual([0, 0])
    expect(styleOf(drawn, drawn.data[2])).toEqual({ fillOpacity: 0 })
  })

  it('a hatched "No data" band over the slot, and "so far" over the bars still filling', () => {
    const marks = drawDays().annotations ?? []
    const band = marks.find((mark) => mark.type === 'rangeX')!
    expect(Object.values(band.data[0])).toEqual([at(24), at(24)])
    expect(band.labels?.[0].text()).toBe('No data')
    const label = marks.find((mark) => mark.type === 'text')!
    expect([label.style.text, label.data.map((row) => row.x)]).toEqual(['so far', [at(25)]])
  })

  it('on hover: the band is its days with no value under it; the bars still filling end "so far"', () => {
    const drawn = drawDays()
    expect(drawn.tooltip?.title(drawn.data[2])).toBe('No data · 24 Nov')
    expect(drawn.tooltip?.items?.[0](drawn.data[2])).toBeNull()
    expect(drawn.interaction?.tooltip.filter({ value: null })).toBe(false)
    expect(drawn.tooltip?.items?.[0](DAYS[4])).toEqual({ name: 'Opened', value: '2 · so far' })
    expect(drawn.tooltip?.title(DAYS[0])).toBe('Mon 23 November 2026')
  })

  it('the legend names "so far" and "no data" only when drawn', () => {
    drawDays()
    expect(screen.getByRole('list', { name: 'Chart marks' }).textContent).toBe('so farno data')
    cleanup()
    draw({ data: [{ x: 'a', y: 1 }], slotField: 'slot' })
    expect(screen.queryByRole('list', { name: 'Chart marks' })).toBeNull()
  })

  it('without slotField the slot field is ignored: no marks, no filter, every bar a whole one', () => {
    const drawn = draw({ colorField: 's', data: DAYS, group: true, xTimeUnit: 'day' })
    expect(drawn.data).toBe(DAYS)
    expect(Object.keys(columnProps.at(-1)!)).not.toContain('annotations')
    expect(Object.keys(columnProps.at(-1)!)).not.toContain('interaction')
    expect(styleOf(drawn, DAYS[4])).toEqual({})
  })
})

describe('BarChart slotField with colorMap, scale and axis', () => {
  const DATA = [
    { s: 'Opened', x: at(23), y: 3 }, { s: 'Resolved', x: at(23), y: 0 },
    { s: 'Opened', slot: 'partial', x: at(24), y: 2 }, { s: 'Resolved', slot: 'partial', x: at(24), y: 0 },
    { s: 'Opened', slot: 'missing', x: at(25), y: null }, { s: 'Resolved', slot: 'missing', x: at(25), y: null },
  ]
  const fields = {
    axis: { y: { title: 'incidents' } },
    colorField: 's',
    colorMap: { Opened: 'red', Resolved: 'gray' },
    data: DATA,
    group: true,
    scale: { y: { domainMax: 4, tickCount: 5 } },
    slotField: 'slot',
    xTimeUnit: 'day' as const,
  }

  it('a partial bar keeps its mapped series colour (faint, dashed: the colour comes from the scale, not the style)', () => {
    const drawn = draw(fields)
    const props = columnProps.at(-1) as unknown as { scale: { color: { domain: string[]; range: string[] } } }
    expect(props.scale.color).toEqual({ domain: ['Opened', 'Resolved'], range: [getColorCode('red'), getColorCode('gray')] })
    expect(styleOf(drawn, DATA[2])).toEqual({ fillOpacity: 0.18, lineDash: [3, 2], lineWidth: 1.3 })
  })

  it('a measured zero stays the neutral hairline whatever the colorMap says, a partial one with a grey outline', () => {
    const drawn = draw(fields)
    expect(styleOf(drawn, DATA[1])).toEqual({ fill: getColorCode('faint'), minHeight: 2 })
    expect(styleOf(drawn, DATA[3])).toMatchObject({ fill: getColorCode('faint'), minHeight: 2, stroke: getColorCode('faint') })
  })

  it('a missing slot is still a hatched band with no bar, and the CR’s axis and scale reach G2 beside the slot marks', () => {
    const drawn = draw(fields)
    const props = columnProps.at(-1) as unknown as { axis: { x: Record<string, unknown>; y: Record<string, unknown> }; scale: { y: unknown } }
    expect(styleOf(drawn, DATA[4]).fillOpacity).toBe(0)
    expect(drawn.annotations?.map((mark) => mark.type)).toEqual(['rangeX', 'text'])
    expect(props.scale.y).toEqual({ domainMax: 4, tickCount: 5 })
    expect(props.axis.y).toMatchObject({ title: 'incidents' })
    expect(typeof props.axis.x.labelFormatter).toBe('function')
  })
})
