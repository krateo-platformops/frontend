// @vitest-environment jsdom
/**
 * BarChart `colorMap`, `scale` and `axis`, exactly as LineChart has them (approved charts mockup, 2026-11-25; audit
 * CHART-3 and CHART-4): incident counts need series colours by name (Opened red, Resolved grey), whole-number ticks
 * and a unit on the y axis. One mapping for both charts (theme/chart-utils), so the same CR fields give the same G2
 * config; this reads back what BarChart hands G2, side by side with LineChart.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getChartCatPalette } from '../../theme/chart-utils'
import { getColorCode } from '../../theme/palette'
import LineChart from '../LineChart/LineChart'

import BarChart from './BarChart'

const { drawn } = vi.hoisted(() => ({ drawn: { Column: [] as Record<string, unknown>[], Line: [] as Record<string, unknown>[] } }))
vi.mock('@ant-design/plots', () => ({
  Column: (props: Record<string, unknown>) => {
    drawn.Column.push(props)
    return null
  },
  Line: (props: Record<string, unknown>) => {
    drawn.Line.push(props)
    return null
  },
}))
vi.mock('../../hooks/useMeasuredWidth', () => ({ useMeasuredWidth: () => ({ ref: () => undefined, width: 600 }) }))
vi.mock('../../hooks/useAutoFitChart', () => ({ useAutoFitChart: () => ({ onReady: undefined, ref: () => undefined, width: 600 }) }))

afterEach(() => {
  cleanup()
  drawn.Column.length = 0
  drawn.Line.length = 0
})

type Fields = { axis?: Record<string, unknown>; colorMap?: Record<string, string>; scale?: Record<string, unknown>; xTimeUnit?: 'day' | 'hour' }
interface Handed { axis: { x: Record<string, unknown>; y: Record<string, unknown> }; scale: { color: { domain?: string[]; range: string[] }; y?: Record<string, unknown> } }

const DATA = [{ s: 'Opened', x: 'Mon', y: 2 }, { s: 'Resolved', x: 'Mon', y: 1 }]
const bar = (fields: Fields): Handed => {
  render(<BarChart resourcesRefs={{ items: [] }} uid='b' widget={{} as never} widgetData={{ colorField: 's', data: DATA, xField: 'x', yField: 'y', ...fields }} />)
  return drawn.Column.at(-1) as unknown as Handed
}
const line = (fields: Fields): Handed => {
  render(<LineChart resourcesRefs={{ items: [] }} uid='l' widget={{} as never} widgetData={{ colorField: 's', data: DATA, xField: 'x', yField: 'y', ...fields }} />)
  return drawn.Line.at(-1) as unknown as Handed
}

describe('BarChart colorMap, scale, axis', () => {
  it('colorMap: each series its palette colour, read for the mode, as a G2 color domain and range', () => {
    const { scale } = bar({ colorMap: { Opened: 'red', Resolved: 'gray' } })
    expect(scale.color).toEqual({ domain: ['Opened', 'Resolved'], range: [getColorCode('red'), getColorCode('gray')] })
  })

  it('scale: the CR’s own channels pass to G2, beside the series colours', () => {
    const { scale } = bar({ colorMap: { Opened: 'red' }, scale: { y: { domainMax: 4, tickCount: 5 } } })
    expect(scale.y).toEqual({ domainMax: 4, tickCount: 5 })
    expect(scale.color.domain).toEqual(['Opened'])
  })

  it('without colorMap the series take the chart palette, and a CR’s scale.color still wins', () => {
    expect(bar({}).scale).toEqual({ color: { range: getChartCatPalette() } })
    cleanup()
    expect(bar({ scale: { color: { range: ['#000000'] } } }).scale.color).toEqual({ range: ['#000000'] })
  })

  it('axis: the CR’s keys reach G2 over the theme ink; an axis it did not set keeps the ink', () => {
    const { axis } = bar({ axis: { y: { labelFill: '#ff0000', tickCount: 5, title: 'incidents' } } })
    expect(axis.y).toEqual({ labelFill: '#ff0000', tickCount: 5, title: 'incidents', titleFill: getColorCode('gray') })
    expect(axis.x).toEqual({ labelFill: getColorCode('gray'), titleFill: getColorCode('gray') })
  })

  it('a CR’s own axis.x.labelFormatter wins over the time labels, as on LineChart', () => {
    const mine = () => 'mine'
    const { axis } = bar({ axis: { x: { labelFormatter: mine } }, xTimeUnit: 'day' })
    expect(axis.x.labelFormatter).toBe(mine)
  })

  it('the same fields give LineChart and BarChart the same scale and axis', () => {
    const fields = { axis: { x: { tickCount: 6 }, y: { title: 'incidents' } }, colorMap: { Opened: 'red', Resolved: 'gray' }, scale: { y: { domainMax: 4, tickCount: 5 } } }
    const fromBar = bar(fields)
    const fromLine = line(fields)
    expect(fromBar.scale).toEqual(fromLine.scale)
    expect(fromBar.axis).toEqual(fromLine.axis)
  })
})
