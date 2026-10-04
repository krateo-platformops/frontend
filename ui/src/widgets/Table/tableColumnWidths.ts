import type { Table as WidgetType } from './Table.type'
import { isBlank, NUMERIC_RE } from './tableSorting'

type WidgetData = WidgetType['spec']['widgetData']
type Column = WidgetData['columns'][number]
type Row = NonNullable<WidgetData['dataSource']>[number]
type Cell = Row[number]

/**
 * Advance width of one tag glyph, in em of the tag's font size. Tags render in JetBrains Mono
 * (index.css), and every monospace fallback in that stack is 0.6em too.
 */
export const TAG_GLYPH_EM = 0.6

/**
 * Advance width of one digit in a table cell, in em of the cell's font size. Cells render tabular
 * figures (index.css); Inter's are about 0.62em, so 0.65 errs wide: a number column a few px roomy
 * is fine, a number cut is not.
 */
export const NUM_GLYPH_EM = 0.65

/** Average advance of a text glyph in a cell, in em. Only weighs how the text columns share space. */
export const TEXT_GLYPH_EM = 0.55

/**
 * Advance width of one header glyph, in em of the header's font size: the header is JetBrains Mono
 * (0.6em) with the design's 0.08em letter-spacing (Table.module.css `.headerWrap`).
 */
export const HEADER_GLYPH_EM = 0.68

/** The antd Table and Tag tokens column widths are built from. */
export type ColumnTokens = {
  /** antd Table cell inline padding, both sides, for the table's size (border included). */
  cellPadding: number
  /** antd Table cell font size (`fontSize`). */
  cellFontSize: number
  /** antd Tag font size (`fontSizeSM`). */
  fontSize: number
  /** Header font size, px (`--krateo-text-label-sm`). */
  headerFontSize: number
  /** antd sorter icon plus its inline-start margin, px. */
  sorterWidth: number
  /** antd Tag inline padding plus its border, both sides. */
  tagChrome: number
}

/** A column's declared width in px; a CSS-length string cannot be summed, so it reads as undeclared. */
const pxWidth = (column: Column): number | undefined => (typeof column.width === 'number' ? column.width : undefined)

const cellOf = (row: Row, valueKey: string): Cell | undefined => row.find((candidate) => candidate.valueKey === valueKey)

/** The text a jsonSchemaType cell renders, the same way Table renders it. */
const cellText = (cell: Cell | undefined): string | undefined => {
  if (cell?.kind !== 'jsonSchemaType') { return cell?.stringValue }
  switch (cell.type) {
    case 'integer':
    case 'number':
      return cell.numberValue === undefined ? undefined : String(cell.numberValue)
    case 'decimal':
      return cell.decimalValue === undefined ? undefined : String(cell.decimalValue)
    case 'string':
      return cell.stringValue
    default:
      return undefined
  }
}

/**
 * Whether a column is numeric, decided by its cells' kind: every cell is a jsonSchemaType integer,
 * number or decimal, or a string holding a plain number. Empty and placeholder cells ("-", "null")
 * do not count either way, and a column needs at least one number. Numeric columns right-align and
 * size to their content.
 */
export const isNumericColumn = (rows: Row[], valueKey: string): boolean => {
  let sawNumber = false
  for (const row of rows) {
    const cell = cellOf(row, valueKey)
    if (!cell) { continue }
    if (cell.kind !== 'jsonSchemaType') { return false }
    if (cell.type === 'integer' || cell.type === 'number' || cell.type === 'decimal') {
      sawNumber = sawNumber || cellText(cell) !== undefined
      continue
    }
    if (cell.type !== 'string') { return false }
    if (isBlank(cell.stringValue)) { continue }
    if (!NUMERIC_RE.test((cell.stringValue ?? '').trim())) { return false }
    sawNumber = true
  }
  return sawNumber
}

/**
 * The characters on the longest line of a title wrapped at word boundaries onto at most two lines,
 * as narrow as that allows: "CPU request (m)" → 11 ("CPU request" / "(m)").
 */
export const headerLineChars = (title: string): number => {
  const words = title.trim().split(/\s+/).filter(Boolean)
  if (!words.length) { return 0 }
  const lines = (width: number): number => {
    let count = 1
    let line = 0
    for (const word of words) {
      if (line && line + 1 + word.length > width) {
        count += 1
        line = word.length
      } else {
        line = line ? line + 1 + word.length : word.length
      }
    }
    return count
  }
  let width = Math.max(...words.map((word) => word.length))
  while (lines(width) > 2) { width += 1 }
  return width
}

/** The width (px) a column needs for its header to read in full on at most two lines, sorter included. */
export const headerWidth = (column: Column, tokens: ColumnTokens): number => (
  Math.ceil(headerLineChars(column.title) * tokens.headerFontSize * HEADER_GLYPH_EM + tokens.sorterWidth + tokens.cellPadding)
)

/** Longest rendered value of a column, in characters, over the cells `accept` keeps. */
const longestValue = (rows: Row[], valueKey: string, accept: (cell: Cell) => boolean): number => rows.reduce((longest, row) => {
  const cell = cellOf(row, valueKey)
  if (!cell || !accept(cell)) { return longest }
  return Math.max(longest, (cell.kind === 'tag' ? cell.stringValue ?? '-' : cellText(cell) ?? '-').length)
}, 0)

