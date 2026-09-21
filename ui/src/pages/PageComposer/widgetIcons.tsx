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
  AppstoreAddOutlined,
  BarChartOutlined,
  BgColorsOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  DownOutlined,
  EditOutlined,
  FilterOutlined,
  FormOutlined,
  LoadingOutlined,
  MenuOutlined,
  MinusOutlined,
  OrderedListOutlined,
  PartitionOutlined,
  PictureOutlined,
  PieChartOutlined,
  ProfileOutlined,
  QrcodeOutlined,
  RightOutlined,
  SlidersOutlined,
  SwapOutlined,
  TagOutlined,
  UploadOutlined,
  WarningOutlined,
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
  alerts: WarningOutlined,
  badges: TagOutlined,
  barcharts: BarChartOutlined,
  breadcrumbs: RightOutlined,
  buttongroups: AppstoreAddOutlined,
  buttons: BorderOutlined,
  cards: BorderOutlined,
  checkboxes: CheckSquareOutlined,
  cols: ColumnHeightOutlined,
  datepickers: CalendarOutlined,
  descriptions: ProfileOutlined,
  dividers: MinusOutlined,
  filters: FilterOutlined,
  flexes: LayoutOutlined,
  flowcharts: PartitionOutlined,
  forms: FormOutlined,
  images: PictureOutlined,
  inputnumbers: FieldNumberOutlined,
  inputs: EditOutlined,
  layouts: LayoutOutlined,
  linecharts: LineChartOutlined,
  listies: UnorderedListOutlined,
  markdowns: FileMarkdownOutlined,
  menus: MenuOutlined,
  pageheaders: FontSizeOutlined,
  paragraphs: FontSizeOutlined,
  piecharts: PieChartOutlined,
  progresses: LoadingOutlined,
  qrcodes: QrcodeOutlined,
  radios: CheckCircleOutlined,
  rangepickers: CalendarOutlined,
  results: CheckCircleOutlined,
  rows: ColumnWidthOutlined,
  selects: DownOutlined,
  sliders: SlidersOutlined,
  statistics: FieldNumberOutlined,
  steps: OrderedListOutlined,
  switches: SwapOutlined,
  tables: TableOutlined,
  tabs: PicCenterOutlined,
  tags: TagOutlined,
  themes: BgColorsOutlined,
  uploads: UploadOutlined,
  yamlviewers: CodeOutlined,
}

/**
 * The glyph for a plural, or a neutral one.
 *
 * A widget kind this build has never heard of is a REAL case, not a defensive branch: the widget
 * registry grows without the composer being rebuilt, so an unknown plural means "newer than me",
 * and drawing a generic block is better than drawing nothing and leaving a ragged row.
 *
 * THE FALLBACK MUST STAY AN EXCEPTION, which it had stopped being. The map covered eleven plurals;
 * the palette now offers forty-four kinds, so thirty-three rows drew the SAME generic block. A
 * glyph column identical on three quarters of its rows is worse than no glyph column at all,
 * because it implies a distinction it is not making — the eye reads "these are alike" and they are
 * not. Repeats between related kinds are deliberate and honest (a RangePicker is a DatePicker over
 * two dates); an accidental repeat across unrelated ones is the thing being avoided.
 */
export const iconForResource = (resource: string | null | undefined): ComponentType =>
  (resource ? BY_PLURAL[resource] ?? AppstoreOutlined : AppstoreOutlined)

/** Exported for the test that asserts every kind the composer can place has a glyph. */
export const KNOWN_ICON_PLURALS = Object.keys(BY_PLURAL)
