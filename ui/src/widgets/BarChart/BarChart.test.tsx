// @vitest-environment jsdom
/**
 * §6 (audit): BarChart axis/legend text defaulted to G2's near-black — invisible on the dark
 * theme. The widget must pass theme-ink axis label/title fills and a theme-ink legend so labels
 * are legible in both themes, while still honouring legend:false. The G2 Column is mocked to a
 * prop-recorder (it renders to canvas, unavailable in jsdom).
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getColorCode } from '../../theme/palette'

const { columnProps } = vi.hoisted(() => ({ columnProps: [] as Record<string, unknown>[] }))
vi.mock('@ant-design/plots', () => ({
  Column: (props: Record<string, unknown>) => {
    columnProps.push(props)
    return null
  },
}))
/**
 * The chart's container is observed (`useAutoFitChart` → `useMeasuredWidth` → ResizeObserver, the
 * #603 re-fit) and jsdom provides no ResizeObserver, so the observer would throw on mount. Nothing
 * here is about sizing — that is pinned in useAutoFitChart.test — so the measurement is stubbed.
 */
vi.mock('../../hooks/useMeasuredWidth', () => ({
  useMeasuredWidth: () => ({ ref: () => undefined, width: 600 }),
}))

import BarChart from './BarChart'
import type { BarChartWidgetData } from './BarChart'

afterEach(() => {
  cleanup()
  columnProps.length = 0
})

// Open-valued, so adding an assertion does not also mean widening a local type — the local type
// was never the guard here. Reading the key back off the recorded props is.
type AxisShape = { x?: Record<string, unknown>; y?: Record<string, unknown> }
type LegendShape = { color?: Record<string, unknown> }

function renderBar(data: Partial<BarChartWidgetData>) {
  render(
    <BarChart
      resourcesRefs={{ items: [] }}
      uid='b'
      widget={{} as never}
      widgetData={{ data: [{ x: 'a', y: 1 }], xField: 'x', yField: 'y', ...data }}
    />,
  )
  return columnProps[columnProps.length - 1]
}

describe('BarChart widget — axis/legend legible on dark theme (audit §6)', () => {
  // Resolved through the same function the widget uses, in the same (default/light) jsdom theme.
  // These used to be `toBeTruthy()`, which passes on an override wired to the WRONG palette entry —
  // a bug that looks exactly like working code. The exact value is the assertion worth making.
  const axisInk = () => getColorCode('gray')
  const legendInk = () => getColorCode('text')

  it('sets theme-ink axis label fills for x and y (visible on dark)', () => {
    const props = renderBar({})
    const axis = props.axis as AxisShape
    expect(axis?.x?.labelFill, 'axis.x.labelFill is missing or off-palette — x-axis tick labels fall back to G2 near-black, invisible on the dark theme').toBe(axisInk())
    expect(axis?.y?.labelFill, 'axis.y.labelFill is missing or off-palette — y-axis tick labels fall back to G2 near-black').toBe(axisInk())
    // `titleFill` was set by the widget but asserted by nothing, so an axis TITLE could revert to
    // G2's near-black with this file still green — the same hole LineChart/PieChart had wholesale.
    expect(axis?.x?.titleFill, 'axis.x.titleFill is missing or off-palette — the x-axis TITLE falls back to G2 near-black').toBe(axisInk())
    expect(axis?.y?.titleFill, 'axis.y.titleFill is missing or off-palette — the y-axis TITLE falls back to G2 near-black').toBe(axisInk())
  })

  it('sets a theme-ink legend by default', () => {
    const props = renderBar({})
    const legend = props.legend as LegendShape
    expect(legend?.color?.itemLabelFill, 'legend.color.itemLabelFill is missing or off-palette — legend text falls back to G2 near-black').toBe(legendInk())
  })

  it('honours legend:false (no legend object)', () => {
    const props = renderBar({ legend: false })
    expect(props.legend).toBe(false)
  })
})
