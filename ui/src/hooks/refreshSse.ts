/* eslint-disable sort-keys/sort-keys-fix */
/* Coordinate/object key order mirrors the snowplow protocol doc, not alphabetical. */

/**
 * Per-widget live-refresh over snowplow's `/refreshes` SSE stream.
 *
 * Snowplow's live-refresh-coherence layer (1.5.x, default-ON when the cache is
 * on) pushes a one-line *signal* — never data — when a cluster object behind a
 * widget changes: `event: refresh\ndata: <l1Key>`. The browser matches that key
 * to the widget(s) it rendered and re-issues the widget's normal `GET /call`,
 * which is a warm cache HIT carrying fresh, RBAC-correct content. This replaces
 * polling and the coarse k8s-event firehose (`useLiveWatch`) with a precise,
 * per-widget push.
 *
 * ── Why fetch-SSE + Bearer (not native EventSource) ──────────────────────────
 * The protocol doc's reference impl uses `new EventSource(url, {withCredentials:
 * true})` and a `krateo-session` cookie, because an `EventSource` cannot set the
 * `Authorization` header. The portal authenticates every snowplow call with a
 * Bearer token (`getAccessToken()`, see useWidgetQuery's `/call` fetch), NOT a
 * session cookie — so we take the doc's explicitly-sanctioned alternative
 * ("Non-browser clients … may instead send `Authorization: Bearer <jwt>`") and
 * stream via `fetch` + `ReadableStream`, mirroring the Autopilot transport
 * (components/Autopilot/transport.ts). Trade-off vs EventSource: fetch-SSE has no
 * built-in auto-reconnect, so we reconnect with capped backoff ourselves.
 *
 * ── Forgery-proof arming ─────────────────────────────────────────────────────
 * You DON'T subscribe by key (you can't forge another user's key). You send
 * *coordinates* (GVR + ns + name + page/extras + the class snowplow keyed the
 * response under) and snowplow re-derives the key under YOUR authenticated
 * identity. The class comes verbatim from the `X-Snowplow-Refresh-Class` response
 * header (widgets | widgetContent | restactions) — never guessed. You match
 * incoming events by the `X-Snowplow-Refresh-Key` response header. Both resolve
 * to the same `l1Key`.
 *
 * Gated behind a config feature flag that is **ON by default**
 * (`WIDGET_LIVE_REFRESH_ENABLED !== false`, see isWidgetLiveRefreshEnabled below):
 * an install opts OUT, it does not opt in. A snowplow that predates the
 * `X-Snowplow-Refresh-Class` header (commit a945763) simply never stamps the
 * headers, so nothing arms and the stream idles harmlessly — but on every current
 * install this path IS live, which is why the delivery defects it used to carry
 * were live too. (This comment said "default OFF" until #256; it was stale against
 * the flag's own doc and made the blast radius look smaller than it is.)
 *
 * ── Delivery hardening (#256, snowplow 1.12.6 item 7) ────────────────────────
 * Snowplow now publishes a paced `refresh` frame on DELETE-semantics eviction, so
 * the browser half has to hold up its end. Four things follow, and they are all in
 * this file: a frame arriving inside the throttle window is DEFERRED rather than
 * dropped (the last change used to be lost); every refetch — event-driven or
 * re-validation — passes through ONE bounded queue, so no trigger can burst the
 * tab; a 401 re-authenticates instead of retrying to the 30 s ceiling forever; and
 * a reconnect re-validates the armed set, because frames published while we were
 * disconnected are gone (snowplow deliberately offers no replay).
 */

import type { Config } from '../context/ConfigContext'
import { getAccessToken } from '../utils/getAccessToken'
import { raiseSessionExpired } from '../utils/sessionResume'

// ────────────────────────────────────────────────────────────────────────────
// Protocol types
// ────────────────────────────────────────────────────────────────────────────

/** The class snowplow keyed a `/call` response under (the `X-Snowplow-Refresh-Class` header). */
export type RefreshClass = 'widgets' | 'widgetContent' | 'restactions'

/** One widget's subscription coordinates — must match its `/call` exactly so the
 * derived key equals the key the event will carry. */
