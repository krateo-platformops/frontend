/**
 * Global ⌘G / Ctrl+G opens/closes the rail from anywhere, mirroring CommandPalette's own ⌘K
 * (see AutopilotToggle.tsx for the matching visible hint). Lives in the provider, not the
 * header button, so it keeps working even while HeaderChrome (a server-driven widget) is
 * mid-reload or errored.
 */

import { useEffect } from 'react'

/** Gated on `reachable` — same reason the header button disables itself — so the shortcut
 * can't pop open a rail with no usable agent behind it. preventDefault suppresses
 * Chrome/Firefox's own Cmd+G "Find Next" binding, which the combo would otherwise trigger. */
export const useAutopilotShortcut = (reachable: boolean, toggle: () => void): void => {
  useEffect(() => {
    if (!reachable) {
      return
    }
    // The bare DOM KeyboardEvent (not React's synthetic one) — this listens on `window`
    // directly, outside React's event system.
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [reachable, toggle])
}
