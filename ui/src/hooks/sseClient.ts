import { getAccessToken } from '../utils/getAccessToken'

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
 * Trade-off vs EventSource: fetch-SSE has no built-in reconnect. Nothing is lost — the
 * previous implementation tore the connection down inside `onerror`, so it never
 * reconnected either; a later `subscribeSse` reopens. Deliberately NOT adding a retry
 * policy here: `refreshSse.ts` shows how much care one needs (401 must raise
 * session-resume rather than re-present a dead token forever), and that belongs in a
 * change of its own.
 */
export interface SseSubscriber {
  /** Called with the raw `event.data` string for each message on the subscribed topic. */
  onMessage: (data: string) => void
  /** Connection opened. */
  onOpen?: () => void
  /** Connection errored (the shared connection is then torn down; a later subscribe reopens). */
  onError?: () => void
}

interface SseConnection {
  /** Aborts the in-flight fetch and ends its read loop. */
  controller: AbortController
  /** topic → subscribers listening on that topic (for message routing). */
  byTopic: Map<string, Set<SseSubscriber>>
  /** all subscribers on this connection (for open/error fan-out + ref counting). */
  all: Set<SseSubscriber>
}

const connections = new Map<string, SseConnection>()

const teardown = (url: string, connection: SseConnection) => {
  connection.controller.abort()
  if (connections.get(url) === connection) {
    connections.delete(url)
  }
}

/** Fan an error out to every subscriber and drop the connection. */
const fail = (url: string, connection: SseConnection) => {
  // Already replaced or torn down — the error belongs to a dead connection.
  if (connections.get(url) !== connection) { return }
  connection.all.forEach((sub) => sub.onError?.())
  teardown(url, connection)
}

/**
 * Open the stream and pump frames into the connection's subscribers until it ends,
 * errors, or is aborted. Resolves when the stream is done; never rejects.
 */
const stream = async (url: string, connection: SseConnection): Promise<void> => {
  let token: string
  try {
    token = getAccessToken()
  } catch {
    // No session (logged out, or K_user cleared). Same observable outcome as the 401 the
    // server would have answered, without opening a request to collect it.
    console.error('[SSE] No access token; not opening the stream')
    fail(url, connection)
    return
  }

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
      signal: connection.controller.signal,
    })
  } catch {
    // Aborted by teardown, or a transport fault. An abort is ours and is not an error.
    if (!connection.controller.signal.aborted) { fail(url, connection) }
    return
  }

  if (!response.ok || !response.body) {
    // Worth the status: the old EventSource path could only ever say "something failed",
    // which made an expired token and an unreachable proxy look identical in the console.
    console.error(`[SSE] Connection error: ${response.status} ${response.statusText}`)
    fail(url, connection)
    return
  }

  connection.all.forEach((sub) => sub.onOpen?.())

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
        if (event === undefined || data === undefined) { return }
        connection.byTopic.get(event)?.forEach((sub) => { sub.onMessage(data) })
      })
    }
  } catch { /* aborted or transport error — fall through to the same teardown */ }

  // The stream ended: server idle-close, network drop, or our own abort. Only the first
  // two are errors the subscribers should hear about.
  if (!connection.controller.signal.aborted) { fail(url, connection) }
}

/**
 * Subscribe to `topic` on the SSE stream at `url`, which must be the endpoint alone —
 * no `?access_token=`; this client authenticates with a Bearer header. Returns an
 * idempotent unsubscribe; when the last subscriber for a `url` unsubscribes, its
 * connection is closed.
 */
export const subscribeSse = (url: string, topic: string, subscriber: SseSubscriber): () => void => {
  let connection = connections.get(url)

  if (!connection) {
    const conn: SseConnection = { all: new Set(), byTopic: new Map(), controller: new AbortController() }
    connections.set(url, conn)
    connection = conn
    // Subscribe first, open after: the caller's subscriber must be in `all` before the
    // stream can fan `onOpen`/`onError` at it. `stream` never rejects.
    queueMicrotask(() => { void stream(url, conn) })
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
  connections.forEach((connection) => connection.controller.abort())
  connections.clear()
}
