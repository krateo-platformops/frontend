import { Col as AntdColumn, Row as AntdRow } from 'antd'

import RefChild, { refChildState } from '../../components/RefChild'
import type { WidgetProps } from '../../types/Widget'

import styles from './Row.module.css'
import type { Row as WidgetType } from './Row.type'

export type RowWidgetData = WidgetType['spec']['widgetData']

const justifyContentMap: Record<
  NonNullable<RowWidgetData['items'][number]['alignment']>,
  React.CSSProperties['justifyContent']
> = {
  center: 'center',
  left: 'flex-start',
  right: 'flex-end',
}

const Row = ({ deniedRefIds, resourcesRefs, uid, widgetData }: WidgetProps<RowWidgetData>) => {
  const { alignment, items } = widgetData

  const defaultSize = Math.floor(24 / items.length) || 24

  return (
    <div className={styles.row}>
      <AntdRow
        // Default to 'stretch' so columns fill the row height and sibling cards stay
        // equal-height when one wraps to an extra line (e.g. the dashboard stat cards
        // once the Autopilot rail narrows the content). Matches the `.ant-row > div > *
        // { height: 100% }` rule in Row.module.css; an explicit `alignment` still wins.
        align={alignment ?? 'stretch'}
        gutter={[16, 16]}
        key={uid}
        wrap
      >
        {items
          .map(({ alignment, lg, md, resourceRefId, size, sm, xl, xs, xxl }, index) => {
            // A DENIED ref drops the whole column, exactly as before this change — see
            // refChildState. A dangling one keeps its column so the grid does not reflow.
            if (refChildState(resourceRefId, resourcesRefs, deniedRefIds) === 'denied') { return null }

            return (
              // `size` is the base span; the optional xs/sm/md/lg/xl/xxl overrides let a row reflow
              // responsively (e.g. when the Autopilot rail narrows the content column).
              <AntdColumn
                className={styles.column}
                key={`${uid}-col-${index}`}
                lg={lg}
                md={md}
                sm={sm}
                span={size ?? defaultSize}
                style={{
                  display: alignment ? 'flex' : undefined,
                  justifyContent: alignment ? justifyContentMap[alignment] : undefined,
                }}
                xl={xl}
                xs={xs}
                xxl={xxl}
              >
                <RefChild
                  deniedRefIds={deniedRefIds}
                  key={`${uid}-${index}`}
                  label='column'
                  resourceRefId={resourceRefId}
                  resourcesRefs={resourcesRefs}
                />
              </AntdColumn>
            )
          })
          .filter(Boolean)
        }
      </AntdRow>
    </div>
  )
}

export default Row
