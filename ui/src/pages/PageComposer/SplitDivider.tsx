/**
 * The handle between the canvas and the preview.
 *
 * WHY THE TWO PANES SHARE A COLUMN AT ALL. The preview used to sit below the whole builder row, and
 * the CSS said why: "what I am building above what it looks like is the order the work is actually
 * done in." That treats the preview as an OUTCOME. It is a FEEDBACK LOOP — you do not build and
 * then look, you build because you are looking — and putting it under a content-height row meant it
 * was off-screen for every draft small enough to leave the row short. The cost was not theoretical:
 * a recorded demo dropped widgets, bound a table and rendered a blank page, and nobody caught it,
 * because the render was never on screen at the same time as the thing that produced it.
 *
 * WHY A DIVIDER AND NOT A TAB. A tab shows one at a time, and the question the preview answers —
 * "did that edit do what I meant" — needs both at once. Dragging to 0 or 100 is how someone gets
 * the single-pane view when they want to concentrate, so the tab's affordance is still reachable
 * without making it the only mode.
 *
 * OPERABLE WITHOUT A POINTER. A resizer that only responds to drag is the same WCAG 2.5.7 failure
 * the canvas already had to fix once: arrows nudge, Home/End slam to the bounds, and the value is
 * announced as a percentage because that is what it is.
 */
import { useCallback, useRef } from 'react'

import styles from './PageComposer.module.css'

/** Kept off the extremes so neither pane can be dragged to nothing by accident. */
export const MIN_SPLIT = 20
export const MAX_SPLIT = 80
const STEP = 4

export const clampSplit = (value: number): number =>
  Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, Math.round(value)))

/** The ratio a pointer at `clientY` implies, given the column it is dragging inside. */
export const splitFromPointer = (clientY: number, box: { height: number; top: number }): number =>
  clampSplit(box.height > 0 ? ((clientY - box.top) / box.height) * 100 : MIN_SPLIT)

export const SplitDivider = ({ onChange, value }: {
  onChange: (next: number) => void
  /** Percentage of the column's height given to the canvas above. */
  value: number
}): React.ReactNode => {
  const ref = useRef<HTMLDivElement>(null)

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const column = ref.current?.parentElement
    if (!column) {
      return
    }
    // Pointer capture rather than window listeners: the drag keeps tracking when the pointer leaves
    // the handle, and it is released for us if the gesture is cancelled.
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    const move = (moved: PointerEvent) => onChange(splitFromPointer(moved.clientY, column.getBoundingClientRect()))
    const up = () => {
      event.currentTarget.removeEventListener('pointermove', move)
      event.currentTarget.removeEventListener('pointerup', up)
    }
    event.currentTarget.addEventListener('pointermove', move)
    event.currentTarget.addEventListener('pointerup', up)
  }, [onChange])

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const by = { ArrowDown: STEP, ArrowUp: -STEP, End: MAX_SPLIT, Home: MIN_SPLIT }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      onChange(by[event.key])
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      onChange(clampSplit(value + by[event.key]))
    }
  }, [onChange, value])

  return (
    <div
      aria-label='Resize the preview'
      aria-orientation='horizontal'
      aria-valuemax={MAX_SPLIT}
      aria-valuemin={MIN_SPLIT}
      aria-valuenow={Math.round(value)}
      className={styles.split}
      data-testid='composer-split'
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      ref={ref}
      role='separator'
      tabIndex={0}
    />
  )
}

export default SplitDivider
