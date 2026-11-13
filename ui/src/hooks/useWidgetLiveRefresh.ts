import { useEffect } from 'react'

import { type RefreshCredential, refreshManager, type RefreshEntry } from './refreshSse'

/**
 * Arm a single widget on the tab-wide `/refreshes` stream while it is mounted and
 * has a captured refresh entry (its coords + the key its events arrive under,
 * recorded from the `/call` response headers — see refreshSse.recordRefreshHeaders).
 *
 * `entry` is referentially stable between identical refetches (recordRefreshHeaders
 * replaces the stored object only when the key/coords change), so the effect
 * re-arms only when the widget's subscription actually changes — not on every
 * refetch. Disarms on unmount via the cleanup. No-ops when the feature is off,
 * the response wasn't cache-keyed (no entry), the base URL is missing, or there is no
 * `credential` — the signed-in transport's session, which a public page does not have.
 */
export const useWidgetLiveRefresh = (
  widgetId: string,
  entry: RefreshEntry | undefined,
  refetch: () => unknown,
  baseUrl: string | undefined,
  enabled: boolean,
  credential: RefreshCredential | undefined,
): void => {
  useEffect(() => {
    if (!enabled || !entry || !baseUrl || !credential) { return undefined }
    refreshManager.configure(baseUrl, credential)
    return refreshManager.arm(widgetId, entry.coords, entry.key, refetch)
  }, [enabled, widgetId, entry, baseUrl, refetch, credential])
}
