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

  // X8 — layout maths runs on the children that SURVIVE, not the ones declared. A denied ref
  // drops its whole column below, so counting it left dead grid space: four items with one
  // denial rendered three span-6 columns — 18 of 24 units — and a hole on the right, instead
  // of three span-8 columns filling the row.
  //
  // A DANGLING ref still counts. X4 deliberately kept its column so the grid does not reflow
  // around the visible error Result, so only denials are dropped here.
  //
  // The authored index is threaded through instead of using the filtered position, and that is
  // load-bearing rather than style: the keys below are index-derived, so renumbering them when
  // a denial appears would remount every surviving WidgetRenderer. A remount is a refetch, and
  // for a Form child a refetch wipes the user's dirty state.
  const visibleItems = items
    .map((item, index) => ({ index, item }))
    .filter(({ item }) => refChildState(item.resourceRefId, resourcesRefs, deniedRefIds) !== 'denied')

  const defaultSize = Math.floor(24 / visibleItems.length) || 24

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
        {visibleItems
          .map(({ index, item: { alignment, lg, md, resourceRefId, size, sm, xl, xs, xxl } }) => {
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
        }
      </AntdRow>
    </div>
  )
}

export default Row
