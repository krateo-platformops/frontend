import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Steps as AntdSteps } from 'antd'

import WidgetRenderer from '../../components/WidgetRenderer'
import type { WidgetProps } from '../../types/Widget'
import { getEndpointUrl } from '../../utils/utils'
import { useAnyFormReviewing } from '../Form/reviewPhase'

import styles from './Steps.module.css'
import type { Steps as WidgetType } from './Steps.type'

export type StepsWidgetData = WidgetType['spec']['widgetData']

const Steps = ({ resourcesRefs, uid, widgetData }: WidgetProps<StepsWidgetData>) => {
  const { current, items, orientation, reviewCurrent, size, status, titlePlacement, type } = widgetData
  // A wizard whose last step is a Form's Review: while that review shows, the header says so.
  const formReviewing = useAnyFormReviewing()

  return (
    <AntdSteps
      className={styles.steps}
      current={formReviewing && reviewCurrent !== undefined ? reviewCurrent : current}
      items={items.map(({ description, eyebrow, icon, resourceRefId, status: itemStatus, subTitle, title }, index) => {
        const endpoint = resourceRefId ? getEndpointUrl(resourceRefId, resourcesRefs) : undefined
        return {
          description: endpoint
            ? (
              <>
                {description && <span>{description}</span>}
                <WidgetRenderer key={`${uid}-step-${index}`} widgetEndpoint={endpoint} />
              </>
            )
            : description,
          icon: icon ? <FontAwesomeIcon icon={icon as IconProp} /> : undefined,
          status: itemStatus,
          subTitle,
          // A per-item "eyebrow" (e.g. "Step 1") renders mono/uppercase ABOVE the title — antd
          // Steps has no above-title slot, so compose the title node ourselves when set.
          title: eyebrow
            ? (
              <span className={styles.titleStack}>
                <span className={styles.eyebrow}>{eyebrow}</span>
                <span>{title}</span>
              </span>
            )
            : title,
        }
      })}
      key={uid}
      orientation={orientation}
      size={size}
      status={status}
      titlePlacement={titlePlacement}
      type={type}
    />
  )
}

export default Steps
