import { Line } from '@ant-design/plots'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import { WidgetEmpty } from '../../components/WidgetStates'
import { useAutoFitChart } from '../../hooks/useAutoFitChart'
import { axisWithInk, chartScale, getChartCatPalette } from '../../theme/chart-utils'
import { getColorCode } from '../../theme/palette'
import type { WidgetProps } from '../../types/Widget'
import { formatClock, formatDate, formatFull, formatFullDay } from '../../utils/dateFormat'

import styles from './LineChart.module.css'
import type { LineChart as WidgetType } from './LineChart.type'

export type LineChartWidgetData = WidgetType['spec']['widgetData']

/**
 * M4 (approved motion set): the line draws in, left to right, on the chart's FIRST paint, only when
 * the chart is on screen at that moment and the reader has not asked for reduced motion. A chart
 * reached by scrolling appears already drawn, so nothing moves under someone who is reading, and a
 * refresh or a range change never replays it (`update: false`): the decision is made once.
 */
export const DRAW_IN = { enter: { duration: 400, easing: 'ease-out', type: 'pathIn' as const }, exit: false, update: false }

export const shouldDrawIn = (element: Element | null): boolean => {
  if (!element || typeof window === 'undefined') { return false }
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { return false }
  const box = element.getBoundingClientRect()
  return box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth
}

/**
 * Gradient area fill beneath the line when `widgetData.area` is true: the first categorical
 * chart colour at 0.30 alpha fading to transparent, so it matches the auto-assigned line colour
 * (chart-cat-01, read per mode). It used getColorCode('blue'), which equalled cat-01 only while
 * both were the Krateo blue; `blue` is now the Agentiko brand blue, and the chart palette is
 * Tier-2 locked. (G2 parses the CSS linear-gradient; rgba keeps
 * its colour parser happy — color-mix is not.)
 */
const brandAreaFill = (): { style: { fill: string } } => {
  const [hex] = getChartCatPalette()
  const channel = (start: number) => parseInt(hex.slice(start, start + 2), 16)
  const rgb = `${channel(1)},${channel(3)},${channel(5)}`
  return { style: { fill: `linear-gradient(180deg, rgba(${rgb},0.30) 0%, rgba(${rgb},0) 100%)` } }
}

/**
 * Centered legend below the chart — G2's legend is keyed by the `color` channel
 * (driven by `colorField`). `itemLabelFill` = theme ink so the legend text is legible on
 * the Petrol void (G2's default is near-black). A function so getColorCode re-evaluates per
 * render/mode toggle.
 */
const centeredLegend = () => ({ color: { itemLabelFill: getColorCode('text'), layout: { justifyContent: 'center' }, position: 'bottom' } })

type TimeUnit = NonNullable<LineChartWidgetData['xTimeUnit']>

const isMidnight = (date: Date): boolean => formatClock(date) === '00:00'

/**
 * A tick on a time axis, in the VIEWER's time zone, as all text is (utils/dateFormat; a server-side strftime is
 * UTC: a 21:00-Rome bucket read 19:00). An hourly axis names the day where it changes ("4 Nov", with the year
 * when it is another year), so a week reads as days and a day as hours ("11:00"); a daily axis labels days only.
 */
export const timeTick = (value: unknown, unit: TimeUnit): unknown => {
  if (!(value instanceof Date)) { return value }
  if (unit === 'day') { return isMidnight(value) ? formatDate(value) : '' }
  return isMidnight(value) ? formatDate(value) : formatClock(value)
}

/**
 * A point's own time, whole, as every time's hover is: "Tue 24 November 2026, 08:00:00 (UTC+1)", the zone named
 * so a chart and the text beside it can be told to agree; a daily bucket is its day, "Tue 24 November 2026".
 */
export const timeTitle = (value: unknown, unit: TimeUnit): unknown => {
  if (!(value instanceof Date)) { return value }
  return unit === 'day' ? formatFullDay(value) : formatFull(value)
}

/**
 * Every `xField` epoch (seconds) becomes its moment, in the data AND in the annotations that carry the field (the
 * peak `point`, the `lineX` "now" mark), so the axis places points by TIME. They used to become their label
 * ("11:00") on a categorical axis: a day apart was the same place, so a 24 h line ran back across the plot and a
 * week was folded onto a few hours.
 */