export interface RefreshCoords {
  class: RefreshClass
  group: string
  version: string
  resource: string
  namespace: string
  name: string
  page?: number
  perPage?: number
  extras?: Record<string, unknown>
}

export const REFRESH_HEADER_KEY = 'X-Snowplow-Refresh-Key'
export const REFRESH_HEADER_CLASS = 'X-Snowplow-Refresh-Class'

/** ≤512 widgets per connection, ≤16 KB decoded `sub` (snowplow returns 400 above either). */
const MAX_WIDGETS = 512
const MAX_SUB_BYTES = 16 * 1024
/** Per-widget refetch throttle: a `refresh` means "data changed, refetch when convenient". */
const REFRESH_THROTTLE_MS = 5000
/** Coalesce the burst of arm/disarm calls a page navigation produces into one reconnect. */
const RECONNECT_DEBOUNCE_MS = 200
/** Capped exponential backoff between fetch-SSE reconnect attempts. */
const RECONNECT_BACKOFF_BASE_MS = 1000
const RECONNECT_BACKOFF_MAX_MS = 30000
/**
 * ±25 % jitter on that backoff. Without it a fleet of tabs that lost the stream
 * together — a snowplow rollout, a gateway blip — retries in lockstep forever,
 * turning one outage into a synchronised thundering herd on every subsequent
 * attempt. (Design §10 decision 4.)
 */
const RECONNECT_BACKOFF_JITTER = 0.25
/**
 * Global cap on concurrent widget refetches for the whole tab. The browser gives
 * none worth relying on: the transport is HTTP/2, which removes the old ~6
 * connections-per-host limit, so an eviction burst or a reconnect re-validation on
 * a dense page would otherwise fire as many parallel `/call`s as there are armed
 * widgets. (Design §10 decision 2.)
 */
const MAX_INFLIGHT_REFETCH = 6
/**
 * Window over which a reconnect's re-validation is spread. The cap above bounds
 * concurrency; this bounds the ARRIVAL RATE, so a fleet reconnecting together does
 * not deliver its whole re-validation in one instant. (Design §10 decision 4.)
 */
const REVALIDATE_SPREAD_MS = 10000

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for unit testing)
// ────────────────────────────────────────────────────────────────────────────

/** UTF-8-safe base64url (extras may carry a Unicode displayName, which `btoa` alone rejects). */
export const base64UrlEncode = (input: string): string => {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Pull complete SSE event blocks out of a rolling buffer, returning [events, remainder]. */
export const drainSseEvents = (buffer: string): { events: string[]; rest: string } => {
  const events: string[] = []
  let rest = buffer
  let boundary = rest.indexOf('\n\n')
  while (boundary !== -1) {
    events.push(rest.slice(0, boundary))
    rest = rest.slice(boundary + 2)
    boundary = rest.indexOf('\n\n')
  }
  return { events, rest }
}

/**
 * Parse one SSE event block into its `event:` name and joined `data:` payload.
 * Comment lines (`:` prefix, e.g. `: keepalive`) and unknown fields are ignored.
 */
export const parseSseBlock = (block: string): { event?: string; data?: string } => {
  let event: string | undefined
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':') || line.length === 0) { continue }
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
  }
  return { event, data: dataLines.length ? dataLines.join('\n') : undefined }
}

