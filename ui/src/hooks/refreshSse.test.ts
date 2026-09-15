/* eslint-disable sort-keys/sort-keys-fix */
/* Expected coordinate objects mirror the snowplow protocol doc order, not alphabetical. */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { raiseSessionExpired } from '../utils/sessionResume'

import {
  base64UrlEncode,
  buildRefreshCoords,
  drainSseEvents,
  getRefreshEntry,
  isWidgetArmed,
  isWidgetLiveRefreshEnabled,
  parseSseBlock,
  recordRefreshHeaders,
  refreshManager,
  RefreshManager,
  wasRefetchEventTriggered,
  __resetRefreshEntries,
  type RefreshCoords,
} from './refreshSse'

const decodeB64Url = (value: string): string => {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  return new TextDecoder().decode(Uint8Array.from(atob(b64 + pad), (ch) => ch.charCodeAt(0)))
}

vi.mock('../utils/sessionResume', () => ({ raiseSessionExpired: vi.fn(() => Promise.resolve('resumed')) }))
vi.mock('../utils/getAccessToken', () => ({ getAccessToken: () => 'test-token' }))

afterEach(() => { __resetRefreshEntries() })

describe('base64UrlEncode', () => {
  it('produces URL-safe base64 (no +, /, =) that round-trips', () => {
    const json = JSON.stringify([{ class: 'restactions', name: 'blueprints-list' }])
    const encoded = base64UrlEncode(json)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(decodeB64Url(encoded)).toBe(json)
  })

  it('handles Unicode (a non-Latin1 displayName in extras) without throwing', () => {
    const json = JSON.stringify({ extras: { displayName: 'Renée Müller 北京' } })
    const encoded = base64UrlEncode(json)
    expect(decodeB64Url(encoded)).toBe(json)
  })
})

describe('drainSseEvents', () => {
  it('splits complete blocks on the blank line and keeps the partial remainder', () => {
    const { events, rest } = drainSseEvents('event: refresh\ndata: k1\n\nevent: refresh\ndata: k2\n\nevent: refr')
    expect(events).toEqual(['event: refresh\ndata: k1', 'event: refresh\ndata: k2'])
    expect(rest).toBe('event: refr')
  })

  it('returns no events when no boundary is present yet', () => {
    const { events, rest } = drainSseEvents(': keepalive\n')
    expect(events).toEqual([])
    expect(rest).toBe(': keepalive\n')
  })
})

describe('parseSseBlock', () => {
  it('parses a named refresh event with its data key', () => {
    expect(parseSseBlock('event: refresh\ndata: widgets/demo/cpu')).toEqual({ event: 'refresh', data: 'widgets/demo/cpu' })
  })

  it('ignores comment (keepalive) lines and yields no data', () => {
    expect(parseSseBlock(': keepalive')).toEqual({ event: undefined, data: undefined })
  })

  it('joins multi-line data and strips the single leading space after data:', () => {
    expect(parseSseBlock('event: refresh\ndata: a\ndata: b')).toEqual({ event: 'refresh', data: 'a\nb' })
  })
})

describe('buildRefreshCoords', () => {
  const params = (query: string) => new URLSearchParams(query)

  it('splits apiVersion into group/version and carries resource/name/namespace', () => {
    const coords = buildRefreshCoords(
      params('apiVersion=widgets.templates.krateo.io/v1beta1&resource=barcharts&name=cpu-by-node&namespace=demo'),
      'widgets',
    )
    expect(coords).toEqual({
      class: 'widgets',
      group: 'widgets.templates.krateo.io',
      version: 'v1beta1',
      resource: 'barcharts',
      name: 'cpu-by-node',
      namespace: 'demo',
    })
  })

  it('parses page/perPage as numbers and extras as an object', () => {
    const extras = encodeURIComponent('{"q":"x"}')
    const coords = buildRefreshCoords(
      params(`apiVersion=g/v1&resource=tables&name=t&namespace=ns&page=2&perPage=10&extras=${extras}`),
      'widgetContent',
    )
    expect(coords?.page).toBe(2)
    expect(coords?.perPage).toBe(10)
    expect(coords?.extras).toEqual({ q: 'x' })
  })

  it('returns null when resource or name is missing (un-armable)', () => {
    expect(buildRefreshCoords(params('apiVersion=g/v1&namespace=ns'), 'widgets')).toBeNull()
    expect(buildRefreshCoords(params('resource=tables&name=t'), 'widgets')).toBeNull()
  })

  it('leaves extras unset when the extras param is invalid JSON', () => {
    const coords = buildRefreshCoords(params('apiVersion=g/v1&resource=r&name=n&namespace=ns&extras=not-json'), 'restactions')
    expect(coords?.extras).toBeUndefined()
  })
})

