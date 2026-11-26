import { Statistic as AntdStatistic } from 'antd'

import TimeText from '../../components/TimeText'
import type { WidgetProps } from '../../types/Widget'
import { toInstant } from '../../utils/dateFormat'

import styles from './Statistic.module.css'
import type { Statistic as WidgetType } from './Statistic.type'

export type StatisticWidgetData = WidgetType['spec']['widgetData']

const Statistic = ({ uid, widgetData: { format, ...widgetData } }: WidgetProps<StatisticWidgetData>) => {
  // Distinguish a GENUINE computed value (including 0) from data-missing: null / undefined /
  // empty-string means the source produced nothing, so render a MUTED em-dash instead of a
  // bare blank that a viewer would read as a real zero. A genuine 0 still renders as "0".
  const isMissing = widgetData.value === undefined || widgetData.value === null || widgetData.value === ''
  if (!isMissing) {
    // `format`: the value is an ISO time, written in its form in the browser (utils/dateFormat), full date on hover.
    const time = format && toInstant(widgetData.value) ? { formatter: () => <TimeText form={format} value={widgetData.value} /> } : {}
    return <AntdStatistic className={styles.statistic} key={uid} {...widgetData} {...time} />
  }

  return (
    <AntdStatistic
      {...widgetData}
      className={styles.statistic}
      key={uid}
      // Drop prefix/suffix so a "$—" or "—%" never frames the missing marker.
      prefix={undefined}
      suffix={undefined}
      value='—'
      valueStyle={{ ...(widgetData.valueStyle ?? {}), opacity: 0.45 }}
    />
  )
}

export default Statistic
