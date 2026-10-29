/**
 * The export request a Table makes, and the contract it has to satisfy (snowplow#980, 1.12.62).
 *
 * The export targets the WIDGET endpoint, not a route of its own: snowplow re-dispatches the
 * widget's own read with its own `page=N&perPage=500` walk and concatenates the pages, so the
 * export sees every row rather than the slice on screen. The frontend's job is to say WHICH cells
 * to take and WHAT to call them, and both come from the Table's `columns` — the widget is the only
 * thing that knows them.
 *
 * WHAT SNOWPLOW REFUSES, so this never sends it:
 *   - `header` without `fields` — a 400;
 *   - a `header`/`fields` count MISMATCH — a 400.
 * Everything else is permitted on purpose: a duplicate title and a repeated `valueKey` are both
 * fine (two columns over one cell are genuinely two columns — a raw and a formatted view), and a
 * `valueKey` no row carries is NOT an error. It exports as an empty cell in csv and pdf, and as the
 * key present with `null` in labelled json, where rows keep EVERY field in `fields` order. So a
 * labelled-json consumer must not read `null` as absent.
 *
 * TRUNCATION DIFFERS BY FORMAT and the caller has to handle both:
 *   - csv/json: 50,000 rows, with `X-Export-Truncated: true` and the FIRST 50,000 returned;
 *   - pdf: never truncated — hitting the bound answers 422 with a JSON body and no file.
 */
import type { Table as WidgetType } from './Table.type'

type Columns = NonNullable<WidgetType['spec']['widgetData']['columns']>

export type ExportFormat = 'csv' | 'json' | 'pdf'

/**
 * The jq that lifts a column's cell out of a row. Rows are arrays of cells, each carrying its own
 * `valueKey`, so a field is selected by matching that key rather than by position — a column's
 * place in `columns` is not its place in a row.
 */
export const EXPORT_PATH = '.[] | map({ (.valueKey): (.stringValue // .numberValue // .decimalValue // .booleanValue // .arrayValue) }) | add'

/** Every column that can name a cell. A column with no `valueKey` cannot be exported. */
const exportable = (columns: Columns) => columns.filter((column) => typeof column.valueKey === 'string' && column.valueKey.length > 0)

export interface ExportRequest {
  /** Query string to append to the widget endpoint, without a leading `?`. */
  params: string
  /** The columns the export will carry, in order — what a caller shows in a confirmation. */
  fields: string[]
}

/**
 * The export query for a Table's columns, or null when there is nothing exportable.
 *
 * `header` is sent as one REPEATED param per column, in the same order as `fields`, because a title
 * is display text and a `valueKey` is identity: conflating them into one parameter was what made
 * duplicate titles look like a conflict. A column whose title is empty still sends a header, so the
 * counts stay equal — the alternative is dropping labels entirely for the whole request.
 */
export const buildExportRequest = (columns: Columns | undefined, format: ExportFormat, title?: string): ExportRequest | null => {
  const usable = exportable(columns ?? [])
  if (usable.length === 0) {
    return null
  }
  const params = new URLSearchParams()
  params.set('format', format)
  params.set('path', EXPORT_PATH)
  params.set('fields', usable.map((column) => column.valueKey).join(','))
  // Repeated, one per field, same order. Never fewer: a count mismatch is a 400.
  for (const column of usable) {
    params.append('header', typeof column.title === 'string' ? column.title : '')
  }
  // `title` is pdf-only and ignored elsewhere, so sending it for csv/json would be noise.
  if (format === 'pdf' && title) {
    params.set('title', title)
  }
  return { fields: usable.map((column) => column.valueKey), params: params.toString() }
}

/**
 * The filename a download is offered under.
 *
 * The stem comes from page or widget text, so it is sanitised rather than trusted: anything outside
 * `[A-Za-z0-9._-]` becomes a dash, and LEADING dots and dashes are stripped as well as trailing
 * ones. Stripping only the trailing run left `../../etc/passwd` as `..-..-etc-passwd` — not a path,
 * so not a traversal, but a leading dot is a hidden file on unix and there is no reason to offer
 * one. An empty result falls back rather than producing a bare `.csv`.
 */
export const exportFilename = (format: ExportFormat, stem = 'export'): string =>
  `${stem.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'export'}.${format}`
