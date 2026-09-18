/**
 * One glyph per widget kind, for the palette and anywhere else that lists kinds.
 *
 * ANTD ICONS, NOT THE AUTOPILOT STROKE SET, and that is a deliberate reading of two existing
 * vocabularies rather than a third. `components/Autopilot/icons.tsx` says why it exists — "not antd
 * icons — these carry the exact petrol line weight/shape" — and it is Autopilot RAIL chrome. The
 * composer's own vocabulary is already antd: ObjectTreePanel draws every one of its actions with
 * them. The palette lives in the composer, so it speaks the composer's language.
 *
 * The widgets themselves mirror antd, so using antd's own glyph for the thing it mirrors is the
 * consistent choice: a Table widget gets antd's table icon because it renders antd's table.
 *
 * ONE MAP, ON PURPOSE. Iconography is the kind of decision that gets revised after someone sees it,
 * so every glyph is picked here and nowhere else — changing the whole set is editing this file.
 *
 * Keyed by CRD PLURAL, because that is the identifier that travels: `resourcesRefs[].resource`, the
 * `allowedResources` enum and `placeableWidgets` all speak plurals. Layout kinds are listed by
 * their plural too (LAYOUT_KINDS maps Card -> cards), so a Card container and a Card widget share a
 * glyph — which is right, since they are the same kind.
 */
import {
  AppstoreOutlined,
  BorderOutlined,
  ColumnHeightOutlined,
  ColumnWidthOutlined,
  FieldNumberOutlined,
  FileMarkdownOutlined,
  FontSizeOutlined,
  LayoutOutlined,
  LineChartOutlined,
  PicCenterOutlined,
  TableOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import type { ComponentType } from 'react'

/** CRD plural -> glyph. */
/**
 * Sorted, not grouped by layout/content — the lint enforces ascending keys, and a reader looking up
 * one plural is better served by a findable list than by a taxonomy.
 *
 * A container's glyph shows its AXIS where it has one (rows wide, cols tall), because that is the
 * only thing distinguishing a Row from a Col at a glance and the words do not help someone new.
 */
const BY_PLURAL: Readonly<Record<string, ComponentType>> = {
  cards: BorderOutlined,
  cols: ColumnHeightOutlined,
  flexes: LayoutOutlined,
  linecharts: LineChartOutlined,
  listies: UnorderedListOutlined,
  markdowns: FileMarkdownOutlined,
  paragraphs: FontSizeOutlined,
  rows: ColumnWidthOutlined,
  statistics: FieldNumberOutlined,
  tables: TableOutlined,
  tabs: PicCenterOutlined,
}

/**
 * The glyph for a plural, or a neutral one.
 *
 * A widget kind this build has never heard of is a REAL case, not a defensive branch: the widget
 * registry grows without the composer being rebuilt, so an unknown plural means "newer than me",
 * and drawing a generic block is better than drawing nothing and leaving a ragged row.
 */
export const iconForResource = (resource: string | null | undefined): ComponentType =>
  (resource ? BY_PLURAL[resource] ?? AppstoreOutlined : AppstoreOutlined)

/** Exported for the test that asserts every kind the composer can place has a glyph. */
export const KNOWN_ICON_PLURALS = Object.keys(BY_PLURAL)
