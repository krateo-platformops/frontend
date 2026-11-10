/**
 * Where focus goes when the rail collapses (audit X4 K3).
 *
 * A collapsed rail is `inert` (AgentikoRail, AgentikoLockedRail), and focus inside an inert subtree
 * is dropped to `<body>`. So every collapse path that can start with focus in the rail moves focus
 * to the control that opens it — the header's AgentikoToggle — BEFORE the rail collapses: Escape
 * and the Collapse button (AgentikoRail), the locked rail's Collapse button, and ⌘G
 * (keyboardShortcut.ts). A collapse with focus elsewhere on the page leaves focus where it is.
 *
 * Module-level refs because the shell mounts exactly one rail and one toggle, in different
 * subtrees (the rail in AgentikoShell, the toggle in the server-driven header), and the ⌘G handler
 * sits in the provider above both.
 */

import { createRef } from 'react'

/** The header's AgentikoToggle button, in each of its states. */
export const railOpenerRef = createRef<HTMLButtonElement>()

/** The rail's `<aside>`: the live rail's, or the locked licence rail's. */
export const railRef = createRef<HTMLElement>()

/** If focus is inside the rail, move it to the toggle. Call before the rail collapses. */
export const returnFocusToOpener = (): void => {
  if (railRef.current?.contains(document.activeElement)) {
    railOpenerRef.current?.focus()
  }
}
