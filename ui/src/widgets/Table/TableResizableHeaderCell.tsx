import { useRef, type KeyboardEvent, type PointerEvent, type SyntheticEvent, type ThHTMLAttributes } from 'react'

import styles from './Table.module.css'
import { clampColumnWidth, KEYBOARD_STEP, KEYBOARD_STEP_LARGE, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from './tableColumnResize'

/** What Table hands a header cell (through `onHeaderCell`) so it can be resized. */
export type ColumnResize = {
  /** The column's `valueKey`, set on the th so Table can measure every column when a resize starts. */
  columnKey: string
  /** The column's title, for the handle's accessible name. */
  label: string
  /** The column's own `minWidth`, a floor a resize keeps to along with MIN_COLUMN_WIDTH. */
  minWidth?: number
  /** The column's width now, px, when known. Only feeds the handle's aria-valuenow. */
  width?: number
  /**
   * A resize is starting: Table pins every column to the width it has on screen (so the table does
   * not jump when it turns fixed-layout) and returns this column's width, the one the resize moves from.
   */
  begin: () => number
  /** The column's new width. `commit` is true when the resize is done, and Table keeps it for next time. */
  change: (width: number, commit: boolean) => void
  /** Hand every column back to the table's own sizing and forget the widths kept for it. */
  reset: () => void
}

type Props = ThHTMLAttributes<HTMLTableCellElement> & { resize?: ColumnResize }

type Drag = { pointerId: number; startWidth: number; startX: number; width: number }

/** Keeps an event on the handle away from the th, whose click and Enter toggle the column's sort. */
const stop = (event: SyntheticEvent) => { event.stopPropagation() }

/**
 * antd Table header cell (`components.header.cell`) with a resize handle on its right edge (#556):
 * a reader who cannot read a cut-off cell reaches for the column's border, so the border is where
 * the control is.
 *
 * The handle is a focusable vertical separator, the WAI-ARIA window-splitter pattern: dragged with a
 * pointer, or focused (it is a tab stop, drawn with the portal's `*:focus-visible` ring) and moved
 * with ArrowLeft/ArrowRight, Shift for bigger steps. A double-click hands the table back its own
 * sizing. Every event on it stops at the handle: the th underneath is the sort control, and a drag
 * that ended in a click, or an Enter on the handle, must not re-sort the rows.
 *
 * A th that antd renders without a `resize` (the scrollbar gutter of a fixed header, a column group)
 * stays exactly the plain th it was.
 */
const TableResizableHeaderCell = ({ children, resize, ...props }: Props) => {
  const drag = useRef<Drag | null>(null)

  if (!resize) { return <th {...props}>{children}</th> }

  const { begin, change, columnKey, label, minWidth, reset, width } = resize

  const onPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) { return }
    // No text selection and no focus steal while dragging; the th's own pointer handling never sees it.
    event.preventDefault()
    event.stopPropagation()
    const startWidth = begin()
    drag.current = { pointerId: event.pointerId, startWidth, startX: event.clientX, width: startWidth }
    // Capture keeps the moves coming to the handle while the pointer is over other columns or off the
    // table altogether, and the click that ends the drag lands on the handle, not on a th to sort.
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    const { current } = drag
    if (current?.pointerId !== event.pointerId) { return }
    const next = clampColumnWidth(current.startWidth + event.clientX - current.startX, current.startWidth, minWidth)
    if (next === current.width) { return }
    current.width = next
    change(next, false)
  }

  const endDrag = (event: PointerEvent<HTMLSpanElement>) => {
    const { current } = drag
    if (current?.pointerId !== event.pointerId) { return }
    drag.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) { event.currentTarget.releasePointerCapture(event.pointerId) }
    change(current.width, true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    event.stopPropagation()
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') { return }
    event.preventDefault()
    const startWidth = begin()
    const step = (event.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP) * (event.key === 'ArrowRight' ? 1 : -1)
    change(clampColumnWidth(startWidth + step, startWidth, minWidth), true)
  }

  return (
    <th {...props} data-column-key={columnKey}>
      {children}
      {/* A focusable separator is an interactive widget in ARIA 1.2 (the window splitter), with a value
          it moves; jsx-a11y still files `separator` under the non-interactive roles. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <span
        aria-label={`Resize column ${label}`}
        aria-orientation='vertical'
        aria-valuemax={MAX_COLUMN_WIDTH}
        aria-valuemin={Math.max(MIN_COLUMN_WIDTH, minWidth ?? 0)}
        aria-valuenow={width}
        className={styles.resizeHandle}
        onClick={stop}
        onDoubleClick={(event) => {
          event.stopPropagation()
          reset()
        }}
        onKeyDown={onKeyDown}
        onLostPointerCapture={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        role='separator'
        tabIndex={0}
      />
    </th>
  )
}

export default TableResizableHeaderCell
