// @vitest-environment jsdom
/**
 * LineChart's theme-ink axis and legend, which had NO test file at all.
 *
 * WHY THIS EXISTS. G2 defaults axis ticks, axis titles and legend text to near-black, which is
 * invisible on the dark Petrol void, so the widget overrides them with `getColorCode`. Those
 * overrides are G2 style keys written as literals, and G2 declares the shape they go into as
 * `AxisComponent`/`LegendComponent` — both of which end in `[key: string]: any`. So renaming one
 * is NOT a compile error (`{ utterGarbage: 42 } satisfies AxisComponent` typechecks), and a
 * `satisfies` annotation against G2's own types would be decoration that reads as a guard. The
 * only thing that can actually catch a rename here is reading back what the widget passed.
 *
 * BarChart had this; LineChart and PieChart did not, so a rename in these two was caught by
 * nothing. The G2 Column/Line/Pie render to canvas, unavailable in jsdom, so the chart is mocked
 * to a prop-recorder.
 *
 * WHAT THIS STILL DOES NOT CATCH: G2 itself renaming the key it honours upstream. That reverts the
 * text to near-black with this file green, and only a real render could see it.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getColorCode } from '../../theme/palette'

const { lineProps } = vi.hoisted(() => ({ lineProps: [] as Record<string, unknown>[] }))
vi.mock('@ant-design/plots', () => ({
  Line: (props: Record<string, unknown>) => {
    lineProps.push(props)
    return null
  },
}))
/**
 * The chart is gated on a MEASURED width (`useMeasuredWidth` → ResizeObserver) and jsdom provides
 * no ResizeObserver, so without this the widget renders `null`, records no props, and every
 * assertion below would read from `undefined`. That is the shape of test file that passes by never
 * reaching its subject, so `renderLine` asserts the chart rendered before asserting anything about
 * it.
 */
vi.mock('../../hooks/useMeasuredWidth', () => ({
  useMeasuredWidth: () => ({ ref: () => undefined, width: 600 }),
}))

import LineChart from './LineChart'
import type { LineChartWidgetData } from './LineChart'

afterEach(() => {
  cleanup()
  lineProps.length = 0
})

type AxisShape = { x?: Record<string, unknown>; y?: Record<string, unknown> }
type LegendShape = { color?: Record<string, unknown> }

function renderLine(data: Partial<LineChartWidgetData>) {
  render(
    <LineChart
      resourcesRefs={{ items: [] }}
      uid='l'
      widget={{} as never}
      widgetData={{ data: [{ x: 'a', y: 1 }], xField: 'x', yField: 'y', ...data }}
    />,
  )
  const props = lineProps[lineProps.length - 1]
  expect(props, 'the Line chart never rendered, so nothing below is measuring the ink keys — check the width gate or widgetData, not the fills').toBeDefined()
  return props
}

describe('LineChart widget — axis and legend text legible on the dark theme', () => {
  // Resolved through the same function the widget uses, in the same (default/light) jsdom theme,
  // so this asserts the EXACT ink rather than merely "something truthy" — which also catches an
  // override that is present but wired to the wrong palette entry.
  const axisInk = () => getColorCode('gray')
  const legendInk = () => getColorCode('text')

  it('fills both axes\' tick labels AND titles with theme ink', () => {
    const axis = renderLine({}).axis as AxisShape

    expect(axis?.x?.labelFill, 'axis.x.labelFill is missing — x-axis tick labels fall back to G2 near-black, invisible on the dark theme').toBe(axisInk())
    expect(axis?.x?.titleFill, 'axis.x.titleFill is missing — the x-axis TITLE falls back to G2 near-black').toBe(axisInk())
    expect(axis?.y?.labelFill, 'axis.y.labelFill is missing — y-axis tick labels fall back to G2 near-black').toBe(axisInk())
    expect(axis?.y?.titleFill, 'axis.y.titleFill is missing — the y-axis TITLE falls back to G2 near-black').toBe(axisInk())
  })

  it('fills the legend item labels with theme ink', () => {
    const legend = renderLine({ colorField: 'series' }).legend as LegendShape

    expect(legend?.color?.itemLabelFill, 'legend.color.itemLabelFill is missing — legend text falls back to G2 near-black').toBe(legendInk())
  })

  it('honours legend:false rather than forcing an inked legend', () => {
    expect(renderLine({ legend: false }).legend, 'legend:false must pass through as `false`, not as an inked legend object').toBe(false)
  })

  /**
   * `axisWithInk` merges the ink UNDER the CR's own axis config, which is the documented contract:
   * an operator's explicit per-axis value wins, and any other key they set survives. Both halves
   * are easy to break with a spread in the wrong order and neither shows up as a type error.
   */
  it("keeps the CR's own axis keys and lets an explicit fill override the ink", () => {
    const axis = renderLine({ axis: { x: { labelFill: '#ff0000', tickCount: 6 } } }).axis as AxisShape

    expect(axis?.x?.tickCount, "the CR's own axis.x.tickCount was dropped by the ink merge").toBe(6)
    expect(axis?.x?.labelFill, "the CR's explicit axis.x.labelFill must win over the default ink").toBe('#ff0000')
    expect(axis?.y?.labelFill, 'the axis the CR did not configure must still get theme ink').toBe(axisInk())
  })
})
