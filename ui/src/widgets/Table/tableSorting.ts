import type { Table as WidgetType } from './Table.type'

/**
 * tableSorting — inference-based client-side sorting (UX audit #13).
 *
 * Every Table column gets an antd `sorter` automatically, with ZERO
 * widget-schema/CRD changes: the column's type is SNIFFED from the raw
 * dataSource values at its valueKey (numbers / kubectl-style ages / ISO-8601
 * dates / plain strings) and the comparator compares those RAW values — never
 * the rendered nodes. Numeric and age columns also get `align: 'right'` per
 * tabular-data convention. There is NO default sortOrder: the server's order
 * (the chart's jq sort) is the semantic default and stays until the user
 * clicks a header (antd cycles asc → desc → off).
 */

type TableRows = NonNullable<WidgetType['spec']['widgetData']['dataSource']>
export type TableRow = TableRows[number]
export type TableCell = TableRow[number]

/** antd's SortOrder, declared structurally to avoid a deep antd import. */
type SortOrder = 'ascend' | 'descend' | null

export type ColumnSortType = 'age' | 'date' | 'number' | 'string'

export type ColumnSortProps = {
  align?: 'right'
  sorter: (rowA: TableRow, rowB: TableRow, sortOrder?: SortOrder) => number
}

/**
 * Rows examined when sniffing a column's type — bounds the per-render cost on
 * huge (virtualized) tables. The SORT itself still covers every row; values
 * outside the sample that don't parse simply sort last.
 */
export const SNIFF_SAMPLE_ROWS = 250

/**
 * kubectl-style relative age, the format this portal's jq `def rel` (and the
 * frontend's own formatRelativeTime) emits: "45s", "3m", "8h", "5d", "1w",
 * "2mo", "1y" — plus "now" for < 10s. `mo` is tried before bare `m`.
 */
const AGE_RE = /^(?:now|(\d+)(mo|[smhdwy]))$/

const AGE_UNIT_SECONDS: Record<string, number> = {
  d: 86400,
  h: 3600,
  m: 60,
  mo: 2592000,
  s: 1,
  w: 604800,
  y: 31536000,
}

/** Plain numeric string, e.g. "42", "-3.14". */
export const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/

/** ISO-8601 date or datetime, e.g. "2026-07-22" / "2026-07-22T10:15:00Z". */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * A placeholder a RESTAction writes in place of a value: "-", "—", "null" (a jq `tostring` of null),
 * "n/a". One such cell must not turn a numeric column into a string column, which re-sorted it
 * lexicographically and left-aligned it.
 */
const PLACEHOLDER_RE = /^(?:-|—|null|n\/a)$/i

const isMissing = (value: boolean | number | string | null | undefined): value is '' | null | undefined => (
  value === undefined || value === null || value === ''
)

/** Whether a value counts as no value: empty, or one of the placeholders above. */
export const isBlank = (value: boolean | number | string | null | undefined): boolean => (
  isMissing(value) || (typeof value === 'string' && PLACEHOLDER_RE.test(value.trim()))
)

/** Parse a kubectl-style age string to seconds; undefined when not an age. */
export const parseAgeSeconds = (value: string): number | undefined => {
  const match = AGE_RE.exec(value.trim())
  if (!match) { return undefined }
  if (match[1] === undefined) { return 0 }
  return Number(match[1]) * AGE_UNIT_SECONDS[match[2]]
}

/** A `conditions` cell sorts by its condition-type labels (e.g. "Ready, Synced"). */
const conditionTypesLabel = (stringValue?: string): string | undefined => {
  if (!stringValue) { return undefined }
  try {
    const conds = JSON.parse(stringValue) as { type?: string }[]
    if (!Array.isArray(conds) || !conds.length) { return undefined }
    return conds.map((cond) => cond.type ?? '').join(', ')
  } catch {
    return undefined
  }
}

/**
 * The RAW comparable value of a cell — always the dataSource value, never the
 * rendered node. A `tag` sorts by its label text (same sniffing as any other
 * value); `bar` by its percent; `conditions` by its condition types; a nested
 * `widget` cell has no comparable value.
 */
