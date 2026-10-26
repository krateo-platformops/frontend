import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Timeline as AntdTimeline } from 'antd'

import WidgetRenderer from '../../components/WidgetRenderer'
import type { WidgetProps } from '../../types/Widget'
import { getEndpointUrl } from '../../utils/utils'

import type { Timeline as WidgetType } from './Timeline.type'

export type TimelineWidgetData = WidgetType['spec']['widgetData']

const Timeline = ({ resourcesRefs, uid, widgetData }: WidgetProps<TimelineWidgetData>) => {
  const { items, mode, orientation, reverse, titleSpan, variant } = widgetData

  return (
    <AntdTimeline
      items={items.map(({ color, content, icon, loading, placement, resourceRefId, title }, index) => {
        const endpoint = resourceRefId ? getEndpointUrl(resourceRefId, resourcesRefs) : undefined
        return {
          color,
          content: endpoint
            ? (
              <>
                {content && <span>{content}</span>}
                <WidgetRenderer key={`${uid}-timeline-${index}`} widgetEndpoint={endpoint} />
              </>
            )
            : content,
          icon: icon ? <FontAwesomeIcon icon={icon as IconProp} /> : undefined,
          loading,
          placement,
          title,
        }
      })}
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
