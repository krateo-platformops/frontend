import { formatISODate, formatRelativeTime } from '../../utils/utils'

/**
 * Generic item → row mapping for the List/Feed widget. This is the seam that
 * lets a *list of anything* render as rows, instead of a domain-locked widget:
 * each row slot is a template string with `{dot.path}` placeholders resolved
 * against the item. `{a|b|c}` picks the first non-empty path (fallbacks).
 */

export type RowSlot = 'primaryText' | 'secondaryText' | 'subPrimaryText' | 'subSecondaryText'

/**
 * A per-row action menu entry (kebab `⋯`). `actionId` references an action defined in
 * the List's `widgetData.actions` (the canonical action map); firing it passes the row's
 * data as the action payload, so one shared action definition serves every row.
 */
export interface RowAction {
  actionId: string
  label: string
  /** Optional Font Awesome icon name for the menu item. */
  icon?: string
  /** Render the menu item in a destructive (red) style. */
  danger?: boolean
}

export interface ColorSpec {
  /** Literal palette color, or a `{path}` resolved against the item. */
  value?: string
  /** Map a resolved value to a palette color (e.g. { Normal: 'blue', Warning: 'orange' }). */
  map?: Record<string, string>
  default?: string
}

/**
 * A per-row horizontal bar — the reconciliation-rail row. An antd Progress line whose
 * percent + stroke colour are resolved per item (colour routes through getColorCode),
 * optionally in the Petrol `rail` variant (CSS hatch + amber target-tick).
 */
export interface BarSpec {
  /** `{path}` to a 0–100 number (e.g. `{healthPercent}`). */
  percent?: string
  /** Stroke colour — palette name, `{path}`, or `map` (e.g. state → cyan/magenta/amber). */
  color?: ColorSpec
  /** Optional trailing `{path}` label (e.g. the % text or `7/7`). */
  label?: string
  /** `line` (plain) or `rail` (hatched diff + amber target-tick variant). */
  variant?: 'line' | 'rail'
}

/**
 * An at-a-glance status indicator — a single Font Awesome glyph (with an optional tooltip)
 * rendered top-right of the `card` rowVariant. Each field is a `{path}` resolved per item;
 * the raw-value → glyph/colour mapping is computed server-side (jq in the RESTAction), so the
 * widget stays strongly typed and nothing is hardcoded here. Used e.g. to surface a
 * CompositionDefinition's `Ready` condition on a blueprint card.
 */
export interface StatusSpec {
  /** `{path}` to the resolved Font Awesome icon name (e.g. `{readyIcon}`). */
  icon?: string
  /** `{path}` to the resolved palette colour (e.g. `{readyColor}`). */
  color?: string
  /** `{path}` tooltip text shown on hover (e.g. `{readyReason}`). */
  tooltip?: string
}

export interface ItemTemplate {
  primaryText?: string
  secondaryText?: string
  subPrimaryText?: string
  subSecondaryText?: string
  /** Longer body line (2-line clamp) — only rendered by the `card` rowVariant (e.g. a catalog tile description). */
  description?: string
  /** Card-footer call-to-action cue (e.g. "Configure") shown at the footer-left when the `card` is clickable (`navigateTo`) — rendered as mono amber text + a sliding arrow (a navigation hint, NOT a button). */
  cardCta?: string
  /** Icon name (font awesome), or a `{path}`. */
  icon?: string
  /**
   * How the leading indicator is presented:
   * - `avatar` (default): solid colored disc + white glyph;
   * - `tile`: soft-tint rounded square + colored glyph (catalog/list rows);
   * - `dot`: small solid status dot with a soft halo, no glyph (event/status feeds).
   */
  iconVariant?: 'avatar' | 'tile' | 'dot'
  color?: ColorSpec
  /** Per-slot value formatting; `datetime` → absolute date+time, `relative` → "3h ago". */
  formats?: Partial<Record<RowSlot, 'text' | 'datetime' | 'relative'>>
  /** Render `secondaryText` as a soft-tint Tag pill (e.g. a category) rather than plain text. */
  secondaryTextAsTag?: boolean
  /** Render `subPrimaryText` as a small mono bordered pill (e.g. an event's involvedObject `Kind/name` ref). */
  subPrimaryTextMono?: boolean
  /**
   * Per-item navigation target — a `{path}` template resolved against the item
   * (e.g. `{link}` or `/compositions/{metadata.namespace}/{metadata.name}`). When it
   * resolves non-empty the row becomes clickable and navigates there (SPA route).
   * The per-row action slice of the action envelope — drives clickable catalogs
   * (Marketplace tiles → create route) and search results.
   */
  navigateTo?: string
  /**
   * Per-row action menu (kebab `⋯`): side-effectful actions for the row, each referencing
   * an action id in the List's `widgetData.actions`, fired with the row as payload. Static
   * descriptors (same menu on every row); the row's data flows in at click time. Distinct
   * from `navigateTo`, which is the whole-row click.
   */
  rowActions?: RowAction[]
  /**
   * How the default row presents `rowActions`: `menu` (the kebab, default) or `buttons` —
   * antd Buttons at the row's end, first primary, for lists whose rows each carry a verb the
   * person came to do (e.g. Resume / Discard on a draft). The whole-row click is unchanged.
   */
  rowActionsDisplay?: 'menu' | 'buttons'
  /** Per-row horizontal Progress bar — the reconciliation-rail row. */
  bar?: BarSpec
  /** At-a-glance status glyph (top-right of the `card` rowVariant) — e.g. a blueprint's Ready condition. */
  status?: StatusSpec
  /**
   * Row layout: `default` (antd List.Item.Meta — avatar + stacked title/description),
   * `tree` (a tight single-line mono row: `└─` connector + status dot + primaryText
   * + muted inline subPrimaryText + right-aligned colored secondaryText — the detail
   * Relations "composed children" tree), or `card` (a full antd Card tile — icon-tile +
   * name + version badge (subPrimaryText) + category tag (secondaryText) + description +
   * a footer of `rowActions` rendered as visible buttons — the Marketplace catalog grid),
   * or `chip` (a compact navigable filter pill — `primaryText` label + optional `count`,
   * solid/amber when the item's `active` is true; the data-driven Marketplace facet chips).
   */
  rowVariant?: 'default' | 'tree' | 'card' | 'chip'
}

