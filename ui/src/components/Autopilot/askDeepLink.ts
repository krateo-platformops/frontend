/**
 * The `?ask=` deep-link: a widget can start an Autopilot turn via `?ask=<prompt>`
 * (e.g. the composition-detail "Diagnose" button, or an alert's "Troubleshoot with
 * Autopilot"). When Autopilot is enabled the prompt is handed to the provider's
 * seed callback once per visit (guarded so a refresh doesn't re-ask); the context
 * collector already carries the page's telemetry, so the analysis is grounded.
 *
 * UX-19 (Diagnose honesty): on a portal WITHOUT Autopilot the deep-link used to
 * silently no-op — the page navigated, the param sat in the URL, and nothing
 * explained why no assistant appeared. Now the disabled path shows an honest
 * notification instead. Both paths strip the consumed param (replace, not push)
 * so refreshes and re-renders don't re-fire; normal navigation stays intact.
 */

import { App } from 'antd'
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'

/** The honest explanation shown instead of the old silent no-op. */
export const ASK_UNAVAILABLE_DESCRIPTION = 'Agentiko is not enabled on this portal — the Diagnose assistant is unavailable. Ask your administrator to enable it.'
export const ASK_UNAVAILABLE_TITLE = 'Agentiko unavailable'

/** Anti-spam: a stable key makes a double-fire (StrictMode dev double-invoke, or a
 * re-render racing the param strip) REPLACE the notification instead of stacking it. */
const ASK_UNAVAILABLE_KEY = 'autopilot-ask-unavailable'

/** Consume the `?ask=` deep-link. Enabled: seed one Autopilot turn per visit via
 * `onAsk` and strip the param. Disabled: notify honestly (UX-19) and strip the
 * param. No `ask` present: no-op. */
export const useAskDeepLink = (enabled: boolean, onAsk: (ask: string) => void): void => {
  const { notification } = App.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  // Guards the one-shot enabled-path seed so it fires a single turn per visit.
  const handledRef = useRef(false)
  useEffect(() => {
    const ask = searchParams.get('ask')
    if (!ask) { return }
    if (enabled) {
      if (handledRef.current) { return }
      handledRef.current = true
      onAsk(ask)
    } else {
      notification.warning({
        description: ASK_UNAVAILABLE_DESCRIPTION,
        key: ASK_UNAVAILABLE_KEY,
        placement: 'bottomLeft',
        title: ASK_UNAVAILABLE_TITLE,
      })
    }
    const next = new URLSearchParams(searchParams)
    next.delete('ask')
    setSearchParams(next, { replace: true })
  }, [enabled, notification, onAsk, searchParams, setSearchParams])
}
