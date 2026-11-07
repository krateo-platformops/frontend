/**
 * The `?ask=` deep-link: a widget can start an agent turn via `?ask=<prompt>` (every
 * `intent: agentiko` button — "Ask Agentiko →" — navigates that way). When the agent is LICENSED
 * the prompt is handed to the provider's seed callback once per visit (guarded so a refresh
 * doesn't re-ask); the context collector already carries the page's telemetry, so the analysis is
 * grounded.
 *
 * UX-19 (honesty): on a portal WITHOUT the agent the deep-link used to silently no-op. It then
 * showed a notification; since the licence model (licence.ts) the locked rail IS the explanation —
 * it opens on the "Activate licence" panel, which says what the agent does and how to get it — so
 * the unlicensed path calls `onLocked` instead. Both paths strip the consumed param (replace, not
 * push) so refreshes and re-renders don't re-fire; normal navigation stays intact.
 */

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'

/** Consume the `?ask=` deep-link. Licensed: seed one turn per visit via `onAsk`. Not licensed:
 * `onLocked` once per visit (the provider opens the locked rail). Either way the param is
 * stripped. No `ask` present: no-op. */
export const useAskDeepLink = (licensed: boolean, onAsk: (ask: string) => void, onLocked: () => void): void => {
  const [searchParams, setSearchParams] = useSearchParams()
  // Guards the one-shot handling so it fires once per visit (StrictMode double-invoke, or a
  // re-render racing the param strip).
  const handledRef = useRef(false)
  useEffect(() => {
    const ask = searchParams.get('ask')
    if (!ask) { return }
    if (!handledRef.current) {
      handledRef.current = true
      if (licensed) {
        onAsk(ask)
      } else {
        onLocked()
      }
    }
    const next = new URLSearchParams(searchParams)
    next.delete('ask')
    setSearchParams(next, { replace: true })
  }, [licensed, onAsk, onLocked, searchParams, setSearchParams])
}
