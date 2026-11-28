// @vitest-environment jsdom
/**
 * LineChart `slotField` (approved charts mockup, 2026-11-25; audit CHART-1): a slot with no data breaks the line
 * over a hatched "No data" band, the slot still filling ends it dashed with a hollow point, "so far". G2 draws to a
 * canvas, so what the widget hands it is read here; the drawing and the hovers were looked at in a browser.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatFull } from '../../utils/dateFormat'

import type { LineChartWidgetData } from './LineChart'
import LineChart from './LineChart'

const { lineProps } = vi.hoisted(() => ({ lineProps: [] as Record<string, unknown>[] }))
vi.mock('@ant-design/plots', () => ({
  Line: (props: Record<string, unknown>) => {
    lineProps.push(props)
    return null
  },
}))
vi.mock('../../hooks/useAutoFitChart', () => ({ useAutoFitChart: () => ({ onReady: undefined, ref: () => undefined, width: 600 }) }))

/** A local moment, as the epoch seconds a RESTAction sends. */
const at = (hour: number, minute = 0) => new Date(2026, 10, 25, hour, minute).getTime() / 1000

type Row = Record<string, unknown>
type Mark = { data: Row[]; encode: Record<string, unknown>; style: Record<string, unknown>; type: string }
interface Drawn {
  annotations?: Mark[]
  data: Row[]
  interaction?: { tooltip: { filter: (item: { value?: unknown }) => boolean } }
  tooltip?: { items?: ((row: Row) => { name: string; value: unknown } | null)[]; title: (row: Row) => unknown }
}
const draw = (over: Partial<LineChartWidgetData>): Drawn => {
  const widgetData = { data: [], slotField: 'slot', xField: 't', xTimeUnit: 'hour', yField: 'v', ...over } as unknown as LineChartWidgetData
  render(<LineChart resourcesRefs={{ items: [] }} uid='u' widget={{} as never} widgetData={widgetData} />)
  return lineProps.at(-1) as unknown as Drawn
}

// 09:30 to 10:40 in 10-minute slots: 09:50 and 10:00 had nothing recorded, 10:40 is the slot still filling.
const DATA = [
  { t: at(9, 30), v: 918 },
  { t: at(9, 40), v: 922 },
  { slot: 'missing', t: at(9, 50), v: null },
  { slot: 'missing', t: at(10, 0) },
  { t: at(10, 10), v: 1046 },
  { t: at(10, 20), v: 930 },
  { t: at(10, 30), v: 0 },
  { slot: 'partial', t: at(10, 40), v: 412 },
]

beforeEach(() => {
  lineProps.length = 0
  vi.useFakeTimers({ now: new Date(2026, 10, 25, 12), toFake: ['Date'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('LineChart slotField', () => {
  it('the line has no value at a slot with no data, nor at the slot still filling; a measured 0 stays 0', () => {
    const { data } = draw({ data: DATA })
    expect(data.map((row) => row.v)).toEqual([918, 922, null, null, 1046, 930, 0, null])
    expect(data[0]).toEqual({ t: new Date(DATA[0].t * 1000), v: 918 })
  })

  it('a hatched band spans the gap, from the last slot with data to the next one, labelled "No data"', () => {
    const band = draw({ data: DATA }).annotations?.find((mark) => mark.type === 'rangeX') as Mark & { labels: { text: () => string }[] }
    expect(band.data).toHaveLength(1)
    expect(Object.values(band.data[0]).map((value) => (value as Date).getTime() / 1000).sort()).toEqual([at(9, 40), at(10, 10)])
    expect(band.labels[0].text()).toBe('No data')
    expect((band.style.fill as { image: string }).image).toMatch(/^data:image\/svg\+xml,/)
  })

  it('the slot still filling: a dashed segment from the last whole slot, a hollow point, and "so far"', () => {
    const marks = draw({ data: DATA }).annotations ?? []
    const dashed = marks.find((mark) => mark.type === 'line')!
    expect(dashed.style.lineDash).toEqual([4, 3])
    expect(dashed.data.map((row) => [(row.t as Date).getTime() / 1000, row.v])).toEqual([[at(10, 30), 0], [at(10, 40), 412]])
    const point = marks.find((mark) => mark.type === 'point')!
    expect([point.encode.shape, point.data.map((row) => row.v)]).toEqual(['hollow', [412]])
    expect(marks.find((mark) => mark.type === 'text')?.style.text).toBe('so far')
  })

  it('on hover: the band is its run of times, with no value; the slot still filling ends "so far"', () => {
    const drawn = draw({ data: DATA })
    const [, , , missing] = drawn.data
    expect(drawn.tooltip?.title(missing)).toBe('No data · 25 Nov, 09:50 to 10:10')
    expect(drawn.tooltip?.items?.[0](missing)).toBeNull()
    expect(drawn.interaction?.tooltip.filter({ value: null })).toBe(false)
    expect(drawn.tooltip?.items?.[0](drawn.data[7])).toEqual({ name: 'v', value: '412 · so far' })
    expect(drawn.tooltip?.title(drawn.data[7])).toBe(formatFull(new Date(2026, 10, 25, 10, 40)))
    expect(drawn.tooltip?.items?.[0](drawn.data[6])).toEqual({ name: 'v', value: 0 })
  })

  it('each series ends on its own dashed segment, in its own colour', () => {
    const data = [
      { k: 'cpu', t: at(10), v: 5 }, { k: 'mem', t: at(10), v: 18 },
      { k: 'cpu', slot: 'partial', t: at(11), v: 2 }, { k: 'mem', slot: 'partial', t: at(11), v: 9 },
    ]
    const dashed = (draw({ colorField: 'k', data }).annotations ?? []).find((mark) => mark.type === 'line')!
    expect(dashed.encode.color).toBe('k')
    const segment = dashed.encode.series as (row: Row) => unknown
    const segments = new Set(dashed.data.map(segment))
    expect(segments.size).toBe(2)
    expect(dashed.data.filter((row) => row.k === 'cpu').map(segment)).toEqual([segment(dashed.data[0]), segment(dashed.data[0])])
  })

  it('the legend names "so far" and "no data" only when drawn', () => {
    draw({ data: DATA })
    expect(screen.getByRole('list', { name: 'Chart marks' }).textContent).toBe('so farno data')
    cleanup()
    draw({ data: DATA.filter((row) => row.slot !== 'missing') })
    expect(screen.getByRole('list', { name: 'Chart marks' }).textContent).toBe('so far')
    cleanup()
    draw({ data: DATA.filter((row) => !row.slot) })
    expect(screen.queryByRole('list', { name: 'Chart marks' })).toBeNull()
  })

  it('without slotField the chart is handed what it was before: no marks, no filter, the slot field ignored', () => {
    const drawn = draw({ data: DATA, slotField: undefined })
    expect(drawn.data.map((row) => (row.t as Date).getTime() / 1000)).toEqual(DATA.map((row) => row.t))
    expect(drawn.data[7].v).toBe(412)
    expect(drawn.annotations).toBeUndefined()
    expect(Object.keys(lineProps.at(-1)!)).not.toContain('interaction')
    expect(drawn.tooltip?.items).toBeUndefined()
    expect(screen.queryByRole('list', { name: 'Chart marks' })).toBeNull()
  })
})