const parseNumber = (raw: string | null): number | undefined => {
  if (raw === null) { return undefined }
  const parsed = parseInt(raw, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * Build a widget's subscription coordinates from the `/call` query params it was
 * fetched with (`apiVersion=<group>/<version>`, `resource`, `name`, `namespace`,
 * `page`, `perPage`, `extras`). Returns null when the params can't form a valid
 * coordinate (so the widget simply isn't armed). `cls` is the verbatim
 * `X-Snowplow-Refresh-Class`.
 */
export const buildRefreshCoords = (params: URLSearchParams, cls: RefreshClass): RefreshCoords | null => {
  const apiVersion = params.get('apiVersion') ?? ''
  const resource = params.get('resource') ?? ''
  const name = params.get('name') ?? ''
  const namespace = params.get('namespace') ?? ''
  if (!apiVersion || !resource || !name) { return null }

  const slash = apiVersion.lastIndexOf('/')
  const group = slash >= 0 ? apiVersion.slice(0, slash) : ''
  const version = slash >= 0 ? apiVersion.slice(slash + 1) : apiVersion

  const coords: RefreshCoords = { class: cls, group, version, resource, namespace, name }

  const page = parseNumber(params.get('page'))
  if (page !== undefined) { coords.page = page }
  const perPage = parseNumber(params.get('perPage'))
  if (perPage !== undefined) { coords.perPage = perPage }

  const extrasRaw = params.get('extras')
  if (extrasRaw) {
    try { coords.extras = JSON.parse(extrasRaw) as Record<string, unknown> } catch { /* leave unset */ }
  }
  return coords
}

/**
 * Whether per-widget live-refresh is enabled. **ON by default** — every widget rendered via
 * WidgetRenderer (the single universal widget path) arms the tab's `/refreshes` stream.
 * Verified delivering end-to-end on snowplow ≥1.5.13; an older snowplow / cache-off / RBAC-skip
 * degrades to a harmless idle stream (keepalives only, zero events). An install opts OUT by
 * setting `config.api.WIDGET_LIVE_REFRESH_ENABLED: false`. Off until config loads (the arm hook
 * also no-ops without a base URL).
 */
export const isWidgetLiveRefreshEnabled = (config: Config | undefined): boolean => {
  if (!config) { return false }
  return config.api.WIDGET_LIVE_REFRESH_ENABLED !== false
}

// ────────────────────────────────────────────────────────────────────────────
// Header capture (written by useWidgetQuery's /call fetch, read by the arm hook)
// ────────────────────────────────────────────────────────────────────────────

/** A captured arm-target: the coords to subscribe with + the key events arrive under. */
export interface RefreshEntry {
  coords: RefreshCoords
  key: string
}

/**
 * widgetId (the serialized react-query key) → its latest RefreshEntry. Written
 * inside the widget's `/call` queryFn the moment the response resolves (so its
 * coords + key always match THAT response), read by the arm hook on the
 * re-render that the resolved query triggers. The stored object is replaced only
 * when the captured key changes, so the arm hook's `entry.key` effect-dep stays
 * referentially stable between identical fetches and doesn't churn the stream.
 */
const refreshEntries = new Map<string, RefreshEntry>()

/**
 * Record (or clear) a widget's refresh entry from a `/call` response.
 * `headers` is the `Response.headers`; absent class/key (cache-off, RBAC-skipped,
 * identity-less, or a pre-a945763 snowplow) → the entry is cleared (nothing to arm).
 */
export const recordRefreshHeaders = (widgetId: string, params: URLSearchParams, headers: Headers): void => {
  const cls = headers.get(REFRESH_HEADER_CLASS)
  const key = headers.get(REFRESH_HEADER_KEY)
  if (!cls || !key || (cls !== 'widgets' && cls !== 'widgetContent' && cls !== 'restactions')) {
    refreshEntries.delete(widgetId)
    return
  }
  const coords = buildRefreshCoords(params, cls)
  if (!coords) {
    refreshEntries.delete(widgetId)
    return
  }
  const prev = refreshEntries.get(widgetId)
  // Keep the same object reference when nothing changed, so the arm hook's
  // `entry.key` dependency doesn't re-fire on an identical refetch.
  if (prev && prev.key === key && JSON.stringify(prev.coords) === JSON.stringify(coords)) { return }
  refreshEntries.set(widgetId, { coords, key })
}

export const getRefreshEntry = (widgetId: string): RefreshEntry | undefined => refreshEntries.get(widgetId)

/** Test-only: drop all captured entries. */
export const __resetRefreshEntries = (): void => { refreshEntries.clear() }

// ────────────────────────────────────────────────────────────────────────────
// RefreshManager — one multiplexed /refreshes stream per tab
// ────────────────────────────────────────────────────────────────────────────

type Refetch = () => unknown

/**
 * Holds the set of armed widgets, opens ONE fetch-SSE `/refreshes` stream for the
 * whole tab (rebuilt, debounced, when the armed set changes), and on each
 * `refresh` event refetches the matching widget(s) — throttled per widget.
 *
 * Exported (not just the singleton) so tests can drive a fresh instance with an
 * injected clock and feed refresh keys directly via `dispatchRefresh`.
 */
export class RefreshManager {
  private readonly armed = new Map<string, RefreshCoords>()
  private readonly keyToWidgets = new Map<string, Set<string>>()
  private readonly refetchById = new Map<string, Refetch>()
  /**
   * Per-widget throttle window. `timer` runs for REFRESH_THROTTLE_MS after a leading-edge
   * refetch; `pending` records that at least one frame arrived inside it. Replaces the old
   * `lastRefetch` timestamp, which could only DROP a frame in the window — see scheduleRefetch.
   */
  private readonly throttle = new Map<string, { pending: boolean; timer: ReturnType<typeof setTimeout> | undefined }>()
  /** FIFO of widgetIds waiting for a refetch slot, and the number currently in flight. */
  private readonly queue: string[] = []
  private inFlight = 0
  /** Widgets whose CURRENT refetch was triggered by a `refresh` frame — see wasRefetchEventTriggered. */
  private readonly eventTriggered = new Set<string>()
  /** Timers for a reconnect's staggered re-validation, so reset()/a newer reconnect can cancel them. */
  private revalidateTimers: ReturnType<typeof setTimeout>[] = []
  private baseUrl = ''
  private controller: AbortController | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private retryAttempt = 0
  /**
   * Set ONLY by scheduleRetry — i.e. by a real transport loss or a server idle-close — and
   * consumed by the next successful connect.
   *
   * NOT set by scheduleReconnect. That path fires on every arm/disarm, and arm/disarm abort and
   * re-open the stream on every widget mount, so re-validating there would burst the armed set on
   * every page navigation: the exact amplification this work exists to remove, triggered by
   * routine use instead of by a fault. The distinction is cause, not "is this the first connect".
   */
  private revalidateOnConnect = false
  /** One truncation warning per stream open, not one per armed widget. */
  private warnedTruncation = false

  /** Point the manager at the snowplow base URL (idempotent; set on first arm). */
  configure(baseUrl: string): void { this.baseUrl = baseUrl }

  /**
   * Arm a widget: subscribe with its `coords`, route events carrying `refreshKey`
   * to `refetch`. Returns a disarm fn (call on unmount). Re-arming the same
   * widgetId replaces its coords/key.
   */
  arm(widgetId: string, coords: RefreshCoords, refreshKey: string, refetch: Refetch): () => void {
    this.removeFromKeyIndex(widgetId)
    this.armed.set(widgetId, coords)
    this.refetchById.set(widgetId, refetch)
    let set = this.keyToWidgets.get(refreshKey)
    if (!set) {
      set = new Set()
      this.keyToWidgets.set(refreshKey, set)
    }
    set.add(widgetId)
    this.scheduleReconnect()
    return () => this.disarm(widgetId)
  }

  private disarm(widgetId: string): void {
    this.armed.delete(widgetId)
    this.refetchById.delete(widgetId)
    this.clearThrottle(widgetId)
    this.eventTriggered.delete(widgetId)
    // A queued refetch for an unmounted widget must not run: pump() re-checks refetchById, but
    // dropping it here keeps the queue from growing with dead ids on a page that churns widgets.
    const queued = this.queue.indexOf(widgetId)
    if (queued !== -1) { this.queue.splice(queued, 1) }
    this.removeFromKeyIndex(widgetId)
    this.scheduleReconnect()
  }

  private clearThrottle(widgetId: string): void {
    const state = this.throttle.get(widgetId)
    if (state?.timer) { clearTimeout(state.timer) }
    this.throttle.delete(widgetId)
  }

  /**
   * Whether `widgetId` is currently armed on the `/refreshes` stream — i.e. it has
   * a live subscription (coords) that the tab's stream is (or will be) carrying.
   * Read-only view over the armed set; the FreshnessBadge's `liveArmed` prop reads
   * this to show the honest "Live" dot only once a push channel is actually open,
   * not merely that the last fetch succeeded.
   */
  isArmed(widgetId: string): boolean {
    return this.armed.has(widgetId)
  }

  private removeFromKeyIndex(widgetId: string): void {
    this.keyToWidgets.forEach((set, key) => {
      if (set.delete(widgetId) && set.size === 0) { this.keyToWidgets.delete(key) }
    })
  }

  /** Look up the widget(s) for an `l1Key` and refetch each, coalesced per widget. */
  dispatchRefresh(l1Key: string): void {
    const widgets = this.keyToWidgets.get(l1Key)
    if (!widgets) { return }
    widgets.forEach((widgetId) => { this.scheduleRefetch(widgetId, true) })
  }

  /**
   * Leading-edge refetch, then one TRAILING catch-up if more frames arrive inside the window.
   *
   * The previous shape compared a timestamp and RETURNED on a frame inside the window — the
   * change that frame announced was simply lost, and since snowplow offers no replay it was lost
   * permanently. That is the wrong trade for a signal that means "the data you are showing is
   * out of date": suppressing the REFETCH is right, suppressing the FACT is not. Same coalescing
   * shape as liveRefresh.ts:92-109 one file over, which had it right all along.
   *
   * `fromFrame` distinguishes an event-driven refetch from a reconnect re-validation; only the
   * former makes a 404 a confirmed delete (see wasRefetchEventTriggered).
   */
  private scheduleRefetch(widgetId: string, fromFrame: boolean): void {
    const state = this.throttle.get(widgetId)
    if (state?.timer) {
      state.pending = true
      return
    }
    this.enqueueRefetch(widgetId, fromFrame)
    const entry: { pending: boolean; timer: ReturnType<typeof setTimeout> | undefined } = { pending: false, timer: undefined }
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      this.throttle.delete(widgetId)
      // Re-enter rather than refetching inline: the trailing catch-up opens its own window, so a
      // continuously-changing object settles at one refetch per window instead of two per window.
      if (entry.pending) { this.scheduleRefetch(widgetId, fromFrame) }
    }, REFRESH_THROTTLE_MS)
    this.throttle.set(widgetId, entry)
  }

  /**
   * THE one place a refetch is started. Both triggers — a `refresh` frame and a reconnect
   * re-validation — go through this queue, so the MAX_INFLIGHT_REFETCH cap wraps them jointly.
   * Two separate caps would not bound the sum, and a stagger beside an unbounded queue only
   * spreads a burst rather than limiting it.
   */
  private enqueueRefetch(widgetId: string, fromFrame: boolean): void {
    if (fromFrame) { this.eventTriggered.add(widgetId) }
    if (!this.queue.includes(widgetId)) { this.queue.push(widgetId) }
    this.pump()
  }

  private pump(): void {
    while (this.inFlight < MAX_INFLIGHT_REFETCH && this.queue.length > 0) {
      const widgetId = this.queue.shift()
      if (widgetId === undefined) { return }
      const refetch = this.refetchById.get(widgetId)
      if (!refetch) {
        // Disarmed while queued — drop it and take the next, without burning a slot.
        this.eventTriggered.delete(widgetId)
        continue
      }
      this.inFlight += 1
      // Refetch returns `unknown` (react-query hands back a promise; a test may hand back
      // nothing), so normalize before settling. A rejection is the query's business, not ours —
      // we only need the slot back.
      void Promise.resolve(refetch())
        .catch(() => undefined)
        .finally(() => {
          this.inFlight -= 1
          this.eventTriggered.delete(widgetId)
          this.pump()
        })
    }
  }

  /**
   * Whether `widgetId`'s in-flight refetch was triggered by a `refresh` frame.
   *
   * Read by the widget query's retry predicate, and deliberately the ONLY thing it needs to know
   * about this manager. A 404 is normally transient — a cold informer right after page load
   * answers 404 for a widget that does exist — so the query retries it. But a frame-triggered
   * refetch is answering an eviction snowplow just published, and there a 404 is a CONFIRMED
   * delete: retrying it three times costs four requests per widget and amplifies a bulk delete
   * fourfold, to reach the same answer.
   */
  isEventTriggered(widgetId: string): boolean {
    return this.eventTriggered.has(widgetId)
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer) }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect()
    }, RECONNECT_DEBOUNCE_MS)
  }

  /** Build `?sub=` from the armed coords (capped) and (re)open the single stream. */
  private connect(): void {
    this.controller?.abort()
    this.controller = undefined
    this.clearRetryTimer()
    this.warnedTruncation = false

    const coords = this.subCoords()
    if (coords.length === 0 || !this.baseUrl) { return }

    // No session → nothing to authorize; don't open a stream that would 401-loop.
    let token: string
    try {
      token = getAccessToken()
    } catch {
      return
    }
    if (!token) { return }

    const sub = base64UrlEncode(JSON.stringify(coords))
    const controller = new AbortController()
    this.controller = controller
    void this.stream(`${this.baseUrl}/refreshes?sub=${sub}`, token, controller)
  }

  /** The armed coords, capped to snowplow's limits (warning about what was dropped). */
  private subCoords(): RefreshCoords[] {
    let coords = [...this.armed.values()]
    if (coords.length > MAX_WIDGETS) {
      console.warn(`[live-refresh] ${coords.length} widgets armed > ${MAX_WIDGETS} cap; dropping ${coords.length - MAX_WIDGETS} from the subscription`)
      coords = coords.slice(0, MAX_WIDGETS)
    }
    // THE BYTE CAP BITES LONG BEFORE THE COUNT CAP, and it used to bite in silence. A coordinate
    // is ~170-330 B depending on extras, so 16 KiB holds roughly 49-86 of them — far under
    // MAX_WIDGETS=512. A page denser than that lost its TAIL widgets from the subscription with
    // no warning: they render, they look live, and they never refresh. Nobody could tell whether
    // this bound was being hit in the field, so say it out loud, with the count, once per stream
    // open (not once per widget). Raising the constant or shrinking the payload is a separate
    // change — this exists to find out whether either is needed.
    const armedCount = coords.length
    while (coords.length > 1 && JSON.stringify(coords).length > MAX_SUB_BYTES) {
      coords.pop()
    }
    if (coords.length < armedCount && !this.warnedTruncation) {
      this.warnedTruncation = true
      console.warn(`[live-refresh] subscription truncated by the ${MAX_SUB_BYTES}-byte cap: ${coords.length} of ${armedCount} armed widgets are subscribed; the remaining ${armedCount - coords.length} will render but never live-refresh`)
    }
    return coords
  }

  private async stream(url: string, token: string, controller: AbortController): Promise<void> {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
    } catch {
      this.scheduleRetry(controller)
      return
    }
    if (response.status === 401) {
      // An expired token is not a transport fault, and treating it as one is why the gateway saw
      // 553 edge rejections in a single window: every attempt re-presents the SAME dead token,
      // fails, and backs off to the 30 s ceiling — forever, with no path back to a live stream.
      // Raise the in-place session-resume modal instead (same call useWidgetQuery.ts:243-251
      // makes, and concurrent raises coalesce into one). Deliberately NO scheduleRetry: on a
      // successful re-auth the widgets re-arm and that re-opens the stream with a fresh token.
      void raiseSessionExpired()
      return
    }
    if (!response.ok || !response.body) {
      this.scheduleRetry(controller)
      return
    }
    // Connected cleanly — reset the reconnect backoff.
    this.retryAttempt = 0
    // Frames published while we were disconnected are GONE: the server keeps no replay and the
    // handler sends no ids, so nothing will re-deliver them. Re-validate what we had armed.
    if (this.revalidateOnConnect) {
      this.revalidateOnConnect = false
      this.revalidateArmed()
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        // eslint-disable-next-line no-await-in-loop -- sequential stream reads are inherent to SSE
        const { done, value } = await reader.read()
        if (done) { break }
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = drainSseEvents(buffer)
        buffer = rest
        events.forEach((block) => {
          const { data, event } = parseSseBlock(block)
          if (event === 'refresh' && data) { this.dispatchRefresh(data) }
        })
      }
    } catch { /* aborted or transport error — fall through to retry */ }
    // Stream closed (server idle-close / network). Reconnect unless we intentionally aborted.
    this.scheduleRetry(controller)
  }

  /**
   * Re-fetch every armed widget once, spread over W = min(30 s, N × 300 ms).
   *
   * The cap (MAX_INFLIGHT_REFETCH) bounds how many run AT ONCE; this bounds how fast they ARRIVE.
   * Both are needed and they are not substitutes: without the spread a fleet that reconnects
   * together delivers its whole re-validation in one instant, six-at-a-time per tab but all tabs
   * at the same instant. Jitter on the backoff alone is a sub-second window and does not
   * meaningfully de-phase that.
   *
   * These go through the SAME queue as frame-driven refetches, with fromFrame=false: a 404 during
   * re-validation is not evidence of a delete (we may simply have reconnected mid-rollout), so it
   * must stay retryable.
   */
  private revalidateArmed(): void {
    this.clearRevalidateTimers()
    const ids = [...this.armed.keys()]
    if (ids.length === 0) { return }
    const spread = Math.min(REVALIDATE_SPREAD_MS, ids.length * 300)
    const step = ids.length > 1 ? spread / (ids.length - 1) : 0
    ids.forEach((widgetId, index) => {
      this.revalidateTimers.push(setTimeout(() => { this.scheduleRefetch(widgetId, false) }, Math.round(step * index)))
    })
  }

  private clearRevalidateTimers(): void {
    this.revalidateTimers.forEach((timer) => { clearTimeout(timer) })
    this.revalidateTimers = []
  }

  private scheduleRetry(controller: AbortController): void {
    // Only the current, non-aborted stream may schedule a reconnect.
    if (controller.signal.aborted || this.controller !== controller) { return }
    if (this.retryTimer) { return }
    // A retry means the stream genuinely dropped (transport error or server idle-close), so the
    // next connect owes the armed set a re-validation. Set here, NOT in scheduleReconnect.
    this.revalidateOnConnect = true
    const base = Math.min(RECONNECT_BACKOFF_BASE_MS * 2 ** this.retryAttempt, RECONNECT_BACKOFF_MAX_MS)
    // ±25 % so a fleet that dropped together does not retry in lockstep.
    const delay = Math.round(base * (1 - RECONNECT_BACKOFF_JITTER + Math.random() * 2 * RECONNECT_BACKOFF_JITTER))
    this.retryAttempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      this.connect()
    }, delay)
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
  }

  /** Test-only: tear down timers + the stream and forget all state. */
  reset(): void {
    this.controller?.abort()
    this.controller = undefined
    this.clearReconnectTimer()
    this.clearRetryTimer()
    this.clearRevalidateTimers()
    this.throttle.forEach((state) => {
      if (state.timer) { clearTimeout(state.timer) }
    })
    this.throttle.clear()
    this.armed.clear()
    this.keyToWidgets.clear()
    this.refetchById.clear()
    this.eventTriggered.clear()
    this.queue.length = 0
    this.inFlight = 0
    this.retryAttempt = 0
    this.revalidateOnConnect = false
    this.warnedTruncation = false
  }
}

