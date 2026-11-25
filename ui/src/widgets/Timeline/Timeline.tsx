import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Timeline as AntdTimeline } from 'antd'

import RefChild from '../../components/RefChild'
import { getColorCode } from '../../theme/palette'
import type { WidgetProps } from '../../types/Widget'

import styles from './Timeline.module.css'
import type { Timeline as WidgetType } from './Timeline.type'

export type TimelineWidgetData = WidgetType['spec']['widgetData']

/**
 * Faithful wrapper of antd `Timeline`, for chronological data: a composition's Kubernetes events,
 * release history, an audit trail.
 *
 * Each item's `title` sits on the opposite side of the rail and is usually a timestamp, so it is set
 * in the data face (JetBrains Mono, muted) as the agent's run timeline sets its clock. A dot's `color`
 * is a palette NAME, the same enum Progress, Table, FlowChart and PageHeader take, resolved through
 * getColorCode for the active mode (so `red` is the theme's red, not antd's preset). Unset, antd's
 * default dot, which the theme bridge makes the primary.
 *
 * An item's `resourceRefId` renders a child widget under its content through RefChild, so a dangling
 * ref says so in place, a failed one shows its failure, and a denied one reads as absence (X2/X4) —
 * as in every other container.
 */
const Timeline = ({ deniedRefIds, failedRefs, resourcesRefs, uid, widgetData }: WidgetProps<TimelineWidgetData>) => {
  const { items, mode, orientation, reverse, titleSpan, variant } = widgetData

  return (
    <AntdTimeline
      className={styles.timeline}
      items={items.map(({ color, content, icon, loading, placement, resourceRefId, title }) => ({
        color: color ? getColorCode(color) : undefined,
        content: resourceRefId
          ? (
            <>
              {content && <span>{content}</span>}
              <div className={styles.child}>
                <RefChild deniedRefIds={deniedRefIds} failedRefs={failedRefs} label='timeline item' resourceRefId={resourceRefId} resourcesRefs={resourcesRefs} />
              </div>
            </>
          )
          : content,
        icon: icon ? <FontAwesomeIcon icon={icon as IconProp} /> : undefined,
        loading,
        placement,
        title: title ? <span className={styles.title}>{title}</span> : undefined,
      }))}
      key={uid}
      mode={mode}
      orientation={orientation}
      reverse={reverse}
      titleSpan={titleSpan}
      variant={variant}
    />
  )
}

export default Timeline