describe('recordRefreshHeaders / getRefreshEntry', () => {
  const sp = new URLSearchParams('apiVersion=g/v1&resource=tables&name=t&namespace=ns')
  const makeHeaders = (key: string | null, cls: string | null): Headers => {
    const hdrs = new Headers()
    if (key !== null) { hdrs.set('X-Snowplow-Refresh-Key', key) }
    if (cls !== null) { hdrs.set('X-Snowplow-Refresh-Class', cls) }
    return hdrs
  }

  it('records an entry when both headers are present', () => {
    recordRefreshHeaders('w1', sp, makeHeaders('widgetContent/ns/t', 'widgetContent'))
    const entry = getRefreshEntry('w1')
    expect(entry?.key).toBe('widgetContent/ns/t')
    expect(entry?.coords.class).toBe('widgetContent')
  })

  it('clears the entry when the headers are absent (response not cache-keyed)', () => {
    recordRefreshHeaders('w2', sp, makeHeaders('k', 'widgets'))
    expect(getRefreshEntry('w2')).toBeDefined()
    recordRefreshHeaders('w2', sp, makeHeaders(null, null))
    expect(getRefreshEntry('w2')).toBeUndefined()
  })

  it('ignores an unknown class value', () => {
    recordRefreshHeaders('w3', sp, makeHeaders('k', 'apistage'))
    expect(getRefreshEntry('w3')).toBeUndefined()
  })

  it('keeps the same object reference across an identical refetch (stable effect dep)', () => {
    recordRefreshHeaders('w4', sp, makeHeaders('k', 'widgets'))
    const first = getRefreshEntry('w4')
    recordRefreshHeaders('w4', sp, makeHeaders('k', 'widgets'))
    expect(getRefreshEntry('w4')).toBe(first)
  })

  it('replaces the entry when the captured key changes', () => {
    recordRefreshHeaders('w5', sp, makeHeaders('k1', 'widgets'))
    const first = getRefreshEntry('w5')
    recordRefreshHeaders('w5', sp, makeHeaders('k2', 'widgets'))
    expect(getRefreshEntry('w5')).not.toBe(first)
    expect(getRefreshEntry('w5')?.key).toBe('k2')
  })
})

