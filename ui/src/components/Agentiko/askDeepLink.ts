/**
 * The `?ask=` deep-link: a widget can start an agent turn via `?ask=<prompt>` (every
 * `intent: agentiko` button — "Ask Agentiko →" — navigates that way). When the agent is LICENSED
 * the prompt is handed to the provider's seed callback once per navigation that carries it (a
 * refresh does not re-ask: the param is already stripped); the context collector already carries the page's telemetry, so the analysis is
 * grounded.
 *
 * UX-19 (honesty): on a portal WITHOUT the agent the deep-link used to silently no-op. It then
 * showed a notification; since the licence model (licence.ts) the locked rail IS the explanation —
 * it opens on the "Activate licence" panel, which says what the agent does and how to get it — so
 * the unlicensed path calls `onLocked` instead. Both paths strip the consumed param (replace, not
 * push) so refreshes and re-renders don't re-fire; normal navigation stays intact.
 */

import { useEffect, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router'

/** Consume the `?ask=` deep-link. Licensed: seed one turn per navigation that carries it, via
 * `onAsk`. Not licensed: `onLocked` (the provider opens the locked rail). Either way the param is
 * stripped. No `ask` present: no-op. */
export const useAskDeepLink = (licensed: boolean, onAsk: (ask: string) => void, onLocked: () => void): void => {
  const [searchParams, setSearchParams] = useSearchParams()
  const { key } = useLocation()
  /*
   * The navigation entry whose `ask` was handled. Keyed on the entry, not a once-only flag: the
   * provider that calls this lives in the persistent shell, so a boolean set by the first
   * "Ask Agentiko →" click stayed set for the rest of the page load, and every later click had its
   * prompt stripped without starting a turn. Each click is its own navigation and gets its own key;
   * a StrictMode double-invoke, or a re-render before the strip lands, sees the same key and is
   * skipped. The strip itself is a replace with no `ask`, so it never re-fires.
   */
  const handledKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const ask = searchParams.get('ask')
    if (!ask) { return }
    if (handledKeyRef.current !== key) {
      handledKeyRef.current = key
      if (licensed) {
        onAsk(ask)
      } else {
        onLocked()
      }
    }
    const next = new URLSearchParams(searchParams)
    next.delete('ask')
    setSearchParams(next, { replace: true })
  }, [key, licensed, onAsk, onLocked, searchParams, setSearchParams])
}
