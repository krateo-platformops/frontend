import { useMemo } from 'react'

import { useFilter } from '../../components/FiltesProvider/FiltersProvider'
import WidgetRenderer from '../../components/WidgetRenderer'
import { WidgetLoading } from '../../components/WidgetStates'
import { useSseStream } from '../../hooks/useSseStream'
import type { WidgetProps } from '../../types/Widget'
import { getEndpointUrl } from '../../utils/utils'

import type { ItemTemplate } from './itemTemplate'
import { ListView } from './ListView'
import type { Listy as WidgetType } from './Listy.type'

export type ListWidgetData = WidgetType['spec']['widgetData']

const hasResourceRef = (item: unknown): item is { resourceRefId: string } =>
  !!item && typeof item === 'object' && typeof (item as { resourceRefId?: unknown }).resourceRefId === 'string'

const List = ({ deniedRefIds, resourcesRefs, uid, widget, widgetData }: WidgetProps<ListWidgetData>) => {
  const { actions, bordered, footer, grid, header, hideWhenEmpty, itemLayout, itemTemplate, loading, maxItems, pagination, prefix, size, split, sseEndpoint, sseTopic } = widgetData

  // `dataSource` is the antd-faithful field; `items` is accepted for back-compat with legacy DataGrid CRs.
  const dataSource = useMemo(
    () => widgetData.dataSource ?? (widgetData as { items?: unknown[] }).items ?? [],
    [widgetData]
  )

  const { getFilteredData } = useFilter()
  const streaming = !!sseEndpoint && !!sseTopic

  const { connecting, items: streamed } = useSseStream<unknown>({
    endpoint: sseEndpoint,
    initial: dataSource,
    max: maxItems ?? 200,
    topic: sseTopic,
  })

  const data = useMemo(() => (streaming ? streamed : dataSource), [streaming, streamed, dataSource])

  // child-widget items filter themselves (prefix is forwarded to their WidgetRenderer);
  // only data-mode items are filtered here.
  const childMode = useMemo(() => data.some(hasResourceRef), [data])
  const filtered = useMemo(
    () => (!childMode && prefix && data.length ? (getFilteredData(data as Record<string, unknown>[], prefix) as unknown[]) : data),
    [childMode, prefix, data, getFilteredData]
  )

  const renderChild = (item: unknown) => {
    if (!hasResourceRef(item)) { return null }
    const endpoint = getEndpointUrl(item.resourceRefId, resourcesRefs)
    return endpoint ? <WidgetRenderer prefix={prefix} widgetEndpoint={endpoint} /> : null
  }

  if (connecting) {
    return <WidgetLoading />
  }

  return (
    <ListView
      actions={actions}
      bordered={bordered}
      deniedRefIds={deniedRefIds}
      footer={footer}
      grid={grid}
      header={header}
      hideWhenEmpty={hideWhenEmpty}
      itemLayout={itemLayout}
      itemTemplate={itemTemplate as ItemTemplate | undefined}
      items={filtered}
      loading={loading}
      pagination={pagination}
      renderChild={renderChild}
      resourcesRefs={resourcesRefs}
      rowKey={uid}
      size={size}
      split={split}
      widget={widget}
    />
  )
}

export default List
