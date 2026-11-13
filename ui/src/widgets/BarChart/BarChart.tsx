import { Column } from '@ant-design/plots'

import { WidgetEmpty } from '../../components/WidgetStates'
import { useAutoFitChart } from '../../hooks/useAutoFitChart'
import { getChartCatPalette } from '../../theme/chart-utils'
import { getColorCode } from '../../theme/palette'
import type { WidgetProps } from '../../types/Widget'

import styles from './BarChart.module.css'
import type { BarChart as WidgetType } from './BarChart.type'

export type BarChartWidgetData = WidgetType['spec']['widgetData']

// G2 axis ticks/titles and legend text default to near-black — invisible on the dark Petrol
// void. Force theme ink so labels are legible in BOTH themes; getColorCode reads data-theme,
// so the colour follows the light/dark toggle (mirrors LineChart/PieChart). Functions, not
// constants, so they re-evaluate per render after a theme switch.
const axisInk = () => {
  const ink = getColorCode('gray')
  return { x: { labelFill: ink, titleFill: ink }, y: { labelFill: ink, titleFill: ink } }
}
const inkLegend = () => ({ color: { itemLabelFill: getColorCode('text') } })

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

  return (
    <div className={styles.chart} ref={ref}>
      <Column
        autoFit
        axis={axisInk()}
        colorField={widgetData.colorField}
        data={widgetData.data}
        group={widgetData.group}
        height={widgetData.height}
        key={uid}
        legend={widgetData.legend === false ? false : inkLegend()}
        onReady={onReady}
        scale={{ color: { range: getChartCatPalette() } }}
        stack={widgetData.stack}
        title={widgetData.title}
        xField={widgetData.xField}
        yField={widgetData.yField}
      />
    </div>
  )
}

export default BarChart
