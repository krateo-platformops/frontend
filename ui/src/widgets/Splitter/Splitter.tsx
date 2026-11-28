import { Splitter as AntdSplitter } from 'antd'
import type { PanelProps } from 'antd/es/splitter/interface'

import RefChild, { refChildState } from '../../components/RefChild'
import type { WidgetProps } from '../../types/Widget'

import styles from './Splitter.module.css'
import type { Splitter as WidgetType } from './Splitter.type'

export type SplitterWidgetData = WidgetType['spec']['widgetData']
type Panel = SplitterWidgetData['items'][number]

/** The schema's edge names, as antd's per-panel `collapsible`. */
export const toCollapsible = (edge: Panel['collapsible']): PanelProps['collapsible'] => {
  if (edge === 'both') { return true }
  return edge ? { [edge]: true } : undefined
}

/**
 * Faithful wrapper of antd `Splitter`: panels side by side (or stacked) that the reader resizes by
 * dragging the bar between them. A tree beside the table it filters, a chart above its YAML.
 *
 * Each panel draws a child widget (`resourceRefId`) through RefChild, so a dangling ref says so in
 * its panel and a failed one shows the failure, as in every container. A DENIED ref drops its panel
 * altogether, as Row drops a denied column: an empty panel would hint that something was removed.
 *
 * Sizes are strings, "25%" or "240px", the two units antd takes; the schema's pattern keeps "25" or
 * "a quarter" out at the apiserver. A size the reader drags to lasts until the page reloads.
 */
const Splitter = ({ deniedRefIds, failedRefs, resourcesRefs, uid, widgetData }: WidgetProps<SplitterWidgetData>) => {
  const { height, items, lazy, orientation } = widgetData
  const shown = items.filter(({ resourceRefId }) => refChildState(resourceRefId, resourcesRefs, deniedRefIds, failedRefs) !== 'denied')

  return (
    <AntdSplitter
      className={orientation === 'vertical' ? `${styles.splitter} ${styles.vertical}` : styles.splitter}
      classNames={{ dragger: styles.dragger, panel: styles.panel }}
      key={uid}
      lazy={lazy}
      orientation={orientation}
      style={height ? { height } : undefined}
    >
      {shown.map(({ collapsible, defaultSize, max, min, resizable, resourceRefId }, index) => (
        <AntdSplitter.Panel
          collapsible={toCollapsible(collapsible)}
          defaultSize={defaultSize}
          // The same ref may sit in two panels; the position keeps their keys apart.
          key={`${resourceRefId}-${index}`}
          max={max}
          min={min}
          resizable={resizable}
        >
          <div className={styles.body}>
            <RefChild deniedRefIds={deniedRefIds} failedRefs={failedRefs} label='panel' resourceRefId={resourceRefId} resourcesRefs={resourcesRefs} />
          </div>
        </AntdSplitter.Panel>
      ))}
    </AntdSplitter>
  )
}

export default Splitter
