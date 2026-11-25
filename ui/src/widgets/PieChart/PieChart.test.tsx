// @vitest-environment jsdom
/**
 * PieChart's theme-ink legend, which had NO test file at all.
 *
 * WHY THIS EXISTS. G2 defaults legend text to near-black, invisible on the dark Petrol void, so
 * `legendFor` overrides it with `getColorCode('text')`. That is a G2 style key written as a
 * literal, and G2 declares the shape it goes into (`LegendComponent`) with a trailing
 * `[key: string]: any` — so a rename is NOT a compile error, and a `satisfies` annotation against
 * G2's own types could not fail. Reading back what the widget passed is the only guard available.
 *
 * SCOPE NOTE: a pie has no axis, so `itemLabelFill` is this widget's ENTIRE ink surface — there is
 * no `labelFill`/`titleFill` here to cover, unlike BarChart and LineChart. The Pie renders to
 * canvas, unavailable in jsdom, so it is mocked to a prop-recorder.
 *
 * WHAT THIS STILL DOES NOT CATCH: G2 itself renaming the key it honours upstream. That reverts the
 * legend to near-black with this file green, and only a real render could see it.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getColorCode } from '../../theme/palette'

const { pieProps } = vi.hoisted(() => ({ pieProps: [] as Record<string, unknown>[] }))
vi.mock('@ant-design/plots', () => ({
  Pie: (props: Record<string, unknown>) => {
    pieProps.push(props)
    return null
  },
}))
/**
 * The chart is gated on a MEASURED width (`useMeasuredWidth` → ResizeObserver) and jsdom provides
 * no ResizeObserver, so without this the widget renders `null`, records no props, and every
 * assertion below would read from `undefined` — a test file that passes by never reaching its
 * subject. `renderPie` asserts the chart rendered before asserting anything about it.
 */
vi.mock('../../hooks/useMeasuredWidth', () => ({
  useMeasuredWidth: () => ({ ref: () => undefined, width: 600 }),
}))

import PieChart from './PieChart'
import type { PieChartWidgetData } from './PieChart'

afterEach(() => {
  cleanup()
  pieProps.length = 0
})

type LegendShape = { color?: Record<string, unknown> }

function renderPie(data: Partial<PieChartWidgetData>) {
  render(
    <PieChart
      resourcesRefs={{ items: [] }}
      uid='p'
      widget={{} as never}
      widgetData={{ angleField: 'v', colorField: 'k', data: [{ k: 'a', v: 1 }], ...data }}
    />,
  )
  const props = pieProps[pieProps.length - 1]
  expect(props, 'the Pie chart never rendered, so nothing below is measuring the ink key — check the width gate or widgetData, not the fill').toBeDefined()
  return props
}

describe('PieChart widget — legend text legible on the dark theme', () => {
  // Resolved through the same function the widget uses, in the same (default/light) jsdom theme,
  // so this asserts the EXACT ink rather than merely "something truthy" — which also catches an
  // override that is present but wired to the wrong palette entry.
  const legendInk = () => getColorCode('text')

  it('fills the legend item labels with theme ink', () => {
    const legend = renderPie({}).legend as LegendShape

    expect(legend?.color?.itemLabelFill, 'legend.color.itemLabelFill is missing — legend text falls back to G2 near-black, invisible on the dark theme').toBe(legendInk())
  })

  it('keeps the ink when legendPosition moves the legend', () => {
    const legend = renderPie({ legendPosition: 'right' }).legend as LegendShape

    expect(legend?.color?.position, 'legendPosition must reach G2 as legend.color.position').toBe('right')
    expect(legend?.color?.itemLabelFill, 'the ink must survive a non-default legendPosition — it is set in the same object the position goes into').toBe(legendInk())
  })

  it('gives a legend beside the donut room for every entry in one column', () => {
    const rows = (count: number) => Array.from({ length: count }, (_row, index) => ({ k: `k${index}`, v: 1 }))
    const of = (data: Partial<PieChartWidgetData>) => {
      const props = renderPie(data)
      return { height: props.height, length: (props.legend as LegendShape).color?.length }
    }
    // Room for n entries is n + 1 rows of 24; the chart grows only when its own height is short of it.
    expect(of({ data: rows(6), height: 180, legendPosition: 'right' })).toEqual({ height: 180, length: 168 })
    expect(of({ data: rows(9), height: 180, legendPosition: 'left' })).toEqual({ height: 240, length: 240 })
    // The operator's categories are in the legend with or without a slice, and so is one they left out.
    expect(of({ colorMap: { k0: 'red', zero: 'gray' }, data: rows(2), height: 180, legendPosition: 'right' })).toEqual({ height: 180, length: 96 })
    // Under the donut it is a row, and the height is the operator's.
    expect(of({ data: rows(9), height: 180 })).toEqual({ height: 180, length: undefined })
    expect(renderPie({ data: rows(9), height: 180, legend: false, legendPosition: 'right' }).height).toBe(180)
  })

  it('honours legend:false rather than forcing an inked legend', () => {
    expect(renderPie({ legend: false }).legend, 'legend:false must pass through as `false`, not as an inked legend object').toBe(false)
  })
})
