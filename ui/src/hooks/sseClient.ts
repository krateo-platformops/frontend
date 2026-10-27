import { getAccessToken, onAccessTokenInvalidated } from '../utils/getAccessToken'
import { raiseSessionExpired } from '../utils/sessionResume'

import { reconnectDelayMs } from './sseBackoff'
import { drainSseEvents, parseSseBlock } from './sseFrames'

/**
 * Shared, ref-counted Server-Sent-Events client.
 *
 * Every subscriber to the same `url` shares ONE connection instead of each opening its
 * own (the portal otherwise holds a socket per List / Notifications / in-flight action,
 * all pointed at the same `/notifications` endpoint). The connection opens on the first
 * subscriber and closes when the last one leaves; messages are routed to subscribers by
 * SSE event `topic`, and connection open/error are fanned out to every subscriber on
 * that connection.
 *
 * This is the data-transport seam — decoupled from React. Hooks wrap it
 * (useSseStream, useGetEvents, useLiveRefresh); unmount → call the returned unsubscribe.
 *
 * ── Why fetch-SSE + Bearer, not native EventSource ──────────────────────────────────
 * `EventSource` cannot set request headers, so a caller that needed to authenticate had
 * to put the token in the URL as `?access_token=` — which sse-proxy accepts on
 * `/notifications` as its documented EventSource fallback. A token in a URL lands in
 * every access log and span along the path, and it did: installer#395. So this reads the
 * stream with `fetch` + `Authorization: Bearer` instead, exactly as `refreshSse.ts` does
 * for snowplow's `/refreshes` and for the same reason.
 *
 * `url` is therefore the ENDPOINT ALONE and must carry no credential. Two consequences,
 * both deliberate:
 *
 *  - The connection map keys on a token-free url, so subscribers to one endpoint share
 *    one connection even across a token refresh. Previously the token was part of the
 *    key, so a refresh silently forked a second connection to the same endpoint —
 *    defeating the ref-counting this module exists for.
 *  - The token is read HERE, per connection attempt, not passed in by the caller. A
 *    caller cannot hold a stale one, and cannot put it in a URL by construction.
 *
 * fetch-SSE has no built-in reconnect, so this module reconnects (#503). The policy is
 * `sseBackoff`'s, shared with `refreshSse` so the tab has one curve rather than two, and
 * the rule that matters is which failures earn a retry at all:
 *
 *  - a server close or a transport fault RETRIES, on jittered capped backoff. This is the
 *    case that was dead: an sse-proxy roll ends every stream, and nothing re-subscribed,
 *    so every open tab's bell stopped until the user reloaded the page — `NotificationsContext`
 *    is mounted once at the shell level, deliberately, so even navigating did not revive it;
 *  - a 401/403 NEVER retries. Re-presenting a dead token on a timer is what produced 553
 *    gateway rejections in one window; it raises the in-place session-resume instead, and
 *    reopens only once the session is actually back;
 *  - a stream the caller tore down, or one a reopen superseded, retries nothing at all.
 *
 * A reconnect loses frames: the server keeps no replay and sends no ids, so whatever was
 * published while the stream was down is simply gone. Subscribers are told which opens are
 * REOPENS (`onOpen({ reopened })`) so they can refetch their baseline instead of carrying a
 * hole — the same reasoning as `refreshSse`'s `revalidateOnConnect`.
 */
export interface SseSubscriber {
  /** Called with the raw `event.data` string for each message on the subscribed topic. */
  onMessage: (data: string) => void
  /**
   * Connection opened. `reopened` is false for this connection's FIRST open and true for
   * every one after it — a reconnect or a credential reopen. Frames published while the
   * stream was down are gone (no replay, no ids), so a subscriber that keeps a list should
   * refetch its baseline when `reopened` is true, and must not refetch when it is false:
   * the caller has just loaded that baseline itself.
   */
  onOpen?: (info: { reopened: boolean }) => void
  /**
   * Connection failed. Fired on every failed attempt, including the ones a retry follows, so
   * a subscriber can show "disconnected" without having to know the retry policy. The
   * connection is torn down only when nothing will retry it: an auth failure the user did
   * not resume, or the last subscriber leaving.
   */
  onError?: () => void
}

