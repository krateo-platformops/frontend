// @vitest-environment jsdom
/**
 * A time axis places points by TIME. The epochs used to become their label ("11:00") on a categorical axis, so a
 * day apart was the same place: a 24 h line ran back across the plot and a week was folded onto a few hours
 * (visual audit, 2026-11-24). G2 draws to a canvas, so what the widget hands it is read here; the drawing itself
 * was looked at in a browser.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatClock, formatFull } from '../../utils/dateFormat'

import type { LineChartWidgetData } from './LineChart'
import LineChart, { timeTick, timeTitle } from './LineChart'

const { lineProps } = vi.hoisted(() => ({ lineProps: [] as Record<string, unknown>[] }))
vi.mock('@ant-design/plots', () => ({
  Line: (props: Record<string, unknown>) => {
    lineProps.push(props)
    return null
  },
}))
vi.mock('../../hooks/useAutoFitChart', () => ({ useAutoFitChart: () => ({ onReady: undefined, ref: () => undefined, width: 600 }) }))

/** A local moment, as the epoch seconds a RESTAction sends. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime() / 1000

interface Drawn {
  annotations?: { data?: unknown[] }[]
  axis: { x: { labelFormatter?: (value: unknown) => unknown } }
  data: { t: unknown }[]
  scale: { x?: { type?: string } }
  tooltip?: { title: (row: object) => unknown }
}
const draw = (over: Partial<LineChartWidgetData>): Drawn => {
  const widgetData = { allowedResources: [], data: [], xField: 't', xTimeUnit: 'hour', yField: 'v', ...over } as unknown as LineChartWidgetData
  render(<LineChart resourcesRefs={{ items: [] }} uid='u' widget={{} as never} widgetData={widgetData} />)
  expect(lineProps.length, 'the chart was drawn').toBeGreaterThan(0)
  return lineProps.at(-1) as unknown as Drawn
}

// "This year" is the clock's: pinned, so a label does not change on 1 January.
beforeEach(() => {
  lineProps.length = 0
  vi.useFakeTimers({ now: new Date(2026, 10, 25, 12), toFake: ['Date'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('LineChart on a time axis', () => {
  it('24 hours: the first and the last bucket are different places, though both read 11:00', () => {
    const data = Array.from({ length: 25 }, (_, i) => ({ t: at(23, 11 + i), v: i }))
    const drawn = draw({ data })
    const places = drawn.data.map(({ t }) => (t as Date).getTime())
    expect(new Set(places).size).toBe(25)
    expect(places).toEqual([...places].sort((one, other) => one - other))
    expect(drawn.scale.x?.type).toBe('time')
    expect([timeTick(drawn.data[0].t, 'hour'), timeTick(drawn.data[24].t, 'hour')]).toEqual(['11:00', '11:00'])
  })

  it('annotations sit where their moment is', () => {
    const drawn = draw({ annotations: [{ data: [at(24, 9)], type: 'lineX' }, { data: [{ t: at(24, 8), v: 3 }], type: 'point' }] as never, data: [{ t: at(24, 8), v: 3 }] })
    expect(drawn.annotations?.[0].data).toEqual([new Date(2026, 10, 24, 9)])
    expect(drawn.annotations?.[1].data).toEqual([{ t: new Date(2026, 10, 24, 8), v: 3 }])
  })

  it('the tooltip is the full date, with the viewer’s zone named, as every time’s hover is', () => {
    const drawn = draw({ data: [{ t: at(24, 8), v: 3 }] })
    const title = drawn.tooltip?.title({ t: new Date(2026, 10, 24, 8) })
    expect(title).toMatch(/^Tue 24 November 2026, 08:00:00 \(UTC([+-]\d+(:\d{2})?)?\)$/)
    expect(title).toBe(formatFull(new Date(2026, 10, 24, 8)))
  })

  it('a CR’s own axis.x and scale.x still win', () => {
    const mine = () => 'mine'
    const drawn = draw({ axis: { x: { labelFormatter: mine } }, data: [{ t: at(24, 8), v: 3 }], scale: { x: { type: 'point' } } })
    expect(drawn.axis.x.labelFormatter).toBe(mine)
    expect(drawn.scale.x?.type).toBe('point')
  })

  it('without xTimeUnit the server’s labels pass through, with nothing of a time axis', () => {
    const drawn = draw({ data: [{ t: '11:00', v: 1 }], xTimeUnit: undefined })
    expect(drawn.data).toEqual([{ t: '11:00', v: 1 }])
    expect([drawn.scale.x, drawn.axis.x.labelFormatter, drawn.tooltip]).toEqual([undefined, undefined, undefined])
  })
})

describe('tick labels', () => {
  it('an hourly axis names the day where it changes', () => {
    expect([timeTick(new Date(2026, 10, 23, 21), 'hour'), timeTick(new Date(2026, 10, 24), 'hour'), timeTick(new Date(2026, 10, 24, 3, 30), 'hour')])
      .toEqual(['21:00', '24 Nov', '03:30'])
  })

  it('a daily axis labels each day once, whatever ticks fall between', () => {
    expect([timeTick(new Date(2026, 10, 23), 'day'), timeTick(new Date(2026, 10, 23, 12), 'day'), timeTick(new Date(2026, 10, 24), 'day')])
      .toEqual(['23 Nov', '', '24 Nov'])
    expect(timeTitle(new Date(2026, 10, 23, 1), 'day')).toBe('Mon 23 November 2026')
  })

  it('a day in another year carries its year, as text does', () => {
    expect(timeTick(new Date(2025, 11, 31), 'day')).toBe('31 Dec 2025')
  })

  it('a tick reads the same clock as the text beside the chart: one zone, the viewer’s', () => {
    const iso = '2026-11-24T07:00:00Z'
    expect(timeTick(new Date(iso), 'hour')).toBe(formatClock(iso))
  })

  it('what is not a moment is left alone', () => {
    expect([timeTick('11:00', 'hour'), timeTitle(3, 'day')]).toEqual(['11:00', 3])
  })
})
