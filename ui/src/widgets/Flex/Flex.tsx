import { Flex as AntdFlex } from 'antd'

import RefChild from '../../components/RefChild'
import type { WidgetProps } from '../../types/Widget'

import type { Flex as WidgetType } from './Flex.type'

export type FlexWidgetData = WidgetType['spec']['widgetData']

const Flex = ({ deniedRefIds, resourcesRefs, uid, widgetData }: WidgetProps<FlexWidgetData>) => {
  const { align, ariaLabel, gap, items, justify, role, vertical, wrap } = widgetData

  // `role` / `ariaLabel` name the Flex for assistive technology: a filter bar as a `search`
  // landmark, a result count as a `status` live region. Absent, React writes neither attribute, so
  // a Flex that sets neither renders exactly the DOM it always did (Flex.unchanged.test.tsx).
  return (
    <AntdFlex align={align} aria-label={ariaLabel} gap={gap} justify={justify} key={uid} role={role} vertical={vertical} wrap={wrap}>
      {items.map(({ resourceRefId }, index) => (
        <RefChild
          deniedRefIds={deniedRefIds}
          key={`${uid}-${index}`}
          label='item'
          resourceRefId={resourceRefId}
          resourcesRefs={resourcesRefs}
        />
      ))}
    </AntdFlex>
  )
}

export default Flex