interface SseConnection {
  /** Aborts the in-flight fetch and ends its read loop. Replaced by `reopenAll` and by a retry. */
  controller: AbortController
  /** topic → subscribers listening on that topic (for message routing). */
  byTopic: Map<string, Set<SseSubscriber>>
  /** all subscribers on this connection (for open/error fan-out + ref counting). */
  all: Set<SseSubscriber>
  /**
   * Consecutive failed attempts, which picks the backoff step. RESET on every successful
   * open: without that, a connection that drops once an hour climbs to the 30 s ceiling over
   * a day and stays there, so the slowest reconnects would be the ones on the healthiest
   * endpoints.
   */
  attempt: number
  /** The pending retry, so a teardown or a reopen can cancel it instead of racing it. */
  retryTimer: ReturnType<typeof setTimeout> | undefined
  /** Has any stream on this connection opened? Decides `onOpen`'s `reopened`. */
  opened: boolean
}

const connections = new Map<string, SseConnection>()

const clearRetry = (connection: SseConnection) => {
  if (connection.retryTimer !== undefined) {
    clearTimeout(connection.retryTimer)
    connection.retryTimer = undefined
  }
}

const teardown = (url: string, connection: SseConnection) => {
  connection.controller.abort()
  clearRetry(connection)
  if (connections.get(url) === connection) {
    connections.delete(url)
  }
}

/** Tell every subscriber the stream is down. Says nothing about whether it will come back. */
const announceError = (connection: SseConnection) => {
  connection.all.forEach((sub) => sub.onError?.())
}

/**
 * Fan an error out to every subscriber and drop the connection — the terminal failure, for
 * what no retry can fix. A later `subscribeSse` opens a fresh connection.
 */
const fail = (url: string, connection: SseConnection) => {
  // Already replaced or torn down — the error belongs to a dead connection.
  if (connections.get(url) !== connection) { return }
  announceError(connection)
  teardown(url, connection)
}

/**
 * Reopen the connection: abort whatever stream it has and start a new one on a FRESH
 * controller, which is what makes the old stream's tail recognise itself as superseded.
 * The single place that does this, so `reopenAll`, the retry timer and the post-resume
 * reopen cannot each get it subtly different.
 */
const reopen = (url: string, connection: SseConnection) => {
  connection.controller.abort()
  connection.controller = new AbortController()
  const { controller } = connection
  // The read loop ends by asking the retry policy what to do, and the retry policy reopens by
  // starting a read loop: genuinely mutual, so one of the two references has to point forward.
  // eslint-disable-next-line @typescript-eslint/no-use-before-define -- mutual recursion: stream -> scheduleRetry -> reopen -> stream
  queueMicrotask(() => { void stream(url, connection, controller) })
}

/**
 * Schedule a reconnect for a stream that dropped, or give up if nothing is listening.
 *
 * Only the connection's CURRENT stream may schedule one: a superseded stream reaching its
 * tail must not queue a retry for the stream that replaced it. One timer at a time, for the
 * same reason.
 */
const scheduleRetry = (url: string, connection: SseConnection, controller: AbortController) => {
  if (connections.get(url) !== connection || connection.controller !== controller) { return }
  announceError(connection)
  // Nobody is listening any more: a retry would hold an endpoint open for no subscriber.
  if (connection.all.size === 0) {
    teardown(url, connection)
    return
  }
  if (connection.retryTimer !== undefined) { return }
  const delay = reconnectDelayMs(connection.attempt)
  connection.attempt += 1
  connection.retryTimer = setTimeout(() => {
    connection.retryTimer = undefined
    // Torn down while the timer was pending, or the last subscriber left.
    if (connections.get(url) !== connection || connection.all.size === 0) { return }
    reopen(url, connection)
  }, delay)
}

/**
 * Is this stream still the connection's live one?
 *
 * A reopen replaces `connection.controller` and starts a new `stream` over the SAME
 * connection object and subscribers, so the old stream wakes up (its read rejects on
 * abort) and reaches its teardown tail. Comparing the controller it was started with
 * against the connection's current one is what stops it killing its own replacement —
 * the same guard `refreshSse.scheduleRetry` uses for the same reason.
 */
const isCurrent = (connection: SseConnection, controller: AbortController): boolean =>
  connection.controller === controller && !controller.signal.aborted

/**
 * Open the stream and pump frames into the connection's subscribers until it ends,
 * errors, or is aborted. Resolves when the stream is done; never rejects.
 */
