import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Avatar, Flex, Space, Tooltip } from 'antd'

import TimeText from '../../../components/TimeText'
import { getColorCode } from '../../../theme/palette'
import { toInstant } from '../../../utils/dateFormat'
import type { FlowChartNodeData } from '../FlowChart'

import styles from './FlowChartNodeElement.module.css'

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
            {/* How old the resource is ("7 weeks"), full date on hover and focus. A missing or unparseable
                date shows nothing: it rendered "NaN days" once `date` became optional. */}
            {toInstant(date) ? <TimeText className={styles.tagFlow} form='age' value={date} /> : null}
            {version ? <div className={styles.tagFlow}>{version}</div> : null}
          </Flex>
        </div>
      </Space>
    </div>
  )
}

export default FlowChartNodeElement
