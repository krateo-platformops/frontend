import { useEffect } from 'react'

import { useConfigContext } from '../context/ConfigContext'

import { type InvolvedObject, liveRefreshRegistry, type WatchMatcher } from './liveRefresh'
import { subscribeSse } from './sseClient'

/**
 * DORMANT ON PURPOSE — see `LIVE_REFRESH_FIREHOSE_ENABLED` below. Flip that to `true`
 * in a PR of its own to turn this on; do not fold it into another change.
 *
 * The type annotation is load-bearing: without `: boolean` the literal type is `false`,
 * TypeScript narrows the guard to always-taken, and everything below it becomes
 * unreachable code.
 */
export const LIVE_REFRESH_FIREHOSE_ENABLED: boolean = false

/**
 * Mount ONCE near the app root: pipe the SSE event firehose into the live-refresh
 * registry, which fans each event out to the widgets that declared a matching
 * `watch`. Subscribes through the shared sseClient, so it reuses the connection
 * Notifications already holds (no extra socket).
 *
 * ── Why this is switched off ────────────────────────────────────────────────────
 * It has never worked. `sseClient` keys connections on the url; the bell's url
 * carried `?access_token=` and this one did not, so the two keyed DIFFERENT cells
 * and this opened its own connection with no credential, which sse-proxy answered
 * 401. It passes no `onError`, so it failed in total silence — 45 such 401s in a
 * 7-day window on 057, a stable ~29% of all traffic on the route. The docstring
 * above has therefore been false since it was written.
 *
 * Taking the token out of the url (installer#395) makes both urls identical, so this
 * would start working the moment that ships. That is a live behaviour change —
 * `watch`-declaring widgets begin refetching, each matching event becoming a snowplow
 * `/call` per open tab — and it has never run under load here. It must not ride in on
 * a security fix whose only revert path puts the JWT back in the url.
 *
 * So the transport fix ships alone and this stays off. Enabling it is one line, and it
 * wants its own review, its own deploy and its own watch — away from a reconcile storm
 * (core-provider 2.13.28 annotates every composition on next reconcile, which is
 * exactly the event burst this would amplify).
 */
export const useLiveRefreshFirehose = (): void => {
  const { config } = useConfigContext()

  useEffect(() => {
    if (!LIVE_REFRESH_FIREHOSE_ENABLED) { return undefined }

    const base = config?.api.EVENTS_PUSH_API_BASE_URL
    if (!base) { return undefined }

    return subscribeSse(`${base}/notifications`, 'krateo', {
      onMessage: (raw) => {
        try {
          const event = JSON.parse(raw) as { involvedObject?: InvolvedObject }
          if (event.involvedObject) { liveRefreshRegistry.handleEvent(event.involvedObject) }
        } catch { /* ignore malformed SSE payloads */ }
      },
    })
  }, [config])
}

/**
 * A widget declares the involvedObject(s) it is tied to (`widgetData.watch`) and
 * refetches when a matching k8s event arrives (throttled per widget by the
 * registry). Re-registers only when the watch content or refetch fn changes.
 */
export const useLiveWatch = (watch: WatchMatcher[] | undefined, refetch: () => unknown): void => {
  const key = watch && watch.length > 0 ? JSON.stringify(watch) : ''

  useEffect(() => {
    if (!key) { return undefined }

    return liveRefreshRegistry.register(JSON.parse(key) as WatchMatcher[], refetch)
  }, [key, refetch])
}
