import { Pie } from '@ant-design/plots'

import { WidgetEmpty } from '../../components/WidgetStates'
import { useMeasuredWidth } from '../../hooks/useMeasuredWidth'
import { getChartCatPalette } from '../../theme/chart-utils'
import { getColorCode } from '../../theme/palette'
import type { WidgetProps } from '../../types/Widget'

import styles from './PieChart.module.css'
import type { PieChart as WidgetType } from './PieChart.type'

export type PieChartWidgetData = WidgetType['spec']['widgetData']

type LegendPosition = 'bottom' | 'right' | 'top' | 'left'

/** One legend entry's row in G2's classic theme, measured on a render: label, marker and row padding. */
const LEGEND_ROW = 24

const isBeside = (position: LegendPosition): boolean => position === 'left' || position === 'right'

/** The height `entries` rows need, with half a row above and below. */
const legendHeight = (entries: number): number => (entries + 1) * LEGEND_ROW

/**
 * Legend keyed by the `color` channel (driven by `colorField`). Default `bottom`
 * (centered under the donut); `legendPosition: 'right'` stacks it to the right of the
 * donut (the Petrol status-breakdown layout). `justifyContent: center` keeps it aligned
 * with the centered donut on whichever axis the legend runs.
 */
const legendFor = (position: LegendPosition, entries: number) => ({
  // itemLabelFill = theme ink: G2's default legend text is near-black → invisible on the
  // Petrol void. Resolved per render so it follows the light/dark toggle.
  color: {
    itemLabelFill: getColorCode('text'),
    layout: { justifyContent: 'center' },
    position,
    // ONE COLUMN beside the donut, however many entries. G2 starts a second one when the entries pass
    // the plot's height, unless the legend's own `length` gives it room; `maxCols: 1` is not that, it
    // hides the rest behind pager arrows.
    ...(isBeside(position) ? { length: legendHeight(entries) } : {}),
  },
})

/**
 * Faithful wrapper of the @ant-design/plots `Pie` (AntV G2): data + angle/color
 * field mappings. Colors come from G2's palette via `colorField`, not a Krateo enum.
 * `label` (per-slice value labels) and `annotations` (e.g. a donut center total)
 * are passed straight through to the library.
 */
const PieChart = ({ uid, widgetData }: WidgetProps<PieChartWidgetData>) => {
  // Measure the container width and render the Pie at an explicit size (no autoFit
  // race that scattered the donut on first paint — see useMeasuredWidth).
  const { ref, width } = useMeasuredWidth<HTMLDivElement>()

  if (!widgetData.data?.length) {
    return <WidgetEmpty description='No data to chart' />
  }

  // Optional semantic slice colors: map each colorField category to a palette color. Without an
  // operator colorMap, auto-assigned slices use the v2 categorical chart palette (mode-aware),
  // not G2's default palette.
  const { colorMap } = widgetData
  const scale = colorMap
    ? { color: { domain: Object.keys(colorMap), range: Object.keys(colorMap).map((key) => getColorCode(colorMap[key])) } }
    : { color: { range: getChartCatPalette() } }

  // The legend lists the operator's categories and the data's.
  const entries = new Set([
    ...Object.keys(colorMap ?? {}),
    ...widgetData.data.map((row) => String((row as Record<string, unknown>)[widgetData.colorField])),
  ]).size
  const position = widgetData.legendPosition ?? 'bottom'
  const beside = widgetData.legend !== false && isBeside(position)
  // As tall as the operator says, or as the one column beside the donut needs.
  const height = Math.max(widgetData.height ?? 240, beside ? legendHeight(entries) : 0)

  return (
    <div className={styles.pieChart} ref={ref} style={{ height }}>
      {width > 0 ? (
        <Pie
          angleField={widgetData.angleField}
          annotations={widgetData.annotations}
          autoFit={false}
          colorField={widgetData.colorField}
          data={widgetData.data}
          height={height}
          innerRadius={widgetData.innerRadius === null || widgetData.innerRadius === undefined ? undefined : widgetData.innerRadius / 100}
          key={uid}
          label={widgetData.label}
          legend={widgetData.legend === false ? false : legendFor(position, entries)}
          scale={scale}
          title={widgetData.title}
          width={width}
        />
      ) : null}
    </div>
  )
}

export default PieChart