describe('RefreshManager', () => {
  const coords = (name: string): RefreshCoords =>
    ({ class: 'widgets', group: 'g', version: 'v1', resource: 'r', namespace: 'ns', name })

  it('routes a refresh for an armed key to that widget refetch', () => {
    const mgr = new RefreshManager()
    const refetch = vi.fn()
    mgr.arm('w1', coords('a'), 'key-a', refetch)
    mgr.dispatchRefresh('key-a')
    expect(refetch).toHaveBeenCalledTimes(1)
    mgr.reset()
  })

  it('ignores a refresh for an unknown key', () => {
    const mgr = new RefreshManager()
    const refetch = vi.fn()
    mgr.arm('w1', coords('a'), 'key-a', refetch)
    mgr.dispatchRefresh('key-other')
    expect(refetch).not.toHaveBeenCalled()
    mgr.reset()
  })

  it('throttles to ~1 refetch per 5s per widget', async () => {
    vi.useFakeTimers()
    const mgr = new RefreshManager()
    const refetch = vi.fn()
    mgr.arm('w1', coords('a'), 'key-a', refetch)

    // Leading edge fires immediately.
    mgr.dispatchRefresh('key-a')
    await vi.advanceTimersByTimeAsync(0)
    expect(refetch).toHaveBeenCalledTimes(1)
    // Still inside the 5s window → not refetched again yet.
    await vi.advanceTimersByTimeAsync(4999)
    expect(refetch).toHaveBeenCalledTimes(1)
    mgr.reset()
    vi.useRealTimers()
  })

  // #256 / loss mode L5. The old implementation compared a timestamp and RETURNED on a frame
  // inside the window, so the change that frame announced was lost — permanently, since snowplow
  // keeps no replay. Suppressing the refetch is right; suppressing the fact is not.
  it('DEFERS a frame that arrives inside the throttle window instead of discarding it', async () => {
    vi.useFakeTimers()
    const mgr = new RefreshManager()
    const refetch = vi.fn()
    mgr.arm('w1', coords('a'), 'key-a', refetch)

    // leading edge
    mgr.dispatchRefresh('key-a')
    await vi.advanceTimersByTimeAsync(0)
    expect(refetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    // inside the window — must be REMEMBERED
    mgr.dispatchRefresh('key-a')
    // and coalesced with any others
    mgr.dispatchRefresh('key-a')
    expect(refetch).toHaveBeenCalledTimes(1)

    // window closes → one trailing catch-up
    await vi.advanceTimersByTimeAsync(4100)
    expect(refetch).toHaveBeenCalledTimes(2)

    // ...and exactly one: the two frames inside the window coalesce, they do not queue up.
    await vi.advanceTimersByTimeAsync(20000)
    expect(refetch).toHaveBeenCalledTimes(2)
    mgr.reset()
    vi.useRealTimers()
  })

  it('fans one key out to every widget sharing it (shared-shell widgetContent)', () => {
    const mgr = new RefreshManager()
    const fnA = vi.fn()
    const fnB = vi.fn()
    mgr.arm('w1', coords('x'), 'shared', fnA)
    mgr.arm('w2', coords('x'), 'shared', fnB)
    mgr.dispatchRefresh('shared')
    expect(fnA).toHaveBeenCalledTimes(1)
    expect(fnB).toHaveBeenCalledTimes(1)
    mgr.reset()
  })

  it('stops routing to a widget after it disarms', () => {
    const mgr = new RefreshManager()
    const refetch = vi.fn()
    const disarm = mgr.arm('w1', coords('a'), 'key-a', refetch)
    disarm()
    mgr.dispatchRefresh('key-a')
    expect(refetch).not.toHaveBeenCalled()
    mgr.reset()
  })

  it('re-arming the same widget replaces its key (old key no longer routes)', () => {
    const mgr = new RefreshManager()
    const refetch = vi.fn()
    mgr.arm('w1', coords('a'), 'old-key', refetch)
    mgr.arm('w1', coords('a'), 'new-key', refetch)
    mgr.dispatchRefresh('old-key')
    expect(refetch).not.toHaveBeenCalled()
    mgr.dispatchRefresh('new-key')
    expect(refetch).toHaveBeenCalledTimes(1)
    mgr.reset()
  })

  it('isArmed reflects the armed set: false before arming, true while armed, false after disarm', () => {
    const mgr = new RefreshManager()
    const refetch = vi.fn()
    // Not armed yet.
    expect(mgr.isArmed('w1')).toBe(false)
    const disarm = mgr.arm('w1', coords('a'), 'key-a', refetch)
    // Armed → the honest "Live" precondition.
    expect(mgr.isArmed('w1')).toBe(true)
    // An unrelated widget stays unarmed.
    expect(mgr.isArmed('w2')).toBe(false)
    disarm()
    // Disarmed on unmount → no longer armed.
    expect(mgr.isArmed('w1')).toBe(false)
    mgr.reset()
  })

  it('isArmed is false for every widget after reset', () => {
    const mgr = new RefreshManager()
    mgr.arm('w1', coords('a'), 'key-a', vi.fn())
    expect(mgr.isArmed('w1')).toBe(true)
    mgr.reset()
    expect(mgr.isArmed('w1')).toBe(false)
  })
})

describe('isWidgetArmed (singleton read-only arm check)', () => {
  afterEach(() => { refreshManager.reset() })

  it('is false before the widget arms and true once it has armed on the shared stream', () => {
    expect(isWidgetArmed('w-single')).toBe(false)
    const disarm = refreshManager.arm('w-single', { class: 'widgets', group: 'g', version: 'v1', resource: 'r', namespace: 'ns', name: 'n' }, 'key-single', vi.fn())
    expect(isWidgetArmed('w-single')).toBe(true)
    disarm()
    expect(isWidgetArmed('w-single')).toBe(false)
  })
})

describe('isWidgetLiveRefreshEnabled', () => {
  it('is ON by default once config is loaded (flag absent, or explicitly true)', () => {
    expect(isWidgetLiveRefreshEnabled({ api: {} } as never)).toBe(true)
    expect(isWidgetLiveRefreshEnabled({ api: { WIDGET_LIVE_REFRESH_ENABLED: true } } as never)).toBe(true)
  })

  it('is OFF only when explicitly disabled via the config kill-switch, or before config loads', () => {
    expect(isWidgetLiveRefreshEnabled({ api: { WIDGET_LIVE_REFRESH_ENABLED: false } } as never)).toBe(false)
    expect(isWidgetLiveRefreshEnabled(undefined)).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// #256 — delivery hardening (snowplow 1.12.6 item 7). These arms are the SPA half of the
// design's falsifier table; each is RED on main.
// ────────────────────────────────────────────────────────────────────────────

describe('#256 — bounded refetch concurrency', () => {
  const coords = (name: string): RefreshCoords =>
    ({ class: 'widgets', group: 'g', version: 'v1', resource: 'r', namespace: 'ns', name })

  /** S14.1 — the frame burst alone. Necessary, but NOT discriminating: see S14.2 below. */
  it('holds ≤6 refetches in flight under a pure frame burst', async () => {
    vi.useFakeTimers()
    const mgr = new RefreshManager()
    let inFlight = 0
    let peak = 0
    const release: Array<() => void> = []
    const mk = () => vi.fn(() => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      return new Promise<void>((resolve) => {
        release.push(() => {
          inFlight -= 1
          resolve()
        })
      })
    })
    // 20 armed widgets, each with its own key, all armed on the same manager.
    for (let i = 0; i < 20; i += 1) {
      mgr.arm(`w${i}`, coords(`n${i}`), `key-${i}`, mk())
    }

    // Fire every key as a frame burst — the eviction shape.
    for (let i = 0; i < 20; i += 1) { mgr.dispatchRefresh(`key-${i}`) }
    await vi.advanceTimersByTimeAsync(0)

    expect(peak).toBeLessThanOrEqual(6)
    expect(inFlight).toBeLessThanOrEqual(6)

    // Drain and confirm the queue keeps feeding rather than stalling.
    while (release.length > 0) {
      release.shift()?.()
      // eslint-disable-next-line no-await-in-loop -- draining sequentially is the point
      await vi.advanceTimersByTimeAsync(0)
      expect(inFlight).toBeLessThanOrEqual(6)
    }
    mgr.reset()
    vi.useRealTimers()
  })

  it('never exceeds the cap even when far more keys fire than slots exist', async () => {
    vi.useFakeTimers()
    const mgr = new RefreshManager()
    let inFlight = 0
    let peak = 0
    const release: Array<() => void> = []
    const mk = () => vi.fn(() => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      return new Promise<void>((resolve) => {
        release.push(() => {
          inFlight -= 1
          resolve()
        })
      })
    })
    for (let i = 0; i < 50; i += 1) {
      mgr.arm(`w${i}`, coords(`n${i}`), `key-${i}`, mk())
    }
    for (let i = 0; i < 50; i += 1) {
      mgr.dispatchRefresh(`key-${i}`)
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(peak).toBe(6)
    mgr.reset()
    vi.useRealTimers()
  })
})

describe('#256 — the frame-triggered flag', () => {
  const coords = (name: string): RefreshCoords =>
    ({ class: 'widgets', group: 'g', version: 'v1', resource: 'r', namespace: 'ns', name })

  it('is true only while a frame-triggered refetch is in flight, and false after it settles', async () => {
    vi.useFakeTimers()
    const mgr = new RefreshManager()
    let seenDuring: boolean | undefined
    let resolveFetch: (() => void) | undefined
    mgr.arm('w1', coords('a'), 'key-a', () => new Promise<void>((resolve) => {
      seenDuring = mgr.isEventTriggered('w1')
      resolveFetch = resolve
    }))
    expect(mgr.isEventTriggered('w1')).toBe(false)
    mgr.dispatchRefresh('key-a')
    await vi.advanceTimersByTimeAsync(0)
    expect(seenDuring).toBe(true)
    resolveFetch?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(mgr.isEventTriggered('w1')).toBe(false)
    mgr.reset()
    vi.useRealTimers()
  })

  it('exposes the singleton flag through wasRefetchEventTriggered (the retry predicate contract)', () => {
    expect(wasRefetchEventTriggered('never-armed')).toBe(false)
  })
})

describe('#256 — re-validation on reconnect', () => {
  const coords = (name: string): RefreshCoords =>
    ({ class: 'widgets', group: 'g', version: 'v1', resource: 'r', namespace: 'ns', name })

  /** An SSE response that stays open, so the manager treats the connect as successful. */
  const openStream = (): Response => ({
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({ start() { /* held open; never enqueues */ } }),
  }) as unknown as Response

  /**
   * S14.2 — THE discriminating arm, driven through the real lifecycle rather than a seam.
   *
   * A build that staggers the re-validation BESIDE a cap passes S14.1 (frames only) and a
   * stagger-only test, and still bursts here: each source stays under its own limit while their
   * SUM does not. Both must enqueue onto ONE queue for this to hold.
   */
  it('holds ≤6 in flight across re-validation AND a simultaneous frame burst', async () => {
    vi.useFakeTimers()
    let attempt = 0
    const fetchMock = vi.fn(() => {
      attempt += 1
      // First connect fails at the transport → this is what makes the NEXT connect owe a

      // re-validation (and is the only thing that should).

      if (attempt === 1) { return Promise.reject(new Error('transport')) }
      return Promise.resolve(openStream())
    })
    vi.stubGlobal('fetch', fetchMock)

    const mgr = new RefreshManager()
    mgr.configure('http://snowplow')
    let inFlight = 0
    let peak = 0
    const release: Array<() => void> = []
    const mk = () => vi.fn(() => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      return new Promise<void>((resolve) => {
        release.push(() => {
          inFlight -= 1
          resolve()
        })
      })
    })
    for (let i = 0; i < 20; i += 1) {
      mgr.arm(`w${i}`, coords(`n${i}`), `key-${i}`, mk())
    }

    // arm debounce → connect #1 → transport failure
    await vi.advanceTimersByTimeAsync(250)
    expect(attempt).toBe(1)
    // jittered backoff → connect #2 → success + re-validation armed
    await vi.advanceTimersByTimeAsync(2000)
    expect(attempt).toBe(2)

    // Now drive the frame burst WHILE the staggered re-validation is still draining.
    for (let i = 0; i < 20; i += 1) { mgr.dispatchRefresh(`key-${i}`) }
    await vi.advanceTimersByTimeAsync(0)
    expect(peak).toBeLessThanOrEqual(6)

    // Walk the whole stagger window, releasing as we go: the cap must hold at every point where
    // the two sources overlap, not merely at the start.
    for (let tick = 0; tick < 40; tick += 1) {
      while (release.length > 0) { release.shift()?.() }
      // eslint-disable-next-line no-await-in-loop -- stepping the stagger window is the point
      await vi.advanceTimersByTimeAsync(300)
      expect(inFlight).toBeLessThanOrEqual(6)
    }
    expect(peak).toBeLessThanOrEqual(6)
    expect(peak).toBeGreaterThan(0)
    mgr.reset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  /**
   * The positive half of the gate — and what makes S14.2 above meaningful rather than a second
   * copy of S14.1. Frames published while the stream was down are gone (no replay, no ids), so a
   * reconnect after a real transport loss owes the armed set one refetch each.
   */
  it('re-validates every armed widget after a transport loss, with NO frames involved', async () => {
    vi.useFakeTimers()
    let attempt = 0
    const fetchMock = vi.fn(() => {
      attempt += 1
      if (attempt === 1) { return Promise.reject(new Error('transport')) }
      return Promise.resolve(openStream())
    })
    vi.stubGlobal('fetch', fetchMock)
    const mgr = new RefreshManager()
    mgr.configure('http://snowplow')
    const refetches = [vi.fn(), vi.fn(), vi.fn()]
    refetches.forEach((fn, i) => { mgr.arm(`w${i}`, coords(`n${i}`), `key-${i}`, fn) })

    // connect #1 → transport failure
    await vi.advanceTimersByTimeAsync(250)
    // backoff → connect #2 → re-validation armed
    await vi.advanceTimersByTimeAsync(2000)
    expect(attempt).toBe(2)
    // drain the stagger window
    await vi.advanceTimersByTimeAsync(5000)
    refetches.forEach((fn) => { expect(fn).toHaveBeenCalledTimes(1) })
    mgr.reset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  /**
   * The gate, stated as a test: arm/disarm re-open the stream on every widget mount, so
   * re-validating on THAT path would burst the armed set on every page navigation — the same
   * amplification, triggered by routine use instead of by a fault.
   */
  it('does NOT re-validate when the stream re-opens because of arm/disarm', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(() => Promise.resolve(openStream()))
    vi.stubGlobal('fetch', fetchMock)
    const mgr = new RefreshManager()
    mgr.configure('http://snowplow')
    const refetch = vi.fn()
    mgr.arm('w1', coords('a'), 'key-a', refetch)
    // connect #1 (first ever) — no re-validation
    await vi.advanceTimersByTimeAsync(250)
    // a second widget mounts → stream re-opens
    mgr.arm('w2', coords('b'), 'key-b', vi.fn())
    await vi.advanceTimersByTimeAsync(250)
    // well past any stagger window
    await vi.advanceTimersByTimeAsync(10000)
    expect(refetch).not.toHaveBeenCalled()
    mgr.reset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('re-authenticates on 401 instead of retrying to the backoff ceiling', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 401, body: null } as unknown as Response))
    vi.stubGlobal('fetch', fetchMock)
    const mgr = new RefreshManager()
    mgr.configure('http://snowplow')
    mgr.arm('w1', coords('a'), 'key-a', vi.fn())
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(raiseSessionExpired).toHaveBeenCalled()
    // The dead token must NOT be re-presented on a backoff loop: one attempt, then stop.
    await vi.advanceTimersByTimeAsync(60000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    mgr.reset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
})
