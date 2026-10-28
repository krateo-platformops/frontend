// @vitest-environment jsdom
/**
 * §6 (audit): BarChart axis/legend text defaulted to G2's near-black — invisible on the dark
 * theme. The widget must pass theme-ink axis label/title fills and a theme-ink legend so labels
 * are legible in both themes, while still honouring legend:false. The G2 Column is mocked to a
 * prop-recorder (it renders to canvas, unavailable in jsdom).
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { columnProps } = vi.hoisted(() => ({ columnProps: [] as Record<string, unknown>[] }))
vi.mock('@ant-design/plots', () => ({
  Column: (props: Record<string, unknown>) => {
    columnProps.push(props)
    return null
  },
}))

import BarChart from './BarChart'
import type { BarChartWidgetData } from './BarChart'

afterEach(() => {
  cleanup()
  columnProps.length = 0
})

type AxisShape = { x?: { labelFill?: string }; y?: { labelFill?: string } }
type LegendShape = { color?: { itemLabelFill?: string } }

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
  it('sets theme-ink axis label fills for x and y (visible on dark)', () => {
    const props = renderBar({})
    const axis = props.axis as AxisShape
    expect(axis?.x?.labelFill).toBeTruthy()
    expect(axis?.y?.labelFill).toBeTruthy()
  })

  it('sets a theme-ink legend by default', () => {
    const props = renderBar({})
    const legend = props.legend as LegendShape
    expect(legend?.color?.itemLabelFill).toBeTruthy()
  })

  it('honours legend:false (no legend object)', () => {
    const props = renderBar({ legend: false })
    expect(props.legend).toBe(false)
  })
})