const placeInTime = (
  data: LineChartWidgetData['data'],
  annotations: LineChartWidgetData['annotations'],
  xField: string,
) => {
  const moment = (value: unknown) => (typeof value === 'number' ? new Date(value * 1000) : value)
  const timedData = data.map((row) => ({ ...row, [xField]: moment(row[xField]) }))
  const timedAnnotations = annotations?.map((mark) => {
    const markData = (mark as { data?: unknown }).data
    if (!Array.isArray(markData)) {
      return mark
    }
    const moved = markData.map((item) => (item && typeof item === 'object'
      ? { ...(item as object), [xField]: moment((item as Record<string, unknown>)[xField]) }
      : moment(item)))
    return { ...mark, data: moved }
  })
  return { timedAnnotations, timedData }
}

/**
 * Faithful wrapper of the @ant-design/plots `Line` (AntV G2). widgetData maps
 * 1:1 onto the library's config (data + field mappings); colors come from G2's
 * palette via `colorField`, not a Krateo enum.
 */
const LineChart = ({ uid, widgetData }: WidgetProps<LineChartWidgetData>) => {
  // Gate the chart on a measured (>0) container width so autoFit's FIRST paint runs against a real
  // size (no 0/transient-width layout race, e.g. a donut centre off-canvas). After that, autoFit owns
  // sizing, at the current pixel ratio — passing a fixed width instead left the canvas locked to its
  // initial size, so a page-zoom shrank the container while the canvas stayed wide and the plot got
  // cropped. But G2's autoFit listens to `window` 'resize' only (a browser zoom fires it); it has no
  // ResizeObserver on the container. A chart that re-rendered in a display:none tab pane drew at G2's
  // 640px default and kept it when the tab came back (issue #603), so `useAutoFitChart` re-fits the
  // chart on every non-zero measurement of the container — see that hook.
  const { onReady, ref, width } = useAutoFitChart<HTMLDivElement>()
  const height = widgetData.height ?? 300
  // Decided once, when the container first has a width (the chart's first paint), before the browser
  // paints: undefined until then, so the Line never mounts with a guess.
  const [drawIn, setDrawIn] = useState<boolean | undefined>(undefined)
  const box = useRef<HTMLDivElement | null>(null)
  const boxRef = useCallback((element: HTMLDivElement | null) => {
    box.current = element
    ref(element)
  }, [ref])
  useLayoutEffect(() => {
    if (width > 0 && drawIn === undefined) { setDrawIn(shouldDrawIn(box.current)) }
  }, [drawIn, width])

  if (!widgetData.data?.length) {
    return <WidgetEmpty description='No data to chart' />
  }

  // When the CR marks xField as epochs (`xTimeUnit`), the x axis is time — otherwise data and annotations
  // pass through verbatim (the server already supplied labels).
  const { xField, xTimeUnit } = widgetData
  const { timedAnnotations, timedData } = xTimeUnit
    ? placeInTime(widgetData.data, widgetData.annotations, xField)
    : { timedAnnotations: widgetData.annotations, timedData: widgetData.data }

  // SERIES colours from `colorMap`, else the v2 categorical chart palette, merged into the CR's scale
  // (chartScale, shared with BarChart).
  const scale = chartScale(widgetData.colorMap, widgetData.scale)
  // A CR's own scale.x or axis.x still wins, as everywhere in this widget.
  const timeScale = xTimeUnit ? { ...scale, x: { type: 'time', ...(scale as { x?: object }).x } } : scale
  const axis = axisWithInk(widgetData.axis)
  const timeAxis = xTimeUnit ? { ...axis, x: { labelFormatter: (value: unknown) => timeTick(value, xTimeUnit), ...axis.x } } : axis
  const tooltip = xTimeUnit ? { title: (row: Record<string, unknown>) => timeTitle(row[xField], xTimeUnit) } : undefined

  return (
    <div className={styles.lineChart} ref={boxRef} style={{ height }}>
      {width > 0 && drawIn !== undefined ? (
        <Line
          animate={drawIn ? DRAW_IN : false}
          annotations={timedAnnotations}
          area={widgetData.area ? brandAreaFill() : undefined}
          autoFit
          axis={timeAxis}
          colorField={widgetData.colorField}
          data={timedData}
          key={uid}
          legend={widgetData.legend === false ? false : centeredLegend()}
          onReady={onReady}
          point={widgetData.point}
          scale={timeScale}
          shapeField={widgetData.shapeField}
          stack={widgetData.stack}
          title={widgetData.title}
          {...(tooltip ? { tooltip } : {})}
          xField={widgetData.xField}
          yField={widgetData.yField}
        />
      ) : null}
    </div>
  )
}

export default LineChart