async function stream(url: string, connection: SseConnection, controller: AbortController): Promise<void> {
  let token: string
  try {
    token = getAccessToken()
  } catch {
    // No session (logged out, or K_user cleared). Same observable outcome as the 401 the
    // server would have answered, without opening a request to collect it.
    console.error('[SSE] No access token; not opening the stream')
    if (!isCurrent(connection, controller)) { return }
    // Terminal, not retriable: there is no session, so every attempt would fail identically.
    // The logout/resume flow invalidates the token cache, and that reopens every connection.
    fail(url, connection)
    return
  }

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
  } catch {
    // Aborted by teardown or by a reopen, or a transport fault. An abort is ours — and the
    // isCurrent guard is what tells the two apart, because an abort we caused always came
    // with a controller swap or a teardown.
    if (!isCurrent(connection, controller)) { return }
    scheduleRetry(url, connection, controller)
    return
  }

  // Superseded while this fetch was in flight: say nothing and touch nothing. This path is
  // the one that matters most, and it is reachable by the very case the reopen exists for —
  // a stale token 401s, that raises the resume, the resume invalidates and reopens, and THEN
  // the old 401 lands. `fail` would not catch it: its own guard compares the connection,
  // which a reopen deliberately does not replace, only its controller.
  if (!isCurrent(connection, controller)) { return }

  if (!response.ok || !response.body) {
    // Worth the status: the old EventSource path could only ever say "something failed",
    // which made an expired token and an unreachable proxy look identical in the console.
    console.error(`[SSE] Connection error: ${response.status} ${response.statusText}`)
    if (response.status === 401 || response.status === 403) {
      // #503 F2. An expired or refused credential is not a transport fault, and treating it
      // as one is the 553-rejection defect: every attempt re-presents the SAME dead token and
      // backs off to the ceiling forever. Raise the in-place resume instead — the same call
      // useWidgetQuery makes, and concurrent raises coalesce into one modal.
      //
      // And REOPEN EXPLICITLY on success. A resumed session invalidates the token cache, which
      // already reopens every connection through `reopenAll`, so this reopen is usually the
      // second one — harmless, because `reopen` swaps the controller and the identity guard
      // leaves the superseded stream silent. It is here because relying on the OTHER path to
      // do it is how refreshSse turned "loops forever and never works" into "stops looping and
      // never works": quieter, equally dead. One of the two reopens is redundant; neither is
      // safe to omit, and the guard is what makes the redundancy free.
      announceError(connection)
      void raiseSessionExpired().then(
        (outcome) => {
          if (connections.get(url) !== connection) { return }
          if (outcome === 'resumed') {
            connection.attempt = 0
            reopen(url, connection)
          } else {
            teardown(url, connection)
          }
        },
        () => { if (connections.get(url) === connection) { teardown(url, connection) } },
      )
      return
    }
    scheduleRetry(url, connection, controller)
    return
  }

  // Opened: the backoff budget is spent, so clear it (see SseConnection.attempt).
  connection.attempt = 0
  clearRetry(connection)
  const reopened = connection.opened
  connection.opened = true
  connection.all.forEach((sub) => sub.onOpen?.({ reopened }))

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- sequential stream reads are inherent to SSE
      const { done, value } = await reader.read()
      if (done) { break }
      // Replaced mid-flight: deliver nothing further. `byTopic` is shared with the stream
      // that replaced us, so one late frame here would arrive as if it were the new one's.
      if (!isCurrent(connection, controller)) { return }
      buffer += decoder.decode(value, { stream: true })
      const { events, rest } = drainSseEvents(buffer)
      buffer = rest
      events.forEach((block) => {
        const { data, event } = parseSseBlock(block)
        if (event === undefined || data === undefined) { return }
        connection.byTopic.get(event)?.forEach((sub) => {
          // Each delivery is isolated. This fan-out runs inside the read loop's try, so an
          // exception from ONE subscriber would otherwise break the loop and tear down the
          // connection that every OTHER subscriber on this endpoint is sharing — the bell
          // going dead because an unrelated widget's handler threw. Native EventSource gave
          // this for free (the browser contains a listener's exception), and routing a second
          // consumer through this client is what made it reachable.
          try {
            sub.onMessage(data)
          } catch (error) {
            console.error('[SSE] subscriber threw while handling a message; the stream is unaffected:', error)
          }
        })
      })
    }
  } catch { /* aborted or transport error — fall through to the same teardown */ }

  // The stream ended: server idle-close, network drop, our own teardown, or a reopen that
  // replaced this stream. Only the first two are errors the subscribers should hear about —
  // and a superseded stream must stay silent, or it tears down the one that replaced it.
  //
  // THIS is the sse-proxy roll: a pod shutdown ends every stream here, with `done` from the
  // reader and no error at all. It used to fall into `fail`, which deleted the connection and
  // left the bell dead until a page reload.
  if (!isCurrent(connection, controller)) { return }
  scheduleRetry(url, connection, controller)
}