/**
 * The width (px) a tag column needs so its widest tag shows in full, or undefined when the column
 * renders no tags. Never below the author's own width/minWidth. A tag column whose author set a
 * CSS-length `width` keeps that width verbatim: the author has sized it.
 */
export const tagColumnWidth = (column: Column, rows: Row[], tokens: ColumnTokens): number | undefined => {
  const chars = longestValue(rows, column.valueKey, (cell) => cell.kind === 'tag')
  if (!chars || typeof column.width === 'string') { return undefined }
  const fit = Math.ceil(chars * tokens.fontSize * TAG_GLYPH_EM + tokens.tagChrome + tokens.cellPadding)
  return Math.max(fit, headerWidth(column, tokens), pxWidth(column) ?? 0, column.minWidth ?? 0)
}

/**
 * The width (px) a numeric column needs: its widest value or its two-line header, whichever is wider.
 * Undefined for a non-numeric column, or one whose author set a CSS-length `width`.
 */
export const numericColumnWidth = (column: Column, rows: Row[], tokens: ColumnTokens): number | undefined => {
  if (typeof column.width === 'string' || !isNumericColumn(rows, column.valueKey)) { return undefined }
  const chars = longestValue(rows, column.valueKey, () => true)
  const fit = Math.ceil(chars * tokens.cellFontSize * NUM_GLYPH_EM + tokens.cellPadding)
  return Math.max(fit, headerWidth(column, tokens), pxWidth(column) ?? 0, column.minWidth ?? 0)
}

export type ColumnLayout = {
  /** Whether each column is numeric (right-aligned). */
  numeric: boolean[]
  /** Fixed width per column index, undefined where antd sizes it. */
  widths: (number | undefined)[]
  /** The table's horizontal scroll floor (fitContent only), undefined when nothing is sized. */
  scrollX?: number
}

/**
 * Column widths for a table whose cells truncate (fitContent or virtual). Mirrors antd: fixed column
 * widths, and a numeric scroll.x for a fitContent table so it fills its container when there is room
 * and scrolls horizontally when there is not.
 *
 * - A tag column fits its widest tag and a numeric column its widest value, each at least wide
 *   enough for its header on two lines.
 * - The text columns share what is left (`containerWidth`, once measured): each gets its header's
 *   two-line width, and the rest is split in proportion to how much more its content asks for.
 * - A virtual table cannot scroll sideways in view (its scrollbar is hidden at rest, at the foot of
 *   the viewport), so when the text columns' headers do not fit it squeezes them proportionally and
 *   their headers ellipsize, full title on hover. A fitContent table keeps them and scrolls.
 *
 * Before the container is measured the text columns are left to antd (an equal share). A table with
 * no tag or numeric column is left exactly as it was.
 */
export const columnLayout = (
  columns: Column[],
  rows: Row[],
  tokens: ColumnTokens,
  { containerWidth = 0, virtual = false }: { containerWidth?: number; virtual?: boolean } = {},
): ColumnLayout => {
  const numeric = columns.map((column) => isNumericColumn(rows, column.valueKey))
  const sized = columns.map((column, index) => tagColumnWidth(column, rows, tokens) ?? (numeric[index] ? numericColumnWidth(column, rows, tokens) : undefined))
  if (sized.every((width) => width === undefined)) { return { numeric, widths: sized } }

  // The author's px width counts as fixed; every other unsized column is a text column.
  const fixed = sized.map((width, index) => width ?? pxWidth(columns[index]))
  const text = columns.map((_, index) => index).filter((index) => fixed[index] === undefined && typeof columns[index].width !== 'string')
  const floors = new Map(text.map((index) => [index, Math.max(headerWidth(columns[index], tokens), columns[index].minWidth ?? 0)]))
  const floorSum = [...floors.values()].reduce((sum, floor) => sum + floor, 0)
  const fixedSum = fixed.reduce<number>((sum, width) => sum + (width ?? 0), 0)
  const scrollX = virtual ? undefined : fixedSum + floorSum

  const room = containerWidth - fixedSum
  if (containerWidth <= 0 || !text.length || (room < floorSum && !virtual)) { return { numeric, scrollX, widths: sized } }

  const widths = [...sized]
  if (room < floorSum) {
    // Squeezed: every text column keeps the same share of its floor. Never below a column's padding.
    text.forEach((index) => { widths[index] = Math.max(tokens.cellPadding, Math.floor((floors.get(index) ?? 0) * room / floorSum)) })
    return { numeric, scrollX, widths }
  }
  const wants = new Map(text.map((index) => {
    const content = Math.ceil(longestValue(rows, columns[index].valueKey, () => true) * tokens.cellFontSize * TEXT_GLYPH_EM + tokens.cellPadding)
    return [index, Math.max(content - (floors.get(index) ?? 0), 0)]
  }))
  const wantSum = [...wants.values()].reduce((sum, want) => sum + want, 0)
  const extra = room - floorSum
  let left = room
  text.forEach((index, position) => {
    const share = wantSum ? (wants.get(index) ?? 0) / wantSum : 1 / text.length
    const width = position === text.length - 1 ? left : Math.floor((floors.get(index) ?? 0) + extra * share)
    widths[index] = width
    left -= width
  })
  return { numeric, scrollX, widths }
}
