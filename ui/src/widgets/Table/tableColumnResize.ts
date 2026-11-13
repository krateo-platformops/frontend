/**
 * Column widths a reader sets by dragging a header's right edge (#556), and where they are kept.
 *
 * antd's Table has no column resize of its own; the header cell that carries the handle is
 * TableResizableHeaderCell. These are the numbers and the storage it and Table share, kept out of
 * the component so they can be pinned on their own.
 */

/** Widths the reader set, px, by column `valueKey`. Empty until a column is resized. */
export type ColumnWidths = Record<string, number>

/**
 * The narrowest a reader can drag a column, px: room for a few characters of a cell and the sort
 * icon, so a column can be made small but never collapsed to a sliver nobody can grab back.
 */
export const MIN_COLUMN_WIDTH = 64

/** The widest a reader can make a column, px. A bound so the separator's aria-valuemax means something. */
export const MAX_COLUMN_WIDTH = 2400

/** One ArrowLeft/ArrowRight on a focused handle, px; Shift moves four steps at once. */
export const KEYBOARD_STEP = 16
export const KEYBOARD_STEP_LARGE = 4 * KEYBOARD_STEP

/**
 * A column's width when nothing better is known: the page has not laid it out (jsdom, a table in a
 * hidden tab) and neither the layout nor the author gave it one. Only ever a starting point for a
 * resize, never the width of a table nobody touched.
 */
export const DEFAULT_COLUMN_WIDTH = 160

/**
 * The width a resize lands on. Never below the floor (the larger of MIN_COLUMN_WIDTH and the
 * column's own `minWidth`) and never past MAX_COLUMN_WIDTH, with one exception: a column the page
 * already laid out narrower than the floor (an icon column) is not pushed wider by a step meant to
 * shrink it, so the floor for that column is where it started.
 */
export const clampColumnWidth = (next: number, start: number, minWidth = 0): number => {
  const floor = Math.min(Math.max(MIN_COLUMN_WIDTH, minWidth), start)
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(floor, next)))
}

/**
 * Per table, per viewer: the widget's uid names the table, and the browser's storage is this
 * viewer's own. A width is a reading convenience, not state anyone else needs, so it does not go to
 * the server.
 */
export const columnWidthsStorageKey = (uid: string): string => `krateo-table-column-widths:${uid}`

/**
 * The widths this viewer last left on the table, or none. Storage can be missing or throw (a
 * private window, blocked site data) and what is in it can be anything an older build or a hand
 * wrote, so every failure reads as "never resized" and only finite positive numbers survive.
 */
export const readColumnWidths = (uid: string | undefined): ColumnWidths => {
  if (!uid) { return {} }
  try {
    const raw = window.localStorage.getItem(columnWidthsStorageKey(uid))
    if (!raw) { return {} }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return {} }
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => (
      typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0
    )))
  } catch {
    return {}
  }
}

/** Keep the widths for next time; no widths removes the entry. A storage that throws is ignored. */
export const writeColumnWidths = (uid: string | undefined, widths: ColumnWidths): void => {
  if (!uid) { return }
  try {
    if (Object.keys(widths).length) {
      window.localStorage.setItem(columnWidthsStorageKey(uid), JSON.stringify(widths))
    } else {
      window.localStorage.removeItem(columnWidthsStorageKey(uid))
    }
  } catch {
    // Nothing to do: the widths still hold for as long as the table is on screen.
  }
}