/** App-wide singleton: every widget arms against this one stream-per-tab. */
export const refreshManager = new RefreshManager()

/**
 * Whether the given widget currently has a live `/refreshes` subscription armed on
 * the tab-wide stream. A read-only check over the singleton's armed set — used by
 * WidgetRenderer to drive the FreshnessBadge's `liveArmed` prop so the green "Live"
 * dot only shows when a push channel is genuinely open for THAT widget (replacing
 * the render-local `isSuccess && !isStale` proxy). Off (false) whenever live-refresh
 * is disabled, the response wasn't cache-keyed, or the widget hasn't armed yet.
 */
export const isWidgetArmed = (widgetId: string): boolean => refreshManager.isArmed(widgetId)

/**
 * Whether this widget's in-flight refetch was triggered by a `refresh` frame rather than by a
 * mount, a re-validation or a user action.
 *
 * This is the whole contract between the refresh transport and the widget query's retry policy —
 * deliberately one boolean, so the retry predicate needs to know nothing about the manager's
 * internals and a test can assert the single-request-on-eviction behaviour against it directly.
 * See RefreshManager.isEventTriggered for why a 404 means different things on the two paths.
 */
export const wasRefetchEventTriggered = (widgetId: string): boolean => refreshManager.isEventTriggered(widgetId)
