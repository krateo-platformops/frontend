import { Flex as AntdFlex } from 'antd'

import RefChild from '../../components/RefChild'
import type { WidgetProps } from '../../types/Widget'

import type { Flex as WidgetType } from './Flex.type'

export type FlexWidgetData = WidgetType['spec']['widgetData']

const Flex = ({ deniedRefIds, resourcesRefs, uid, widgetData }: WidgetProps<FlexWidgetData>) => {
  const { align, gap, items, justify, vertical, wrap } = widgetData

  return (
    <AntdFlex align={align} gap={gap} justify={justify} key={uid} vertical={vertical} wrap={wrap}>
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
