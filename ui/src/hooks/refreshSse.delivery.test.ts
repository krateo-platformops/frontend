/* eslint-disable sort-keys/sort-keys-fix */
/* Expected coordinate objects mirror the snowplow protocol doc order, not alphabetical. */

/**
 * #256 — delivery hardening for the `/refreshes` stream (snowplow 1.12.6 item 7).
 *
 * Split out of refreshSse.test.ts, which covers the protocol helpers and the manager's routing.
 * These are the SPA half of the design's falsifier table, and every one of them is RED against
 * main's implementation — verified by holding this file constant and swapping the implementation
 * back, not by assertion.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { raiseSessionExpired } from '../utils/sessionResume'

import {
  RefreshManager,
  wasRefetchEventTriggered,
  __resetRefreshEntries,
  type RefreshCoords,
} from './refreshSse'

vi.mock('../utils/sessionResume', () => ({ raiseSessionExpired: vi.fn(() => Promise.resolve('resumed')) }))
vi.mock('../utils/getAccessToken', () => ({ getAccessToken: () => 'test-token' }))

afterEach(() => { __resetRefreshEntries() })

/** An SSE response that stays open, so the manager treats the connect as successful. */
const openStream = (): Response => ({
  ok: true,
  status: 200,
  body: new ReadableStream<Uint8Array>({ start() { /* held open; never enqueues */ } }),
}) as unknown as Response

const coords = (name: string): RefreshCoords =>
  ({ class: 'widgets', group: 'g', version: 'v1', resource: 'r', namespace: 'ns', name })

// design's falsifier table; each is RED on main.
// ────────────────────────────────────────────────────────────────────────────

describe('#256 — bounded refetch concurrency', () => {
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

  /**
   * L13, both halves. Retrying a 401 re-presents the same dead token to the backoff ceiling
   * forever; that is the defect. But stopping there is only half a fix — the widgets do NOT re-arm
   * after a resume (recordRefreshHeaders returns the same entry object when the key is unchanged,
   * so the arm hook's effect never re-runs), so nothing would ever call connect() again and the
   * stream stays dead. An earlier revision of this test asserted exactly that dead state.
   */
  it('re-authenticates on 401 and RE-OPENS the stream once the resume succeeds', async () => {
    vi.useFakeTimers()
    let attempt = 0
    const fetchMock = vi.fn(() => {
      attempt += 1
      if (attempt === 1) { return Promise.resolve({ ok: false, status: 401, body: null } as unknown as Response) }
      return Promise.resolve(openStream())
    })
    vi.stubGlobal('fetch', fetchMock)
    const mgr = new RefreshManager()
    mgr.configure('http://snowplow')
    mgr.arm('w1', coords('a'), 'key-a', vi.fn())

    await vi.advanceTimersByTimeAsync(250)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(raiseSessionExpired).toHaveBeenCalled()

    // The resume resolves 'resumed' → exactly ONE reconnect, carrying the fresh token.
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // And it is a reconnect, not a retry loop: the second attempt succeeds and nothing further
    // fires. A backoff loop would keep climbing here.
    await vi.advanceTimersByTimeAsync(60000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    mgr.reset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('does NOT re-open the stream when the user logs out instead of resuming', async () => {
    vi.useFakeTimers()
    vi.mocked(raiseSessionExpired).mockResolvedValueOnce('logout')
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 401, body: null } as unknown as Response))
    vi.stubGlobal('fetch', fetchMock)
    const mgr = new RefreshManager()
    mgr.configure('http://snowplow')
    mgr.arm('w1', coords('a'), 'key-a', vi.fn())
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    mgr.reset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
})

describe('#256 — the 16 KiB subscription cap is loud', () => {
  const bulky = (name: string): RefreshCoords => ({
    class: 'widgets',
    group: 'widgets.templates.krateo.io',
    version: 'v1beta1',
    resource: 'flexes',
    namespace: 'krateo-system',
    name,
    extras: { projects: 'a-fairly-long-project-scope-value', range: 'last-24h', displayName: name.repeat(4) },
  })
  const openStream = (): Response => ({
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({ start() { /* held open */ } }),
  }) as unknown as Response

  /**
   * The byte cap bites long before MAX_WIDGETS=512 — a coordinate is ~170-330 B, so 16 KiB holds
   * roughly 49-86 of them. It used to drop the tail in SILENCE: those widgets render, look live,
   * and never refresh. This warning is the only way to find out whether the bound binds in the
   * field, and that data is what decides A2.5 — so it cannot itself be untested.
   */
  it('warns once per stream open, naming how many of the armed widgets are actually subscribed', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(openStream())))
    const mgr = new RefreshManager()
    mgr.configure('http://snowplow')
    for (let i = 0; i < 120; i += 1) {
      mgr.arm(`w${i}`, bulky(`widget-name-number-${i}`), `key-${i}`, vi.fn())
    }
    await vi.advanceTimersByTimeAsync(250)

    const truncation = warn.mock.calls.map((args) => String(args[0])).filter((msg) => msg.includes('subscription truncated'))
    expect(truncation).toHaveLength(1)
    // It must carry BOTH counts — "some were dropped" without a number cannot answer the question
    // the warning exists to answer.
    expect(truncation[0]).toMatch(/\d+ of 120 armed widgets are subscribed/)
    expect(truncation[0]).toMatch(/remaining \d+ will render but never live-refresh/)

    mgr.reset()
    warn.mockRestore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('stays silent when the armed set fits inside the cap', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(openStream())))
    const mgr = new RefreshManager()
    mgr.configure('http://snowplow')
    for (let i = 0; i < 5; i += 1) {
      mgr.arm(`w${i}`, bulky(`w${i}`), `key-${i}`, vi.fn())
    }
    await vi.advanceTimersByTimeAsync(250)
    expect(warn.mock.calls.filter((args) => String(args[0]).includes('subscription truncated'))).toHaveLength(0)
    mgr.reset()
    warn.mockRestore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
})
