import { Column } from '@ant-design/plots'

import { WidgetEmpty } from '../../components/WidgetStates'
import { useAutoFitChart } from '../../hooks/useAutoFitChart'
import { axisWithInk, chartScale } from '../../theme/chart-utils'
import { getColorCode } from '../../theme/palette'
import type { WidgetProps } from '../../types/Widget'
import { formatClock, formatDate, formatFull, formatFullDay, formatMoment } from '../../utils/dateFormat'

import styles from './BarChart.module.css'
import type { BarChart as WidgetType } from './BarChart.type'

export type BarChartWidgetData = WidgetType['spec']['widgetData']

// G2 legend text defaults to near-black — invisible on the dark Petrol void. Force theme ink so it
// is legible in BOTH themes; getColorCode reads data-theme, so the colour follows the light/dark
// toggle (mirrors LineChart/PieChart). A function, not a constant, so it re-evaluates per render
// after a theme switch. The axes get the same ink from axisWithInk, shared with LineChart.
const inkLegend = () => ({ color: { itemLabelFill: getColorCode('text') } })

type TimeUnit = NonNullable<BarChartWidgetData['xTimeUnit']>

const toDate = (epochSeconds: number): Date => new Date(epochSeconds * 1000)

/**
 * The label under each bar on a time axis (`xTimeUnit`), keyed by its epoch, in the VIEWER's time zone as
 * all text is (utils/dateFormat; a server-side strftime is UTC: "Mon 14:00" on a chart beside text an hour
 * apart, audit TIME-2). A bar is a bucket, one per band, in the order the RESTAction sends them.
 * - `day`: each bar its day, "24 Nov" ("31 Dec 2025" in another year).
 * - `hour`: the clock, "14:00"; the first bar and the first bar of each new day name the day as well,
 *   "25 Nov" at midnight or "25 Nov, 01:00" otherwise, so a week reads as days and a day as hours.
 * Labels that would overlap are hidden by G2, the day-naming ones among them.
 */
export const barTimeLabels = (epochs: readonly unknown[], unit: TimeUnit): Map<number, string> => {
  const labels = new Map<number, string>()
  const ordered = [...new Set(epochs.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))].sort((one, other) => one - other)
  let previousDay: string | undefined
  ordered.forEach((epoch) => {
    const date = toDate(epoch)
    const day = formatDate(date)
    if (unit === 'day') {
      labels.set(epoch, day)
    } else if (day === previousDay) {
      labels.set(epoch, formatClock(date))
    } else {
      labels.set(epoch, formatClock(date) === '00:00' ? day : formatMoment(date))
    }
    previousDay = day
  })
  return labels
}

/**
 * A bar's own time, whole, as every time's hover is: "Tue 24 November 2026, 14:00:00 (UTC+1)", the zone named
 * so the chart and the text beside it can be told to agree; a daily bar is its day, "Tue 24 November 2026".
 */
export const barTimeTitle = (value: unknown, unit: TimeUnit): unknown => {
  if (typeof value !== 'number' || !Number.isFinite(value)) { return value }
  return unit === 'day' ? formatFullDay(toDate(value)) : formatFull(toDate(value))
}

/**
 * Faithful wrapper of the @ant-design/plots `Column` (AntV G2 — vertical bars):
 * data + field mappings. Replaces the previous fake (stacked antd `Progress`
 * with a `percentage`-only schema).
 */
const BarChart = ({ uid, widgetData }: WidgetProps<BarChartWidgetData>) => {
  // Same autoFit gap as LineChart (issue #603): G2 re-fits on WINDOW resize only, so a Column that
  // re-rendered inside a hidden tab pane drew at its 640px default and kept it once shown again.
  // The container observer re-fits it whenever the container has a real size. Unlike LineChart the
  // first paint is not gated on the measured width (it never was), so `width` goes unused here.
  const { onReady, ref } = useAutoFitChart<HTMLDivElement>()

  if (!widgetData.data?.length) {
    return <WidgetEmpty description='No data to chart' />
  }

  // `xTimeUnit`: the x values are epoch seconds. They stay numbers in the data (a band scale keys its bars
  // by value, so a Date per row would split one bucket's stacked series into bars of their own); only the
  // labels and the tooltip read them as times. Without it, everything passes through as before.
  const { xField, xTimeUnit } = widgetData
  // `colorMap`, `scale` and `axis` as LineChart has them, through the same mapping (chartScale, axisWithInk):
  // series colours from the palette names, the CR's own scale and axis config winning over the defaults.
  const scale = chartScale(widgetData.colorMap, widgetData.scale)
  const inkAxis = axisWithInk(widgetData.axis)
  const labels = xTimeUnit ? barTimeLabels(widgetData.data.map((row) => (row as Record<string, unknown>)[xField]), xTimeUnit) : undefined
  // A CR's own axis.x.labelFormatter still wins over the time labels, as on LineChart.
  const axis = labels ? { ...inkAxis, x: { labelFormatter: (value: unknown) => labels.get(Number(value)) ?? value, ...inkAxis.x } } : inkAxis
  const tooltip = xTimeUnit ? { title: (row: Record<string, unknown>) => barTimeTitle(row[xField], xTimeUnit) } : undefined

  return (
    <div className={styles.chart} ref={ref}>
      <Column
        autoFit
        axis={axis}
        colorField={widgetData.colorField}
        data={widgetData.data}
        group={widgetData.group}
        height={widgetData.height}
        key={uid}
        legend={widgetData.legend === false ? false : inkLegend()}
        onReady={onReady}
        scale={scale}
        stack={widgetData.stack}
        title={widgetData.title}
        {...(tooltip ? { tooltip } : {})}
        xField={widgetData.xField}
        yField={widgetData.yField}
      />
    </div>
  )
}

export default BarChart
