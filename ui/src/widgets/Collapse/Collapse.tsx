import { Collapse as AntdCollapse, Tag, Typography } from 'antd'
import type { CollapseProps } from 'antd'

import RefChild from '../../components/RefChild'
import type { WidgetProps } from '../../types/Widget'
import { ListView } from '../List/ListView'

import styles from './Collapse.module.css'
import type { Collapse as WidgetType } from './Collapse.type'

// T2 opt-out: antd Collapse already renders in four places (SchemaFields, PalettePanel, KindInspector, the Agentiko preview surface), and a buildComponents entry would restyle all of them; this widget keeps the density they have, and a theme entry is its own change with those four in view.

export type CollapseWidgetData = WidgetType['spec']['widgetData']
type Panel = CollapseWidgetData['items'][number]

/**
 * The panels open on first render. The CR's `defaultActiveKey` when it gives one; otherwise every
 * panel carrying a `status` — the exception groups (what is broken, what needs a decision) start
 * open and the settled ones (Resolved, Closed, Ready) start folded, so a page opens on what needs
 * the reader and the rest is one click away.
 */
export const openByDefault = (items: Panel[], defaultActiveKey: string[] | undefined): string[] =>
  defaultActiveKey ?? items.filter((panel) => panel.status).map((panel) => panel.key)

/**
 * The slice of a panel's dataSource it draws, and whether its footer shows. Without `cap`, all of it
 * and the footer whenever set: the data was capped server-side, and only the server knows there is
 * more. With `cap`, the first `cap` items, and the footer only when that left some out.
 */
export const cappedBody = (panel: Pick<Panel, 'cap' | 'dataSource' | 'footer'>): { footer?: string; items: unknown[] } => {
  const items = panel.dataSource ?? []
  if (!panel.cap) { return { footer: panel.footer, items } }
  return { footer: items.length > panel.cap ? panel.footer : undefined, items: items.slice(0, panel.cap) }
}

/**
 * Faithful wrapper of antd `Collapse`, with its panels from data.
 *
 * A root page groups what it shows — one group per alert, per target repo, per day — and the number
 * of groups is known only when the data is. A CR cannot instantiate N copies of a child widget with
 * N different slices of data (a `resourcesRefsTemplate` ref carries no per-instance data), so the
 * panels are `widgetData.items`, templated from the page's RESTAction.
 *
 * Each panel's body is either a child widget (`resourceRefId`: a table that already exists, say) or
 * its own `dataSource`, rendered through the SAME ListView a Listy uses, with the widget's shared
 * `itemTemplate` and `grid`: the cards in a group are the cards a Listy draws, not a second
 * implementation of them. antd mounts a panel's body the first time it opens, so a folded panel's
 * child widget is not fetched until someone asks for it.
 *
 * The header is the panel's title, then a count badge (an antd Tag, neutral unless the panel's
 * `status` calls for the error or warning tint — exception-only), then antd's muted `extra`. antd
 * renders the header as a button with `aria-expanded`, toggled by Enter, so its accessible name is
 * the title AND the count.
 */
const Collapse = ({ deniedRefIds, resourcesRefs, uid, widget, widgetData }: WidgetProps<CollapseWidgetData>) => {
  const { accordion, actions, bordered, defaultActiveKey, ghost, grid, itemTemplate, items, size } = widgetData

  const body = (panel: Panel) => {
    if (panel.resourceRefId) {
      return <RefChild deniedRefIds={deniedRefIds} label='panel' resourceRefId={panel.resourceRefId} resourcesRefs={resourcesRefs} />
    }
    if (!panel.dataSource) { return null }
    const { footer, items: shown } = cappedBody(panel)
    return (
      <ListView
        actions={actions}
        deniedRefIds={deniedRefIds}
        footer={footer}
        footerNavigateTo={panel.footerNavigateTo}
        grid={grid}
        itemTemplate={itemTemplate}
        items={shown}
        resourcesRefs={resourcesRefs}
        rowKey={`${uid}-${panel.key}`}
        widget={widget}
      />
    )
  }

  const panels: CollapseProps['items'] = items.map((panel) => ({
    children: body(panel),
    collapsible: panel.collapsible,
    extra: panel.extra ? <Typography.Text className={styles.extra} type='secondary'>{panel.extra}</Typography.Text> : undefined,
    key: panel.key,
    label: (
      <span className={styles.header}>
        <span className={styles.title}>{panel.label}</span>
        {/* The space before the count makes the header's accessible name read "Open 47", not
            "Open47". It draws nothing: whitespace between the items of a flex container is not
            rendered, the gap is the stylesheet's. */}
        {typeof panel.count === 'number' && (
          <>
            {' '}
            <Tag className={styles.count} color={panel.status} variant='filled'>{panel.count}</Tag>
          </>
        )}
      </span>
    ),
  }))

  return (
    <AntdCollapse
      accordion={accordion}
      bordered={bordered}
      className={styles.collapse}
      defaultActiveKey={openByDefault(items, defaultActiveKey)}
      ghost={ghost}
      items={panels}
      key={uid}
      size={size}
    />
  )
}

export default Collapse
