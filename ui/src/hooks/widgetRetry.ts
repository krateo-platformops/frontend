import { WidgetReadTimeoutError } from './widgetRequest'

/**
 * WHICH FAILED WIDGET READS ARE RETRIED, and when: one policy for a widget's own query and for a parent's
 * prefetch of it. They are the same read under the same key, so a widget that mounts while its prefetch is
 * in flight gets that read's retries, not its own.
 */
export const MAX_WIDGET_FETCH_RETRIES = 3

/**
 * Whether a failed widget fetch should be retried. The global QueryClient sets
 * `retry: false`, so without this a backend that has not answered yet (network
 * error / 5xx during startup) lands immediately in the error state — the
 * "red cross on initial render". We retry transient failures and never permanent
 * client errors.
 *
 * 404 is treated as TRANSIENT here: right after a page load/refresh snowplow can
 * answer 404 for a widget endpoint while its informer cache is still cold (the CR
 * exists but isn't listed yet) — that produced an "Error while rendering widget"
 * flash on first paint that recovered on the next fetch. Retrying 404 a few times
 * keeps the skeleton up until the cache warms; a genuinely-missing widget still
 * surfaces the error once the retries are exhausted. The other 4xx (400 bad
 * request, 401 auth, 403 forbidden) stay permanent — retrying them never helps.
 *
 * `eventTriggered` (#256) is the ONE exception, and it inverts only the 404 case. When the
 * refetch was triggered by a `refresh` frame, snowplow has just told us this object changed —
 * and from snowplow 1.12.6 a DELETE-semantics eviction publishes such a frame. A 404 answering
 * THAT is a confirmed delete, not a cold informer: the retries cannot discover anything new, and
 * at MAX_WIDGET_FETCH_RETRIES=3 with 700/1400/2800 ms backoff they cost 4 requests and ~4.9 s per
 * widget. On a bulk delete across a dense page that is a fourfold amplification of the very burst
 * the server's token bucket exists to pace. The render state for it already exists
 * (WidgetRenderer's WidgetNotFound), so failing fast shows the right thing sooner AND cheaper.
 *
 * The flag is read from the refresh transport through a single exported boolean
 * (`wasRefetchEventTriggered`) so this predicate stays pure and knows nothing about the stream.
 */
export const shouldRetryWidgetFetch = (failureCount: number, error: unknown, eventTriggered = false): boolean => {
  // The client deadline (WIDGET_READ_DEADLINE_MS, 30 s) is not retried: three more attempts would keep
  // the skeleton about two minutes. The timeout state's Retry button is the retry. A snowplow 504 is a
  // different failure (it arrives in seconds) and keeps the policy below.
  if (error instanceof WidgetReadTimeoutError) {
    return false
  }
  const status = (error as { status?: number } | null)?.status
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 404) {
    return false
  }
  if (status === 404 && eventTriggered) {
    return false
  }
  return failureCount < MAX_WIDGET_FETCH_RETRIES
}

/** Exponential backoff (capped) between widget-fetch retries. */
export const widgetFetchRetryDelay = (attemptIndex: number): number => Math.min(700 * 2 ** attemptIndex, 5000)
