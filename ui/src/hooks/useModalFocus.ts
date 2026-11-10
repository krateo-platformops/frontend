/**
 * Modal-dialog focus for the session-expired surface (audit X4 K1).
 *
 * That surface is a full-viewport opaque page drawn over the app, not an antd Modal, so it gets
 * none of rc-dialog's focus handling and has to do the dialog's whole contract itself:
 *
 *   - on open, focus moves into it: to its heading at once, then to its first field when the
 *     sign-in form renders, which is after `/strategies` answers;
 *   - Tab and Shift+Tab wrap inside it;
 *   - everything behind it is `inert`, so neither Tab nor a screen reader's cursor reaches the
 *     page it covers;
 *   - on close, focus goes back to where it was.
 *
 * Why not an antd Modal: rc-dialog names the dialog only through its own `title` header (which
 * would replace the surface's heading and its styles), starts focus on the dialog box rather than a
 * field, animates in, and leaves the page behind it out of the tab order only by pulling focus
 * back after it has left. It does not make that page inert, so this hook would be needed anyway.
 */

import { type RefObject, useEffect } from 'react'

import { inertOutside, tabbableIn } from '../utils/focus'

const FIELD_SELECTOR = 'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])'

/** Tab from the last stop goes to the first, Shift+Tab from the first goes to the last. Focus on
 * something that is not a stop (the heading, or `<body>` after a click on the backdrop) goes to the
 * first stop forward and the last one backward. */
const wrapTab = (dialog: HTMLElement, event: KeyboardEvent) => {
  const stops = tabbableIn(dialog)
  if (stops.length === 0) {
    event.preventDefault()
    return
  }
  const index = stops.indexOf(document.activeElement as HTMLElement)
  const [first] = stops
  const last = stops[stops.length - 1]
  if (event.shiftKey && index <= 0) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (index === -1 || index === stops.length - 1)) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * @param open        whether the dialog is shown; `dialogRef` must be attached while it is.
 * @param dialogRef   the element with `role="dialog"`.
 * @param headingRef  the heading that names the dialog; it needs `tabIndex={-1}` to take focus.
 * @param formShown   whether the dialog's fields have rendered. When it turns true, focus moves to
 *                    the first field, unless the person has already moved it off the heading.
 */
export const useModalFocus = (
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  headingRef: RefObject<HTMLElement | null>,
  formShown: boolean,
): void => {
  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) {
      return
    }
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const releaseInert = inertOutside(dialog)
    headingRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        wrapTab(dialog, event)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      releaseInert()
      // After the inert is lifted: an element inside an inert subtree cannot take focus.
      if (returnTo?.isConnected) {
        returnTo.focus({ preventScroll: true })
      }
    }
  }, [open, dialogRef, headingRef])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !formShown || !dialog) {
      return
    }
    const active = document.activeElement
    if (active !== headingRef.current && dialog.contains(active)) {
      return
    }
    dialog.querySelector<HTMLElement>(FIELD_SELECTOR)?.focus()
  }, [open, formShown, dialogRef, headingRef])
}
