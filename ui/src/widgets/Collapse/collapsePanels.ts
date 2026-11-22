/**
 * Which Collapse panels exist and which start open: pure, so the Collapse widget and the children
 * prefetch (components/RefChild/renderedChildren.ts) apply one rule. Moved out of Collapse.tsx, which
 * re-exports both.
 */
import type { Collapse as WidgetType } from './Collapse.type'

type Panel = WidgetType['spec']['widgetData']['items'][number]

/**
 * A panel's antd key: its own `key`, else its child's `resourceRefId`, else its position. `key` and
 * `label` are optional so the Page Builder, which adds a child to any container as
 * `{ resourceRefId }`, makes a valid panel rather than a CR the apiserver refuses.
 */
export const panelKey = (panel: Pick<Panel, 'key' | 'resourceRefId'>, index: number): string =>
  panel.key ?? panel.resourceRefId ?? String(index)

/**
 * The panels open on first render. The CR's `defaultActiveKey` when it gives one; otherwise every
 * panel carrying a `status` — the exception groups (what is broken, what needs a decision) start
 * open and the settled ones (Resolved, Closed, Ready) start folded, so a page opens on what needs
 * the reader and the rest is one click away.
 */
export const openByDefault = (items: Panel[], defaultActiveKey: string[] | undefined): string[] =>
  defaultActiveKey ?? items.flatMap((panel, index) => (panel.status ? [panelKey(panel, index)] : []))
