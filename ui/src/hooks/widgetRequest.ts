/**
 * ONE WIDGET READ, outside React: the request a widget's query makes, its cache key, and the fetch.
 *
 * WHY THIS EXISTS (prefetch children on answer, approved by Diego 2026-11-22). useWidgetQuery used to
 * assemble its URL, key and fetch inside the hook, so nothing else could make the SAME read. A parent
 * that wants its children's answers in flight before it renders (hooks/prefetchChildren.ts) must put
 * them under exactly the key, and fetch them exactly the way, the child's own query will: a key that
 * differs in one byte is a second read of the same widget. So the read lives here, and both the hook
 * and the prefetcher call it.
 *
 * It imports nothing that can reach the token: the transport in hand carries the credential, if any
 * (transport/widgetTransport.ts, tokenReach.test.ts).
 */
import type { TransportFetch, WidgetTransport } from '../transport/widgetTransport'
import type { Widget } from '../types/Widget'

import { recordRefreshHeaders } from './refreshSse'

/** Error carrying the HTTP status so retry logic can tell transient from permanent failures. */
export class WidgetFetchError extends Error {
  status?: number
  /** The backend's OWN explanation, when the failure response carried one. */
  detail?: string
  constructor(message: string, status?: number, detail?: string) {
    super(message)
    this.name = 'WidgetFetchError'
    this.status = status
    this.detail = detail
  }
}

/**
 * Best-effort read of a failure response's body for the backend's own message.
 *
 * Previously only `res.status` + `res.statusText` reached the UI — a generic HTTP phrase like
 * "Forbidden" — and the body was dropped on the floor, so whatever snowplow said about WHY was
 * never seen by anyone. The body is read once here (the response is being discarded anyway) and
 * the message hoisted onto the error.
 *
 * Deliberately total: a non-JSON body, an empty body, or a body that cannot be read must never
 * turn a failed fetch into a DIFFERENT failure — we are already on the error path.
 */
/**
 * The error body, read ONCE.
 *
 * It returns the parsed object as well as the display message because a 401's step-up
 * discriminator lives in `details.causes[0].reason` (snowplow#1029) and a Response body cannot be
 * read twice — the previous version parsed the JSON, kept only the message and threw the object
 * away, so classifying a 401 would have needed a second read that is guaranteed to fail.
 */
const readErrorBody = async (res: Response): Promise<{ body: unknown; detail: string | undefined }> => {
  try {
    const text = await res.text()
    if (!text) { return { body: null, detail: undefined } }
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const message = parsed.message ?? parsed.error ?? parsed.reason
      if (typeof message === 'string' && message) { return { body: parsed, detail: message.slice(0, 300) } }
      return { body: parsed, detail: text.slice(0, 300) }
    } catch { /* not JSON — fall through to the raw text */ }
    return { body: null, detail: text.slice(0, 300) }
  } catch {
    return { body: null, detail: undefined }
  }
}

/**
 * A widget read with its extras in the BODY: POST /call/read, every other parameter left on the
 * query. Used only when the extras carry the page's fragment values, which must reach no URL.
 *
 * Refuses an endpoint that is not a `/call` — there is no body-carrying form of anything else, and
 * falling back to the query would put the values in the very URL this exists to keep them out of.
 */
