import { Line } from '@ant-design/plots'

import { WidgetEmpty } from '../../components/WidgetStates'
import { useAutoFitChart } from '../../hooks/useAutoFitChart'
import { getChartCatPalette } from '../../theme/chart-utils'
import { getColorCode } from '../../theme/palette'
import type { WidgetProps } from '../../types/Widget'

import styles from './LineChart.module.css'
import type { LineChart as WidgetType } from './LineChart.type'

export type LineChartWidgetData = WidgetType['spec']['widgetData']

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

/**
 * Default axis tick/title fill = theme ink (G2's near-black default is invisible on the
 * Petrol void). Merged UNDER the CR's own `axis.x`/`axis.y`, so any explicit per-axis
 * config still wins; preserves any other axis keys the CR set.
 */
const axisWithInk = (axis: LineChartWidgetData['axis']) => {
  const ink = getColorCode('gray')
  const axisObj = (axis ?? {}) as Record<string, unknown>
  const merge = (key: 'x' | 'y') => ({ labelFill: ink, titleFill: ink, ...((axisObj[key] as Record<string, unknown> | undefined) ?? {}) })
  return { ...axisObj, x: merge('x'), y: merge('y') }
}

/**
 * Format a UNIX epoch (seconds) to an x-axis label in the BROWSER's local timezone — the fix
 * for server-side `gmtime|strftime` rendering UTC (a 21:00-Rome bucket showed 19:00). `Date`
 * accessors (`getHours`) and `toLocaleDateString` both resolve to the local zone (full IANA
 * rules incl. DST), so this is correct even across a DST boundary inside a 30-day window.
 * Non-numbers pass through unchanged (already-formatted labels / non-epoch xFields).
 */
const formatEpochLabel = (value: unknown, unit: 'hour' | 'day'): unknown => {
  if (typeof value !== 'number') {
    return value
  }
  const date = new Date(value * 1000)
  if (unit === 'hour') {
    return `${String(date.getHours()).padStart(2, '0')}:00`
  }
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

/**
 * Localize every `xField` value (epoch → local label) in the data AND in any annotations that
 * carry the same field, so the peak `point` (objects with `xField`) and the `lineX` "now" mark
 * (bare x values) stay aligned to their categorical band after the data is relabelled.
 */
const localizeXField = (
  data: LineChartWidgetData['data'],
  annotations: LineChartWidgetData['annotations'],
  xField: string,
  unit: 'hour' | 'day',
) => {
  const fmt = (value: unknown) => formatEpochLabel(value, unit)
  const localData = data.map((row) => ({ ...row, [xField]: fmt(row[xField]) }))
  const localAnnotations = annotations?.map((mark) => {
    const markData = (mark as { data?: unknown }).data
    if (!Array.isArray(markData)) {
      return mark
    }
    const relabeled = markData.map((item) => {
      if (item && typeof item === 'object') {
        return { ...(item as object), [xField]: fmt((item as Record<string, unknown>)[xField]) }
      }
      return fmt(item)
    })
    return { ...mark, data: relabeled }
  })
  return { localAnnotations, localData }
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

  if (!widgetData.data?.length) {
    return <WidgetEmpty description='No data to chart' />
  }

  // When the CR marks xField as epochs (`xTimeUnit`), relabel data + annotations to the browser's
  // local timezone here — otherwise pass both through verbatim (server already supplied labels).
  const { localAnnotations, localData } = widgetData.xTimeUnit
    ? localizeXField(widgetData.data, widgetData.annotations, widgetData.xField, widgetData.xTimeUnit)
    : { localAnnotations: widgetData.annotations, localData: widgetData.data }

  // SERIES colours: map each colorField category → a palette hex (mirrors PieChart.colorMap),
  // merged into the CR's scale. Without an operator colorMap, auto-assigned series (and a single
  // line) take the v2 categorical chart palette — cat-01 is brand blue, matching the area fill —
  // instead of G2's default palette. A CR-supplied scale.color still wins.
  const { colorMap } = widgetData
  const scale = colorMap
    ? { ...widgetData.scale, color: { domain: Object.keys(colorMap), range: Object.keys(colorMap).map((key) => getColorCode(colorMap[key])) } }
    : { color: { range: getChartCatPalette() }, ...widgetData.scale }

  return (
    <div className={styles.lineChart} ref={ref} style={{ height }}>
      {width > 0 ? (
        <Line
          annotations={localAnnotations}
          area={widgetData.area ? brandAreaFill() : undefined}
          autoFit
          axis={axisWithInk(widgetData.axis)}
          colorField={widgetData.colorField}
          data={localData}
          key={uid}
          legend={widgetData.legend === false ? false : centeredLegend()}
          onReady={onReady}
          point={widgetData.point}
          scale={scale}
          shapeField={widgetData.shapeField}
          stack={widgetData.stack}
          title={widgetData.title}
          xField={widgetData.xField}
          yField={widgetData.yField}
        />
      ) : null}
    </div>
  )
}

export default LineChart
