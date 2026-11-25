/**
 * WHICH CHILDREN A CONTAINER DRAWS THE MOMENT ITS ANSWER ARRIVES, by kind (prefetch children on
 * answer, approved by Diego 2026-11-22; hooks/prefetchChildren.ts reads this).
 *
 * Only the nine containers that render children through RefChild or a slot are listed, and each
 * lists only what it draws on first render, by the same rule the widget applies:
 *   Card     cover, extraRefId, items (afterCard moves some of them below the card), footer items
 *   Col, Flex, Row   items
 *   Collapse the panels open on first render (collapsePanels.openByDefault)
 *   Layout   header, content, footer, the sider's body and its expanded header (collapsedHeader
 *            replaces it only once collapsed, which is not known before render)
 *   Table    the `widget` cells of the rows on its first page; NOTHING in virtual mode, which draws
 *            only the rows in view
 *   Tabs     the active pane: the item `?tab=` names (by label, case-insensitive), else the first
 *   Timeline every item's child: a timeline draws all its items at once
 * Any other kind prefetches nothing: a Menu's items name PAGES, which are routes, not children.
 * A kind's test asserts that what its widget mounts equals what it declares here, so the two cannot
 * drift apart.
 *
 * Pure, and imports no widget component: the hook layer reads it, and widgets import the hooks.
 */
import { openByDefault, panelKey } from '../../widgets/Collapse/collapsePanels'
import { shouldVirtualize } from '../../widgets/Table/tablePagination'

type Data = Record<string, unknown>

const asRecord = (value: unknown): Data | undefined =>
  (value && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : undefined)

/** The `resourceRefId` of each `{ resourceRefId }` in a list. */
const refIdOf = (item: unknown): string[] => {
  const id = asRecord(item)?.resourceRefId
  return typeof id === 'string' && id ? [id] : []
}
const refIds = (list: unknown): string[] => (Array.isArray(list) ? list.flatMap(refIdOf) : [])

/** A slot that holds a resourceRefId string. */
const refId = (value: unknown): string[] => (typeof value === 'string' && value ? [value] : [])

const items = (data: Data): string[] => refIds(data.items)

const collapse = (data: Data): string[] => {
  const panels = (Array.isArray(data.items) ? data.items : []) as Parameters<typeof openByDefault>[0]
  const defaultActiveKey = Array.isArray(data.defaultActiveKey) ? (data.defaultActiveKey as string[]) : undefined
  const open = new Set(openByDefault(panels, defaultActiveKey))
  return panels.flatMap((panel, index) => (open.has(panelKey(panel, index)) ? refId(panel.resourceRefId) : []))
}

const layout = (data: Data): string[] => {
  const sider = asRecord(data.sider)
  return [...refId(data.header), ...refId(data.content), ...refId(data.footer), ...refId(sider?.resourceRefId), ...refId(sider?.header)]
}

const table = (data: Data): string[] => {
  // `dataSource`, or the legacy `data` it was renamed from (Table.type: still accepted).
  const legacy = Array.isArray(data.data) ? data.data : []
  const rows = Array.isArray(data.dataSource) ? data.dataSource : legacy
  if (shouldVirtualize(rows.length)) { return [] }
  const pagination = asRecord(data.pagination)
  const pageSize = typeof pagination?.pageSize === 'number' ? pagination.pageSize : undefined
  const current = typeof pagination?.current === 'number' ? pagination.current : 1
  const visible = pageSize ? rows.slice((current - 1) * pageSize, current * pageSize) : rows
  // Only a `widget` cell mounts its child (Table.tsx: `case 'widget'` -> RefChild).
  const widgetCell = (cell: unknown): string[] => (asRecord(cell)?.kind === 'widget' ? refId(asRecord(cell)?.resourceRefId) : [])
  return visible.flatMap((row) => (Array.isArray(row) ? row.flatMap(widgetCell) : []))
}

const tabs = (data: Data, search: URLSearchParams): string[] => {
  const list = Array.isArray(data.items) ? data.items : []
  const requested = search.get('tab')?.trim().toLowerCase()
  const labelOf = (item: unknown): string => {
    const label = asRecord(item)?.label
    return typeof label === 'string' ? label.trim().toLowerCase() : ''
  }
  const index = requested ? list.findIndex((item) => labelOf(item) === requested) : -1
  return refId(asRecord(list[index >= 0 ? index : 0])?.resourceRefId)
}

const card = (data: Data): string[] => [...refId(data.cover), ...refId(data.extraRefId), ...items(data), ...refIds(data.footer)]

const BY_KIND: Readonly<Record<string, (data: Data, search: URLSearchParams) => string[]>> = {
  Card: card,
  Col: items,
  Collapse: collapse,
  Flex: items,
  Layout: layout,
  Row: items,
  Table: table,
  Tabs: tabs,
  Timeline: items,
}

/** The resourceRefIds a widget of `kind` draws on first render, given its widgetData; [] for any other kind. */
export const renderedChildRefIds = (kind: string, widgetData: unknown, search: URLSearchParams): string[] => {
  const data = asRecord(widgetData)
  const rule = BY_KIND[kind]
  return data && rule ? [...new Set(rule(data, search))] : []
}