/**
 * Re-open every live stream with the CURRENT credential.
 *
 * Registered against `onAccessTokenInvalidated`, which the in-place session-resume flow
 * (and Auth) already call. Without this a stream opened before the resume keeps serving
 * the PREVIOUS user's identity on the server for as long as it stays open, and because
 * `connections` is keyed on the endpoint alone, a remount re-joins that same connection
 * instead of opening a fresh one. #501 removed the accident that used to cover this: the
 * token was part of the url, so a credential change changed the key.
 *
 * It re-opens rather than merely tearing down, deliberately. A bare teardown would fix the
 * identity and leave the bell dead until something remounted it — trading a security bug
 * for a silent functional one. This is NOT the general reconnect policy (frontend#503):
 * there is no timer, no backoff and no retry. One attempt, driven by a credential change we
 * were told about, which is why it cannot loop. If that attempt fails, `stream` fails the
 * connection exactly as it would have anyway.
 */
const reopenAll = (): void => {
  connections.forEach((connection, url) => {
    // A credential change supersedes a pending retry: that retry would open with the token
    // this reopen exists to replace, and two opens would race for the same connection.
    clearRetry(connection)
    connection.attempt = 0
    reopen(url, connection)
  })
}

/**
 * Arm `reopenAll` against the next credential change, once.
 *
 * Deliberately NOT at module scope. Importing a module must not register a global listener:
 * a suite that partially mocks `getAccessToken` — a common thing to do, and nothing to do
 * with SSE — then fails to COLLECT, with an error pointing at this file rather than at
 * itself. Three suites ran zero tests that way for a day (frontend#505).
 *
 * Arming it on first subscription is equivalent, not a compromise: `reopenAll` over zero
 * connections is a no-op, so the only invalidations it can miss are the ones with nothing to
 * reopen — and the first stream opened after one reads the current token anyway.
 */
let credentialWatchArmed = false
const armCredentialWatch = (): void => {
  if (credentialWatchArmed) { return }
  credentialWatchArmed = true
  onAccessTokenInvalidated(reopenAll)
}

/**
 * Subscribe to `topic` on the SSE stream at `url`, which must be the endpoint alone —
 * no `?access_token=`; this client authenticates with a Bearer header. Returns an
 * idempotent unsubscribe; when the last subscriber for a `url` unsubscribes, its
 * connection is closed.
 */
export const subscribeSse = (url: string, topic: string, subscriber: SseSubscriber): () => void => {
  armCredentialWatch()
  let connection = connections.get(url)

  if (!connection) {
    const conn: SseConnection = { all: new Set(), attempt: 0, byTopic: new Map(), controller: new AbortController(), opened: false, retryTimer: undefined }
    connections.set(url, conn)
    connection = conn
    // Subscribe first, open after: the caller's subscriber must be in `all` before the
    // stream can fan `onOpen`/`onError` at it. `stream` never rejects.
    //
    // Capture the controller HERE, not inside the microtask. Reading `conn.controller` when
    // the microtask runs means an invalidation in this same tick has already replaced it, so
    // this open and the reopen's both start on the identical controller — two live streams,
    // both passing `isCurrent`, every frame delivered twice. Same capture reopenAll does.
    const { controller } = conn
    queueMicrotask(() => { void stream(url, conn, controller) })
  }

  const conn = connection

  let topicSubscribers = conn.byTopic.get(topic)
  if (!topicSubscribers) {
    topicSubscribers = new Set()
    conn.byTopic.set(topic, topicSubscribers)
  }

  topicSubscribers.add(subscriber)
  conn.all.add(subscriber)

  let active = true
  return () => {
    if (!active) { return }
    active = false
    conn.byTopic.get(topic)?.delete(subscriber)
    conn.all.delete(subscriber)
    if (conn.all.size === 0) {
      teardown(url, conn)
    }
  }
}

/** Test-only: abort + drop all connections. */
export const __resetSseConnections = (): void => {
  connections.forEach((connection) => {
    connection.controller.abort()
    clearRetry(connection)
  })
  connections.clear()
}
