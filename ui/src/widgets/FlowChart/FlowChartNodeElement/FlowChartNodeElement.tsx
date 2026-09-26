import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Avatar, Flex, Space, Tooltip } from 'antd'

import { getColorCode } from '../../../theme/palette'
import { formatISODate } from '../../../utils/utils'
import type { FlowChartNodeData } from '../FlowChart'

import styles from './FlowChartNodeElement.module.css'

/**
 * "N days" since `isoDate`, or null when there is no date to count from. `date` became optional when
 * the architecture variant loosened the item's required fields, and a missing or unparseable date
 * rendered "NaN days".
 */
const getDaysPeriod = (isoDate: string | undefined): string | null => {
  const then = isoDate ? new Date(isoDate).getTime() : Number.NaN
  if (Number.isNaN(then)) {
    return null
  }
  const deltaMSeconds = new Date().getTime() - then
  const days = Math.floor(deltaMSeconds / 24 / 60 / 60 / 1000)

  return days !== 1 ? `${days} days` : `${days} day`
}

const fallbackIcon = { color: getColorCode('gray'), name: 'fa-question' }

const renderIcon = (icon: { name?: string; color?: string; message?: string }, size: number = 40) => {
  const { color, message, name } = icon

  const avatar = (
    <Avatar
      icon={<FontAwesomeIcon icon={(name || fallbackIcon.name) as IconProp} />}
      size={size}
      style={{ backgroundColor: (getColorCode(color) || fallbackIcon.color), color: 'white' }}
    />
  )

  return message
    ? <Tooltip title={message}><div>{avatar}</div></Tooltip>
    : avatar
}

const FlowChartNodeElement = ({ data }: { data: FlowChartNodeData }) => {
  const { date, icon, kind, name, namespace, statusIcon, version } = data
  const period = getDaysPeriod(date)

  return (
    <div className={styles.node}>
      <Space>
        {renderIcon(icon || fallbackIcon)}
        <div>
          <div className={styles.header}>{name}</div>
          {namespace && <div className={styles.subHeader}>NS: {namespace}</div>}
          <div className={styles.body}>{kind}</div>
          <Flex align='center' className={styles.footer} gap={5}>
            {renderIcon(statusIcon || fallbackIcon, 32)}
            {date && period
              ? (
                <Tooltip title={formatISODate(date, true)}>
                  <div className={styles.tagFlow}>{period}</div>
                </Tooltip>
              )
              : null}
            {version ? <div className={styles.tagFlow}>{version}</div> : null}
          </Flex>
        </div>
      </Space>
    </div>
  )
}

export default FlowChartNodeElement