export interface ResolvedBar {
  percent: number
  color: string
  label: string
  variant: 'line' | 'rail'
}

export interface ResolvedStatus {
  /** Resolved Font Awesome icon name (empty string → no glyph rendered). */
  icon: string
  /** Resolved palette colour. */
  color: string
  /** Resolved tooltip text (empty string → no tooltip). */
  tooltip: string
}

export interface ResolvedRow {
  primaryText: string
  secondaryText: string
  subPrimaryText: string
  subSecondaryText: string
  description: string
  cardCta: string
  icon: string
  color: string
  /** Resolved navigation target (empty string when the row is not clickable). */
  navigateTo: string
  /** Resolved per-row bar (absent when the template has no `bar`). */
  bar?: ResolvedBar
  /** Resolved status glyph (absent when the template has no `status`). */
  status?: ResolvedStatus
}

export const resolvePath = (item: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), item)

/** Replace `{path}` / `{a|b|c}` placeholders with the first non-empty resolved value. Literal text is kept. */
export const interpolate = (template: string | undefined, item: unknown): string => {
  if (!template) { return '' }
  return template.replace(/\{([^}]+)\}/g, (_match, expression: string) => {
    for (const path of expression.split('|')) {
      const value = resolvePath(item, path.trim())
      if (value !== undefined && value !== null && value !== '') {
        return typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean)
      }
    }
    return ''
  })
}

export const resolveColor = (spec: ColorSpec | undefined, item: unknown): string => {
  if (!spec) { return 'gray' }
  const resolved = interpolate(spec.value, item)
  if (spec.map) { return spec.map[resolved] ?? spec.default ?? 'gray' }
  return resolved || spec.default || 'gray'
}

export const resolveStatus = (spec: StatusSpec, item: unknown): ResolvedStatus => ({
  color: interpolate(spec.color, item) || 'gray',
  icon: interpolate(spec.icon, item),
  tooltip: interpolate(spec.tooltip, item),
})

const resolveSlot = (template: ItemTemplate, slot: RowSlot, item: unknown): string => {
  const text = interpolate(template[slot], item)
  if (!text) { return text }
  const format = template.formats?.[slot]
  if (format === 'datetime') { return formatISODate(text, true) }
  if (format === 'relative') { return formatRelativeTime(text) }
  return text
}

export const resolveRow = (template: ItemTemplate, item: unknown): ResolvedRow => ({
  bar: template.bar
    ? {
      color: resolveColor(template.bar.color, item),
      label: interpolate(template.bar.label, item),
      percent: Math.max(0, Math.min(100, Number(interpolate(template.bar.percent, item)) || 0)),
      variant: template.bar.variant ?? 'line',
    }
    : undefined,
  cardCta: interpolate(template.cardCta, item),
  color: resolveColor(template.color, item),
  description: interpolate(template.description, item),
  icon: interpolate(template.icon, item),
  navigateTo: interpolate(template.navigateTo, item),
  primaryText: resolveSlot(template, 'primaryText', item),
  secondaryText: resolveSlot(template, 'secondaryText', item),
  status: template.status ? resolveStatus(template.status, item) : undefined,
  subPrimaryText: resolveSlot(template, 'subPrimaryText', item),
  subSecondaryText: resolveSlot(template, 'subSecondaryText', item),
})
