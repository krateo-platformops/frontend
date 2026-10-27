/**
 * What the proxy ANNOUNCES at open: `X-Krateo-Event-Scope` (sse-proxy#34).
 *
 * Its own file because sseClient.test.ts is at its max-lines limit, and because this is a
 * different subject — not the transport, but one header read off a successful open. The harness
 * here is deliberately smaller than that file's: the body's reader NEVER resolves, so the stream
 * simply stays open and no retry timer is involved. These tests are about the open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type EventScope, __resetSseConnections, parseEventScope, subscribeSse } from './sseClient'

/** The token module's shape, with the listener registry a reopen is driven through. */
const auth = vi.hoisted(() => ({ listeners: [] as (() => void)[] }))

vi.mock('../utils/getAccessToken', () => ({
  getAccessToken: () => 'tok',
  onAccessTokenInvalidated: (listener: () => void) => {
    auth.listeners.push(listener)

    return () => undefined
  },
}))

const noop = () => undefined
let opens = 0

/** Answer each open with the next header set, holding every stream open forever. */
const serve = (...headerSets: Record<string, string>[]) => {
  opens = 0
  vi.stubGlobal('fetch', () => {
    const headers = headerSets[Math.min(opens, headerSets.length - 1)] ?? {}
    opens += 1

    return Promise.resolve({
      // Never resolves: the stream stays open, so nothing retries and nothing tears down.
      body: { getReader: () => ({ read: () => new Promise<never>(() => undefined) }) },
      headers: new Headers(headers),
      ok: true,
      status: 200,
      statusText: 'OK',
    } as unknown as Response)
  })
}

const settle = async () => {
  for (let turn = 0; turn < 5; turn += 1) {
    // eslint-disable-next-line no-await-in-loop -- draining turns is inherently sequential
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
  }
}

/** Open one connection and collect what each open announced. */
const announced = async (...headerSets: Record<string, string>[]): Promise<EventScope[]> => {
  serve(...headerSets)
  const seen: EventScope[] = []
  subscribeSse('u', 't', { onMessage: noop, onOpen: ({ scope }) => seen.push(scope) })
  await settle()

  return seen
}

afterEach(() => {
  __resetSseConnections()
  // NOT clearing auth.listeners: the client arms its credential watch ONCE per module load
  // (the one-shot in armCredentialWatch), so emptying the registry between tests would leave
  // nothing to fire and the reopen case would silently observe no second open.
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the scope a stream announces, read off a real open', () => {
  it('an explicit namespace list, in the order the proxy sorted it', async () => {
    expect(await announced({ 'X-Krateo-Event-Scope': 'demo-system,team-a' }))
      .toEqual([{ kind: 'namespaces', namespaces: ['demo-system', 'team-a'] }])
  })

  it('`*` is every namespace', async () => {
    expect(await announced({ 'X-Krateo-Event-Scope': '*' })).toEqual([{ kind: 'all' }])
  })

  it('the explicit `none` token is an EMPTY scope — the case with no other symptom', async () => {
    // Scoping is ON and this caller's scope resolved to nothing, so the stream is open and will
    // never deliver. Without this token that is indistinguishable from a quiet cluster.
    expect(await announced({ 'X-Krateo-Event-Scope': 'none' })).toEqual([{ kind: 'none' }])
  })

  it('an ABSENT header means the proxy does not scope — NEVER "you may see nothing"', async () => {
    // The control that matters most: an older sse-proxy sends no header at all, and a
    // cross-origin read sees null if Access-Control-Expose-Headers is ever dropped.
    expect(await announced({})).toEqual([{ kind: 'unscoped' }])
  })

  it('is read again on every REOPEN, not once per page load', async () => {
    // A reconnect can land on a pod whose scope resolution has changed — after an RBAC grant
    // lands, for instance. A first-open-only read would hold a stale answer indefinitely.
    const seen = await announced({ 'X-Krateo-Event-Scope': 'none' },
      { 'X-Krateo-Event-Scope': 'demo-system' })
    expect(seen).toEqual([{ kind: 'none' }])

    auth.listeners.forEach((fire) => { fire() })
    await settle()
    expect(seen).toEqual([{ kind: 'none' }, { kind: 'namespaces', namespaces: ['demo-system'] }])
  })
})

describe('parseEventScope, on the values the proxy can send', () => {
  it.each([
    ['*', { kind: 'all' }],
    ['none', { kind: 'none' }],
    ['  demo-system , team-a ', { kind: 'namespaces', namespaces: ['demo-system', 'team-a'] }],
    [null, { kind: 'unscoped' }],
    // Proxies and CDNs strip empty header values; that must not silently become `none`.
    ['', { kind: 'unscoped' }],
    ['   ', { kind: 'unscoped' }],
    [',,', { kind: 'unscoped' }],
  ] as [string | null, EventScope][])('%s', (raw, want) => {
    expect(parseEventScope(raw)).toEqual(want)
  })
})