export const getCellSortValue = (cell: TableCell | undefined): boolean | number | string | undefined => {
  if (!cell) { return undefined }
  const { arrayValue, booleanValue, decimalValue, kind, numberValue, stringValue, type } = cell
  switch (kind) {
    case 'icon':
    case 'tag':
      return stringValue
    case 'bar': {
      if (!stringValue) { return undefined }
      const pct = Number(stringValue)
      return Number.isFinite(pct) ? pct : undefined
    }
    case 'conditions':
      return conditionTypesLabel(stringValue)
    case 'widget':
      return undefined
    case 'jsonSchemaType':
      switch (type) {
        case 'string':
          return stringValue
        case 'integer':
        case 'number':
          return numberValue
        case 'decimal': {
          if (decimalValue === undefined) { return undefined }
          const num = Number(decimalValue)
          return Number.isFinite(num) ? num : undefined
        }
        case 'boolean':
          return booleanValue
        case 'array':
          return arrayValue?.join(', ')
        default:
          return undefined
      }
    default:
      return stringValue ?? numberValue
  }
}

/**
 * Sniff a column's sort type from its raw values: all-numeric → 'number',
 * all kubectl-age strings → 'age', all ISO-8601 strings → 'date', anything
 * else (or mixed) → 'string'. Missing values (undefined/null/'') are ignored.
 */
export const sniffColumnType = (values: (boolean | number | string | undefined)[]): ColumnSortType => {
  let sawValue = false
  let canBeAge = true
  let canBeDate = true
  let canBeNumber = true
  for (const value of values) {
    if (isMissing(value) || isBlank(value)) { continue }
    sawValue = true
    if (typeof value === 'number') {
      canBeAge = false
      canBeDate = false
    } else if (typeof value === 'boolean') {
      canBeAge = false
      canBeDate = false
      canBeNumber = false
    } else {
      const trimmed = value.trim()
      if (!NUMERIC_RE.test(trimmed)) { canBeNumber = false }
      if (!AGE_RE.test(trimmed)) { canBeAge = false }
      if (!ISO_DATE_RE.test(trimmed) || !Number.isFinite(Date.parse(trimmed))) { canBeDate = false }
    }
    if (!canBeAge && !canBeDate && !canBeNumber) { return 'string' }
  }
  if (!sawValue) { return 'string' }
  if (canBeNumber) { return 'number' }
  if (canBeAge) { return 'age' }
  return 'date'
}

/** Normalize a raw value into its comparable form for the sniffed type. */
const toComparable = (value: boolean | number | string | undefined, sortType: ColumnSortType): number | string | undefined => {
  if (isMissing(value) || isBlank(value)) { return undefined }
  switch (sortType) {
    case 'number': {
      const num = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(num) ? num : undefined
    }
    case 'age':
      return typeof value === 'string' ? parseAgeSeconds(value) : undefined
    case 'date': {
      if (typeof value !== 'string') { return undefined }
      const time = Date.parse(value)
      return Number.isFinite(time) ? time : undefined
    }
    default:
      return String(value)
  }
}

const cellValueForKey = (row: TableRow, valueKey: string): boolean | number | string | undefined => (
  getCellSortValue(row.find((cell) => cell.valueKey === valueKey))
)

/**
 * Build the antd sort props for one column: an automatic `sorter` over the RAW
 * dataSource values, plus `align: 'right'` for numeric/age columns. Missing
 * values sort LAST in BOTH directions: antd negates the comparator's result on
 * 'descend' (and passes the active order as the third argument), so the
 * comparator pre-negates for missing cells to pin them at the bottom.
 */
export const getColumnSortProps = (rows: TableRows | undefined, valueKey: string): ColumnSortProps => {
  const sample = (rows ?? []).slice(0, SNIFF_SAMPLE_ROWS)
  const sortType = sniffColumnType(sample.map((row) => cellValueForKey(row, valueKey)))
  const missingLast = (sortOrder?: SortOrder): number => (sortOrder === 'descend' ? -1 : 1)
  const sorter = (rowA: TableRow, rowB: TableRow, sortOrder?: SortOrder): number => {
    const left = toComparable(cellValueForKey(rowA, valueKey), sortType)
    const right = toComparable(cellValueForKey(rowB, valueKey), sortType)
    if (left === undefined && right === undefined) { return 0 }
    if (left === undefined) { return missingLast(sortOrder) }
    if (right === undefined) { return -missingLast(sortOrder) }
    if (typeof left === 'number' && typeof right === 'number') { return left - right }
    return String(left).localeCompare(String(right))
  }
  if (sortType === 'age' || sortType === 'number') {
    return { align: 'right', sorter }
  }
  return { sorter }
}
