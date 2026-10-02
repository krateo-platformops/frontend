import type { Table as WidgetType } from './Table.type'

type WidgetData = WidgetType['spec']['widgetData']
type Column = WidgetData['columns'][number]
type Row = NonNullable<WidgetData['dataSource']>[number]

/**
 * Advance width of one tag glyph, in em of the tag's font size. JetBrains Mono is exactly 0.6em and
 * Inter's mixed-case average sits below it, so 0.65 errs wide: a tag column a few px roomy is fine,
 * a tag cut mid-word is the defect this exists to stop.
 */
export const TAG_GLYPH_EM = 0.65

/**
 * The floor a column without a declared width/minWidth gets when the table has to scroll so a tag
 * column can keep its width. Without one, fixed layout would hand those columns whatever is left —
 * nothing, on a narrow container — and they would collapse instead of ellipsizing.
 */
export const DEFAULT_COLUMN_FLOOR = 96

/** The antd tokens the width of a tag cell is built from (antd Tag + Table cell chrome). */
export type TagCellTokens = {
  /** antd Tag font size (`fontSizeSM`). */
  fontSize: number
  /** antd Tag inline padding plus its border, both sides. */
  tagChrome: number
  /** antd Table cell inline padding, both sides, for the table's size. */
  cellPadding: number
}

/** A column's declared width in px; a CSS-length string cannot be summed, so it reads as undeclared. */
const pxWidth = (column: Column): number | undefined => (typeof column.width === 'number' ? column.width : undefined)

/** Longest tag label a column renders, in characters; 0 when the column holds no tag cell. */
const longestTagLabel = (rows: Row[], valueKey: string): number => rows.reduce((longest, row) => {
  const cell = row.find((candidate) => candidate.valueKey === valueKey)
  if (cell?.kind !== 'tag') { return longest }
  return Math.max(longest, (cell.stringValue ?? '-').length)
}, 0)

/**
 * The width (px) a tag column needs so its widest tag shows in full, or undefined when the column
 * renders no tags. Never below the author's own width/minWidth. A tag column whose author set a
 * CSS-length `width` keeps that width verbatim: the author has sized it.
 */
export const tagColumnWidth = (column: Column, rows: Row[], tokens: TagCellTokens): number | undefined => {
  const chars = longestTagLabel(rows, column.valueKey)
  if (!chars || typeof column.width === 'string') { return undefined }
  const fit = Math.ceil(chars * tokens.fontSize * TAG_GLYPH_EM + tokens.tagChrome + tokens.cellPadding)
  return Math.max(fit, pxWidth(column) ?? 0, column.minWidth ?? 0)
}

/**
 * Column widths and the table's horizontal scroll floor for a table whose cells truncate (fitContent
 * or virtual). Mirrors antd: a column with a fixed `width` plus a numeric `scroll.x`, so the table
 * fills its container when there is room and scrolls horizontally when there is not.
 *
 * Returns `tagWidths` (per column index, undefined for a non-tag column) and `scrollX`, the sum of
 * every column's floor, or undefined when no column renders tags (the table is left exactly as it was).
 */
export const tagColumnLayout = (columns: Column[], rows: Row[], tokens: TagCellTokens): { scrollX?: number; tagWidths: (number | undefined)[] } => {
  const tagWidths = columns.map((column) => tagColumnWidth(column, rows, tokens))
  if (tagWidths.every((width) => width === undefined)) { return { tagWidths } }
  const scrollX = columns.reduce((sum, column, index) => sum + (tagWidths[index] ?? pxWidth(column) ?? column.minWidth ?? DEFAULT_COLUMN_FLOOR), 0)
  return { scrollX, tagWidths }
}
