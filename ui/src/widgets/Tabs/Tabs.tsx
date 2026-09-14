import type { TabsProps } from 'antd'
import { Tabs as AntdTabs } from 'antd'
import { useMemo } from 'react'

import RefChild from '../../components/RefChild'
import { WidgetEmpty } from '../../components/WidgetStates'
import type { WidgetProps } from '../../types/Widget'

import styles from './Tabs.module.css'
import type { Tabs as WidgetType } from './Tabs.type'

export type TabsWidgetData = WidgetType['spec']['widgetData']

const Tabs = ({ deniedRefIds, resourcesRefs, uid, widgetData }: WidgetProps<TabsWidgetData>) => {
  const { centered, items, size, tabPlacement, type } = widgetData

  const tabItems = useMemo(() => {
    return items.reduce<NonNullable<TabsProps['items']>>((acc, { label, resourceRefId, title }, index) => {
      acc.push({
        children: (
          <div className={styles.container}>
            {title && <div className={styles.title}>{title}</div>}
            {/* X4: Tabs was the ONLY container that told the author what was wrong, so its
                behaviour became the contract. It now uses the shared component rather than its own
                copy — `label='tab'` reproduces the previous strings byte-for-byte. */}
            <RefChild
              deniedRefIds={deniedRefIds}
              label='tab'
              resourceRefId={resourceRefId}
              resourcesRefs={resourcesRefs}
            />
          </div>
        ),
        key: `${uid}-${index}`,
        label,
      })

      return acc
    }, [])
  }, [deniedRefIds, items, resourcesRefs, uid])

  // Deep-linkable active tab: a `?tab=<label>` query param selects the initial tab (matched by
  // label, case-insensitive). Lets hand-offs open a specific tab — e.g. the Observability page's
  // service-log drill-down navigates to `/observability?svc=…&tab=Telemetry` so it lands on the
  // logs instead of the default first tab. Uncontrolled (defaultActiveKey), so the user can still
  // switch freely; when the param is absent or matches no label, antd falls back to the first tab
  // (no behaviour change otherwise).
  const defaultActiveKey = useMemo(() => {
    if (typeof window === 'undefined') { return undefined }
    const param = new URLSearchParams(window.location.search).get('tab')
    const requested = param?.trim().toLowerCase()
    if (!requested) { return undefined }
    const index = items.findIndex(({ label }) => (label ?? '').trim().toLowerCase() === requested)
    return index >= 0 ? `${uid}-${index}` : undefined
  }, [items, uid])

  if (!items.length) {
    return <WidgetEmpty description='No tabs to show' />
  }

  return <AntdTabs centered={centered} className={styles.tabs} defaultActiveKey={defaultActiveKey} items={tabItems} key={uid} size={size} tabPlacement={tabPlacement} type={type} />
}

export default Tabs