export const readWithBodyExtras = (read: TransportFetch, requestUrl: URL, extrasParam: string, signal?: AbortSignal): Promise<Response> => {
  const url = new URL(requestUrl.toString())
  if (!url.pathname.endsWith('/call')) {
    throw new WidgetFetchError(`A widget with fragment extras must read through /call, not ${url.pathname}`)
  }
  url.pathname = `${url.pathname}/read`
  url.searchParams.delete('extras')
  return read(url.toString(), {
    body: JSON.stringify({ extras: extrasParam ? JSON.parse(extrasParam) as unknown : {} }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal,
  })
}

/**
 * A widget's react-query key. The stable 3-tuple, or with the server page for a classic-pager
 * widget, whose every page is its own entry (see useWidgetQuery).
 */
export const widgetQueryKey = (widgetEndpoint: string, extrasParam: string, serverPage?: number): readonly unknown[] =>
  (serverPage === undefined ? ['widgets', widgetEndpoint, extrasParam] : ['widgets', widgetEndpoint, extrasParam, serverPage])

/** Everything one widget read needs, beyond the page. */
export interface WidgetRead {
  /** SNOWPLOW_API_BASE_URL + the widget endpoint, before page, perPage and extras are set. */
  readonly url: string
  /** The extras envelope (buildExtrasParam): on the query, or in the body when `extrasInBody`. */
  readonly extrasParam: string
  /** The page's fragment extras ride in the body (POST /call/read) and never reach a URL. */
  readonly extrasInBody: boolean
  readonly transport: Pick<WidgetTransport, 'fetch' | 'onUnauthorized'>
  /** The widgetId this read records its live-refresh headers under; undefined when not armed. */
  readonly refreshWidgetId?: string
}

/**
 * HOW LONG ONE WIDGET READ MAY TAKE before the client gives up on it: 15 s.
 *
 * WHY A DEADLINE. A read that never settles (a connection that stalls, a proxy that holds it open)
 * left the widget on its loading skeleton for good: the fetch had no deadline, so neither an error
 * nor the calm timeout state (WidgetStates' WidgetTimeout, with Retry) was ever reached.
 *
 * WHY 15 s. snowplow bounds a /call read by its page budget, a 10 s goal after which it ends the
 * exchange with a 504 (builder-gate/src/snowplow.ts, STAGE_TIMEOUT_REASON, snowplow#1115). The client
 * deadline must be LONGER than that, or it would cut off the very 504 that carries the server's own
 * answer and replace it with a guess; 15 s leaves a 5 s margin for the network and the proxy hops. It
 * is also the deadline the other client reads of snowplow already use (builders/clusterBuilders.ts,
 * READ_TIMEOUT_MS). A deadline past the 30 s the nginx session proxies wait would never be reached.
 */
export const WIDGET_READ_DEADLINE_MS = 15_000

/**
 * The read did not settle within WIDGET_READ_DEADLINE_MS. Carries NO status: none was received, and
 * inventing a 504 would claim the server said something it did not. isTimeoutError recognises it by
 * its message ("timed out"), so WidgetRenderer shows the calm timeout state; shouldRetryWidgetFetch
 * sees no 4xx status and retries it as it retries a 504.
 */
export class WidgetReadTimeoutError extends WidgetFetchError {
  constructor(deadlineMs: number) {
    super(`Widget read timed out after ${deadlineMs / 1000} s`)
    this.name = 'WidgetReadTimeoutError'
  }
}

/**
 * Run `read` under the deadline and the caller's own signal (react-query's: unmount, refetch).
 *
 * One AbortController serves both, wired by hand rather than with AbortSignal.any /
 * AbortSignal.timeout: those are absent from older browsers, and AbortSignal.timeout uses a timer
 * that fake timers cannot drive. The deadline firing and the caller aborting stay distinguishable:
 * the first rejects with WidgetReadTimeoutError, the second with the caller's own abort reason, so a
 * cancel is never reported as a timeout. The race also settles when the transport ignores the
 * signal, which is the case that hangs.
 */
const withDeadline = <T>(run: (signal: AbortSignal) => Promise<T>, outer: AbortSignal | undefined, deadlineMs: number): Promise<T> => {
  const controller = new AbortController()
  let cleanup = () => { /* replaced below */ }
  const ended = new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new WidgetReadTimeoutError(deadlineMs))
      controller.abort()
    }, deadlineMs)
    const onOuterAbort = () => {
      const reason: unknown = outer?.reason
      reject(reason instanceof Error ? reason : new DOMException('The read was cancelled', 'AbortError'))
      controller.abort(reason)
    }
    if (outer?.aborted) {
      onOuterAbort()
    } else {
      outer?.addEventListener('abort', onOuterAbort, { once: true })
    }
    cleanup = () => {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onOuterAbort)
    }
  })
  return Promise.race([run(controller.signal), ended]).finally(cleanup)
}

const readWidgetPage = async (read: WidgetRead, { page, perPage }: { page?: number; perPage?: number }, signal: AbortSignal): Promise<Widget> => {
  const requestUrl = new URL(read.url)
  if (typeof page === 'number') {
    requestUrl.searchParams.set('page', page.toString())
  }
  if (typeof perPage === 'number') {
    requestUrl.searchParams.set('perPage', perPage.toString())
  }
  if (read.extrasParam && !read.extrasInBody) {
    requestUrl.searchParams.set('extras', read.extrasParam)
  }

  const res = read.extrasInBody
    ? await readWithBodyExtras(read.transport.fetch, requestUrl, read.extrasParam, signal)
    : await read.transport.fetch(requestUrl.toString(), { signal })

  if (!res.ok) {
    // ONE read of the body, shared by the 401 classification and the thrown detail.
    const { body, detail } = await readErrorBody(res)
    if (res.status === 401) {
      // The transport decides what a 401 means. Signed in: an expired/invalid token, so the
      // IN-PLACE session-resume modal (components/SessionResume), with the cause snowplow named
      // in the body (snowplow#1029) — concurrent 401s coalesce into one resume, and a successful
      // re-auth invalidates every query so this widget refetches with the fresh token.
      // Anonymous: public serving is off on this install, which the public page reports once for
      // the whole page — never a sign-in prompt, and never a redirect.
      read.transport.onUnauthorized(body)
    }
    throw new WidgetFetchError(`Widget fetch failed: ${res.status} ${res.statusText}`, res.status, detail)
  }

  // Capture the live-refresh coordination headers from THIS response (so coords + key always match
  // the request that produced them). No-op / cleared when the headers are absent (cache-off,
  // RBAC-skipped, or a snowplow without the class header). `requestUrl.searchParams` already carries
  // the page/perPage/extras used.
  if (read.refreshWidgetId) {
    recordRefreshHeaders(read.refreshWidgetId, requestUrl.searchParams, res.headers)
  }

  return (await res.json()) as Widget
}

/**
 * One page of a widget: the fetch every widget query (and every prefetch of one) makes. `signal` is
 * react-query's, so leaving the page still cancels the read; the deadline is added here.
 */
export const fetchWidgetPage = (
  read: WidgetRead,
  params: { page?: number; perPage?: number },
  signal?: AbortSignal,
  deadlineMs: number = WIDGET_READ_DEADLINE_MS,
): Promise<Widget> => withDeadline((combined) => readWidgetPage(read, params, combined), signal, deadlineMs)
