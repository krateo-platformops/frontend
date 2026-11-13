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
 * the unlicensed path calls `onRefused` instead. Both paths strip the consumed param (replace, not
 * push) so refreshes and re-renders don't re-fire; normal navigation stays intact.
 *
 * #653: LICENSED IS NOT REACHABLE. With the licence in place but the agent not answering (not deployed,
 * down, or this user refused by the gateway: availability.ts), the click used to go down the licensed
 * path: it archived the conversation that was open, started a new thread and sent a turn that could
 * only fail — an empty chat with an error in it, for a button that could never have worked. Now an
 * unreachable agent gets `onRefused` like an unlicensed one: the rail opens and says why (its
 * "unavailable" note, or the licence panel), and the conversation is left alone. While the first
 * probe has not answered (`checking`) the param is held, not consumed — a page opened straight on an
 * `?ask=` link waits a moment for the verdict instead of guessing it.
 */

import { useEffect, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router'

import type { AskAccess } from './availability'

/** Consume the `?ask=` deep-link. `ready`: seed one turn per navigation that carries it, via
 * `onAsk`. `locked` or `unavailable`: `onRefused` (the provider opens the rail, which explains).
 * Either way the param is stripped. `checking`: wait for the verdict. No `ask` present: no-op. */
export const useAskDeepLink = (access: AskAccess, onAsk: (ask: string) => void, onRefused: () => void): void => {
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
    if (!ask || access === 'checking') { return }
    if (handledKeyRef.current !== key) {
      handledKeyRef.current = key
      if (access === 'ready') {
        onAsk(ask)
      } else {
        onRefused()
      }
    }
    const next = new URLSearchParams(searchParams)
    next.delete('ask')
    setSearchParams(next, { replace: true })
  }, [access, key, onAsk, onRefused, searchParams, setSearchParams])
}
