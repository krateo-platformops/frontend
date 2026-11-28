import type { TabsProps } from 'antd'
import { Tabs as AntdTabs } from 'antd'
import { useMemo } from 'react'

import RefChild from '../../components/RefChild'
import { WidgetEmpty } from '../../components/WidgetStates'
import type { WidgetProps } from '../../types/Widget'

import styles from './Tabs.module.css'
import type { Tabs as WidgetType } from './Tabs.type'

export type TabsWidgetData = WidgetType['spec']['widgetData']

const Tabs = ({ deniedRefIds, failedRefs, resourcesRefs, uid, widgetData }: WidgetProps<TabsWidgetData>) => {
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
              deniedRefIds={deniedRefIds} failedRefs={failedRefs}
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
  }, [deniedRefIds, failedRefs, items, resourcesRefs, uid])

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

  // ...and keeps the address in step: choosing a tab REPLACES `?tab=<label>` in the current entry
  // (no new history entry, so Back still leaves the page), so the address always names the open
  // tab, a copied link reopens it, and a same-page navigation keeps it (utils/navigation
  // PAGE_STATE_PARAMS: the /observability range chips no longer jump back to the first tab).
  // `history.replaceState` with the current state, as context/pageFragment does: the router is not
  // asked to navigate, so no widget re-renders or refetches, and `tab` is page state that widget
  // queries leave out (useWidgetQuery buildExtrasParam).
  const keepTabInAddress = (key: string) => {
    if (typeof window === 'undefined') { return }
    const index = tabItems.findIndex((item) => item.key === key)
    const label = (items[index]?.label ?? '').trim()
    if (!label) { return }
    const url = new URL(window.location.href)
    if (url.searchParams.get('tab') === label) { return }
    url.searchParams.set('tab', label)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }

  if (!items.length) {
    return <WidgetEmpty description='No tabs to show' />
  }

  return <AntdTabs centered={centered} className={styles.tabs} defaultActiveKey={defaultActiveKey} items={tabItems} key={uid} onChange={keepTabInAddress} size={size} tabPlacement={tabPlacement} type={type} />
}

export default Tabs
