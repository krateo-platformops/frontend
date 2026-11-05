/**
 * Focus trap + Escape-to-collapse for the docked rail. The rail is a plain `<aside>` (not an
 * antd Drawer/Modal), so — unlike CommandPalette, which gets this for free from rc-dialog — it
 * needs its own Tab-cycling: without it, Tab from the last control (Send) walks focus off the
 * rail into whatever the reflowed main column happens to render next, which reads as broken
 * keyboard navigation on a panel that visually still owns the screen edge.
 */

import { useEffect } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** Active only while `active` (the rail's own `open`) — a closed-but-mounted rail (width 0)
 * must never intercept Tab/Escape for the page behind it. Escape mirrors the existing
 * "Collapse rail" button (setOpen(false)) exactly, so there's no separate close path to
 * keep in sync — including that a pending approval is left untouched (only Deny/Approve/
 * dismiss/the 5-minute governor resolve it, not collapsing the rail). */
export const useRailFocusTrap = (active: boolean, containerRef: RefObject<HTMLElement | null>, onEscape: () => void): void => {
  useEffect(() => {
    if (!active) {
      return
    }
    const container = containerRef.current
    if (!container) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onEscape()
        return
      }
      if (event.key !== 'Tab') {
        return
      }
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (!focusable.length) {
        return
      }
      const [first] = focusable
      const last = focusable[focusable.length - 1]
      const activeEl = document.activeElement
      // Wrap at either end, and also recapture focus if it somehow landed outside the rail
      // (e.g. a prior render's element was removed mid-tab).
      if (event.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          event.preventDefault()
          last.focus()
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        event.preventDefault()
        first.focus()
      }
    }
    container.addEventListener('keydown', onKeyDown)
    return () => container.removeEventListener('keydown', onKeyDown)
  }, [active, containerRef, onEscape])
}
