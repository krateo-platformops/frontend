import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetSseConnections, subscribeSse } from './sseClient'

/**
 * The real module's shape: a token that can change, and a listener registry the resume flow
 * drives. Held via vi.hoisted because a vi.mock factory runs before the file body.
 */
const auth = vi.hoisted(() => ({ listeners: [] as (() => void)[], token: { current: 'tok-123' } }))

/** The resume flow, as a lever: each 401/403 parks a promise the test resolves itself. */
const resume = vi.hoisted(() => ({ raises: 0, settle: [] as ((outcome: string) => void)[] }))

vi.mock('../utils/sessionResume', () => ({
  raiseSessionExpired: () => {
    resume.raises += 1
    return new Promise<string>((res) => { resume.settle.push(res) })
  },
}))

vi.mock('../utils/getAccessToken', () => ({
  getAccessToken: () => auth.token.current,
  onAccessTokenInvalidated: (listener: () => void) => {
    auth.listeners.push(listener)

    return () => undefined
  },
}))

/** What `invalidateAccessTokenCache()` does to anything listening. */
const resumeAs = (token: string) => {
  auth.token.current = token
  auth.listeners.forEach((listener) => { listener() })
}

/**
 * One opened stream. `push` feeds raw SSE text to the client's reader exactly as the
 * server would write it; `end` closes the stream; `settle` lets the client's awaits run.
 */
class FakeStream {
  static instances: FakeStream[] = []
  closed = false
  private pending: string[] = []
  private resolveRead: (() => void) | null = null
  private done = false

  constructor(public url: string, public init: RequestInit, public status = 200) {
    FakeStream.instances.push(this)
  }

  get headers(): Record<string, string> { return (this.init.headers ?? {}) as Record<string, string> }

  push(text: string) {
    this.pending.push(text)
    this.resolveRead?.()
    this.resolveRead = null
  }

  /** Emit one well-formed frame for `topic` carrying JSON `data`. */
  emit(topic: string, data: unknown) { this.push(`event: ${topic}\ndata: ${JSON.stringify(data)}\n\n`) }

  end() {
    this.done = true
    this.resolveRead?.()
    this.resolveRead = null
  }

  response(): Response {
    const encoder = new TextEncoder()
    // An arrow keeps `this` lexically, so the fake needs no alias.
    const read = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
      for (;;) {
        const chunk = this.pending.shift()
        if (chunk !== undefined) { return { done: false, value: encoder.encode(chunk) } }
        if (this.done) { return { done: true, value: undefined } }
        // eslint-disable-next-line no-await-in-loop -- the fake blocks until pushed
        await new Promise<void>((resolve) => { this.resolveRead = resolve })
      }
    }

    return {
      body: { getReader: () => ({ read }) },
      ok: this.status >= 200 && this.status < 300,
      status: this.status,
      statusText: `status ${this.status}`,
    } as unknown as Response
  }
}

/** Let queued microtasks and the client's awaits run. */
const settle = async () => {
  // FIVE macrotask turns, not one. Each turn drains the queued microtasks — the queueMicrotask
  // open, the `await fetch`/`read` continuations, an abort rejection — and a single turn is not
  // enough to carry abort -> reject -> catch -> tail check while the reopen's own fetch is still
  // pending. A coarser settle lets a test pass without ever reaching the state it asserts.
  for (let turn = 0; turn < 5; turn += 1) {
    // eslint-disable-next-line no-await-in-loop -- draining turns is inherently sequential
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
  }
}

const noop = () => undefined
let nextStatus = 200

/** Live connections, inferred from whether a fresh subscribe opens a new stream. */
const connectionCount = () => FakeStream.instances.filter((i) => !i.closed).length

describe('sseClient — shared, ref-counted SSE over fetch + Bearer', () => {
  beforeEach(() => {
    nextStatus = 200
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      // A real fetch rejects on an already-aborted signal and never reaches the network. The
      // fake has to do the same, or a stream the client deliberately declined to open still
      // shows up here as live — which is how the one-stream rule looked satisfied when it
      // wasn't (review G2).
      if (init.signal?.aborted) {
        return Promise.reject(new DOMException('The user aborted a request.', 'AbortError'))
      }
      const fake = new FakeStream(url, init, nextStatus)
      init.signal?.addEventListener('abort', () => { fake.closed = true })

      return Promise.resolve(fake.response())
    })
  })
  afterEach(() => {
    resume.raises = 0
    resume.settle = []
    __resetSseConnections()
    auth.token.current = 'tok-123'
    FakeStream.instances = []
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('authenticates with an Authorization header and puts NO token in the url', async () => {
    subscribeSse('https://portal.example/events/notifications', 't', { onMessage: noop })
    await settle()
    const [stream] = FakeStream.instances
    expect(stream?.url).toBe('https://portal.example/events/notifications')
    expect(stream?.url).not.toContain('access_token')
    expect(stream?.headers.Authorization).toBe('Bearer tok-123')
  })

  it('shares ONE connection across subscribers to the same url', async () => {
    subscribeSse('u', 't', { onMessage: noop })
    subscribeSse('u', 't', { onMessage: noop })
    await settle()
    expect(FakeStream.instances).toHaveLength(1)
  })

  it('opens a separate connection per distinct url', async () => {
    subscribeSse('u1', 't', { onMessage: noop })
    subscribeSse('u2', 't', { onMessage: noop })
    await settle()
    expect(FakeStream.instances).toHaveLength(2)
  })

  it('fans a message out to every subscriber on that topic', async () => {
    const recvA: string[] = []
    const recvB: string[] = []
    subscribeSse('u', 't', { onMessage: (data) => recvA.push(data) })
    subscribeSse('u', 't', { onMessage: (data) => recvB.push(data) })
    await settle()
    FakeStream.instances[0]?.emit('t', { x: 1 })
    await settle()
    expect(recvA).toEqual(['{"x":1}'])
    expect(recvB).toEqual(['{"x":1}'])
  })

  it('routes messages by topic (a topic only reaches its own subscribers)', async () => {
    const recvA: string[] = []
    const recvB: string[] = []
    subscribeSse('u', 'topicA', { onMessage: (data) => recvA.push(data) })
    subscribeSse('u', 'topicB', { onMessage: (data) => recvB.push(data) })
    await settle()
    FakeStream.instances[0]?.emit('topicA', { v: 'a' })
    await settle()
    expect(recvA).toEqual(['{"v":"a"}'])
    expect(recvB).toEqual([])
  })

  it('ignores keepalive comments and frame-split reads', async () => {
    const seen: string[] = []
    subscribeSse('u', 't', { onMessage: (data) => seen.push(data) })
    await settle()
    const [stream] = FakeStream.instances
    stream?.push(': keepalive\n\n')
    // One frame delivered across two reads — the client must buffer, not drop or double it.
    stream?.push('event: t\ndata: {"half"')
    await settle()
    stream?.push(':1}\n\n')
    await settle()
    expect(seen).toEqual(['{"half":1}'])
  })

  it('fans onOpen out to all subscribers on the connection', async () => {
    let opened = 0
    subscribeSse('u', 't1', { onMessage: noop, onOpen: () => { opened += 1 } })
    subscribeSse('u', 't2', { onMessage: noop, onOpen: () => { opened += 1 } })
    await settle()
    expect(opened).toBe(2)
  })

  it('fans onError out on a dropped stream, and KEEPS the connection for the retry to reopen', async () => {
    // Before #503 this tore the connection down, which is why an sse-proxy roll left every
    // open tab's bell dead: nothing re-subscribed. onError still fires — a subscriber that
    // wants to show "disconnected" must hear about it — but the connection survives.
    let errors = 0
    subscribeSse('u', 't', { onError: () => { errors += 1 }, onMessage: noop })
    await settle()
    FakeStream.instances[0]?.end()
    await settle()
    expect(errors).toBe(1)

    // A fresh subscribe JOINS the surviving connection rather than opening a second one.
    subscribeSse('u', 't', { onMessage: noop })
    await settle()
    expect(FakeStream.instances).toHaveLength(1)
  })

  it('a non-ok response that is not an auth failure is an error the subscribers hear', async () => {
    nextStatus = 503
    let errors = 0
    subscribeSse('u', 't', { onError: () => { errors += 1 }, onMessage: noop })
    await settle()
    expect(errors).toBe(1)
    expect(resume.raises).toBe(0)
  })

  it('stops delivery after unsubscribe (and unsubscribe is idempotent)', async () => {
    const seen: string[] = []
    const unsubscribe = subscribeSse('u', 't', { onMessage: (data) => seen.push(data) })
    await settle()
    unsubscribe()
    unsubscribe()
    FakeStream.instances[0]?.emit('t', { x: 1 })
    await settle()
    expect(seen).toEqual([])
  })

  it('aborts the connection only when the last subscriber leaves (ref counting)', async () => {
    const u1 = subscribeSse('u', 't', { onMessage: noop })
    const u2 = subscribeSse('u', 't', { onMessage: noop })
    await settle()
    const [stream] = FakeStream.instances
    u1()
    expect(stream?.closed).toBe(false)
    u2()
    expect(stream?.closed).toBe(true)
  })

  it('a throwing subscriber does not kill the stream for the others (snowplow review F1)', async () => {
    // The regression this guards: the fan-out runs inside the read loop's try, so before the
    // per-subscriber catch one handler throwing tore down the connection EVERY subscriber on
    // the endpoint shares. Reachable as soon as a second consumer joined — the bell died
    // because the action-navigate path's unguarded JSON.parse hit a frame it disliked.
    const survived: string[] = []
    let errors = 0
    subscribeSse('u', 't', { onMessage: () => { throw new Error('handler blew up') } })
    subscribeSse('u', 't', { onError: () => { errors += 1 }, onMessage: (data) => survived.push(data) })
    await settle()

    FakeStream.instances[0]?.emit('t', { x: 1 })
    await settle()

    // The well-behaved subscriber still got this message...
    expect(survived).toEqual(['{"x":1}'])
    // ...the connection was not torn down...
    expect(FakeStream.instances[0]?.closed).toBe(false)
    expect(errors).toBe(0)

    // ...and it keeps delivering afterwards, which is the part a one-shot check would miss.
    FakeStream.instances[0]?.emit('t', { x: 2 })
    await settle()
    expect(survived).toEqual(['{"x":1}', '{"x":2}'])
    expect(FakeStream.instances).toHaveLength(1)
  })

  it('re-opens with the NEW credential when the session changes (#503 F3)', async () => {
    // The bug: `connections` is keyed on the endpoint alone, so after an in-place resume as
    // another user a stream opened with the OLD token keeps that identity on the server, and
    // a remount re-joins the very same connection. #501 removed the accident that covered
    // this — the token used to be in the url, so a credential change changed the key.
    subscribeSse('u', 't', { onMessage: noop })
    await settle()
    expect(FakeStream.instances[0]?.headers.Authorization).toBe('Bearer tok-123')

    resumeAs('tok-2')
    await settle()

    expect(FakeStream.instances).toHaveLength(2)
    expect(FakeStream.instances[1]?.headers.Authorization).toBe('Bearer tok-2')
    // The old stream was aborted rather than left running with the stale identity.
    expect(FakeStream.instances[0]?.closed).toBe(true)
  })

  it('keeps the subscribers and keeps delivering across a re-open', async () => {
    const seen: string[] = []
    let errors = 0
    subscribeSse('u', 't', { onError: () => { errors += 1 }, onMessage: (data) => seen.push(data) })
    await settle()

    resumeAs('tok-2')
    await settle()

    // A bare teardown would have fixed the identity and left the bell dead until something
    // remounted it — a security bug traded for a silent functional one. It must still work.
    FakeStream.instances[1]?.emit('t', { after: 'resume' })
    await settle()
    expect(seen).toEqual(['{"after":"resume"}'])
    expect(errors).toBe(0)
    expect(connectionCount()).toBe(1)
  })

  it('a superseded stream does not tear down the one that replaced it', async () => {
    // The subtle half. The re-open gives the connection a fresh controller, so the OLD
    // stream wakes on abort and runs its teardown tail. Without the identity guard it fails
    // the connection its replacement is now using — the reopen would kill itself.
    let errors = 0
    subscribeSse('u', 't', { onError: () => { errors += 1 }, onMessage: noop })
    await settle()

    resumeAs('tok-2')
    await settle()

    // Let the old stream finish arriving at its tail, after the replacement is live.
    FakeStream.instances[0]?.end()
    await settle()

    expect(errors).toBe(0)
    const seen: string[] = []
    subscribeSse('u', 't', { onMessage: (data) => seen.push(data) })
    await settle()
    // Still ONE connection, and it is the new one: no third stream was opened, which it
    // would have been had the connection been torn down.
    expect(FakeStream.instances).toHaveLength(2)
    FakeStream.instances[1]?.emit('t', { ok: true })
    await settle()
    expect(seen).toEqual(['{"ok":true}'])
  })

  it('a superseded stream answering non-ok does not tear down its replacement', async () => {
    // The reachable case, and the one the reopen itself creates: a stale token 401s, that
    // raises the resume, the resume invalidates and reopens — and THEN the old 401 lands.
    // `fail`'s own guard cannot catch it, because it compares the CONNECTION, which a reopen
    // deliberately keeps (only the controller is replaced).
    let resolveFirst: ((response: Response) => void) | undefined
    let calls = 0
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls += 1
      if (calls === 1) {
        return new Promise<Response>((resolve) => { resolveFirst = resolve })
      }
      const fake = new FakeStream(url, init, 200)
      init.signal?.addEventListener('abort', () => { fake.closed = true })

      return Promise.resolve(fake.response())
    })

    const seen: string[] = []
    let errors = 0
    subscribeSse('u', 't', { onError: () => { errors += 1 }, onMessage: (data) => seen.push(data) })
    await settle()

    // The first fetch is still in flight when the session changes.
    resumeAs('tok-2')
    await settle()
    expect(calls).toBe(2)

    // Now the ORIGINAL request answers 401, after it has been superseded.
    resolveFirst?.({ body: null, ok: false, status: 401, statusText: 'Unauthorized' } as unknown as Response)
    await settle()

    expect(errors).toBe(0)
    // And the replacement is still live and still delivering.
    FakeStream.instances[0]?.emit('t', { survived: true })
    await settle()
    expect(seen).toEqual(['{"survived":true}'])
  })

  it('delivers no frame from a stream that has been superseded', async () => {
    const seen: string[] = []
    subscribeSse('u', 't', { onMessage: (data) => seen.push(data) })
    await settle()
    const [first] = FakeStream.instances

    // Queue a frame on the OLD stream, then replace it before the read loop can run again.
    resumeAs('tok-2')
    first?.emit('t', { fromTheOldStream: true })
    await settle()

    // byTopic is shared with the replacement, so a late frame would arrive looking like the
    // new stream's own.
    expect(seen).toEqual([])
  })

  it('a pending fetch aborted by the reopen does not tear down its replacement (the browser path)', async () => {
    // G2 from the review. A real fetch REJECTS when its signal aborts, so in a browser the
    // "old request finishes after the reopen" case goes through the fetch catch, NOT the
    // !response.ok branch. The simple fake ignores the signal, which is exactly why reverting
    // that catch's guard passed the whole suite — the test could not reach the real path.
    let calls = 0
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls += 1
      if (calls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The user aborted a request.', 'AbortError'))
          })
        })
      }
      const fake = new FakeStream(url, init, 200)
      init.signal?.addEventListener('abort', () => { fake.closed = true })

      return Promise.resolve(fake.response())
    })

    const seen: string[] = []
    let errors = 0
    subscribeSse('u', 't', { onError: () => { errors += 1 }, onMessage: (data) => seen.push(data) })
    await settle()

    resumeAs('tok-2')
    await settle()
    expect(calls).toBe(2)

    // The aborted first request must be silent, not an error that tears down the replacement.
    expect(errors).toBe(0)
    FakeStream.instances[0]?.emit('t', { survived: true })
    await settle()
    expect(seen).toEqual(['{"survived":true}'])
  })

  it('subscribing and invalidating in the same tick delivers each frame ONCE', async () => {
    // G1 from the review. The first open used to read `conn.controller` when its microtask
    // ran, by which time an invalidation in the same tick had already replaced it — so this
    // open and the reopen's both started on the same controller, both passed isCurrent, and
    // every frame arrived twice. Not reachable from today's call sites; it breaks the
    // one-stream-per-endpoint rule the module exists to keep.
    const seen: string[] = []
    subscribeSse('u', 't', { onMessage: (data) => seen.push(data) })
    resumeAs('tok-2')
    await settle()

    const live = FakeStream.instances.filter((instance) => !instance.closed)
    expect(live).toHaveLength(1)
    live[0]?.emit('t', { once: true })
    await settle()
    expect(seen).toEqual(['{"once":true}'])
  })

  it('does not report an error when WE tore the connection down', async () => {
    let errors = 0
    const unsubscribe = subscribeSse('u', 't', { onError: () => { errors += 1 }, onMessage: noop })
    await settle()
    unsubscribe()
    await settle()
    expect(errors).toBe(0)
  })
})

/**
 * Reconnect (#503). Only `setTimeout` is faked: `queueMicrotask` stays native so the client's
 * own opens still drain on ordinary awaits, and the ONLY clock the test controls is the backoff.
 * Every delay assertion is written against the jitter BOUNDS — ±25 % of a 1 s first step, so
 * [750, 1250] — which is why advancing 700 and then 1300 is deterministic despite the jitter.
 */
describe('sseClient — reconnect after a dropped stream', () => {
  const FIRST_STEP_FLOOR = 700
  const PAST_FIRST_STEP = 1300

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    nextStatus = 200
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      if (init.signal?.aborted) {
        return Promise.reject(new DOMException('The user aborted a request.', 'AbortError'))
      }
      const fake = new FakeStream(url, init, nextStatus)
      init.signal?.addEventListener('abort', () => { fake.closed = true })

      return Promise.resolve(fake.response())
    })
  })
  afterEach(() => {
    __resetSseConnections()
    resume.raises = 0
    resume.settle = []
    FakeStream.instances = []
    auth.token.current = 'tok-123'
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Drain the client's microtask-driven opens without letting the backoff timer fire. */
  const settleF = async () => {
    for (let turn = 0; turn < 5; turn += 1) {
      // eslint-disable-next-line no-await-in-loop -- draining turns is inherently sequential
      await vi.advanceTimersByTimeAsync(0)
    }
  }
  /** Advance the clock, then drain whatever the fired timer started. */
  const elapse = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms)
    await settleF()
  }

  it('reopens the stream and keeps delivering — the sse-proxy roll case', async () => {
    const seen: string[] = []
    subscribeSse('u', 't', { onMessage: (data) => seen.push(data) })
    await settleF()
    // A pod shutdown ends the stream with `done` from the reader and no error at all.
    FakeStream.instances[0]?.end()
    await settleF()

    await elapse(PAST_FIRST_STEP)
    expect(FakeStream.instances).toHaveLength(2)
    FakeStream.instances[1]?.emit('t', { after: 'the roll' })
    await settleF()
    expect(seen).toEqual(['{"after":"the roll"}'])
  })

  it('waits out the backoff rather than reopening immediately', async () => {
    subscribeSse('u', 't', { onMessage: noop })
    await settleF()
    FakeStream.instances[0]?.end()
    await settleF()
    // An immediate loop is the failure mode a retry policy exists to avoid.
    expect(FakeStream.instances).toHaveLength(1)

    await elapse(FIRST_STEP_FLOOR)
    expect(FakeStream.instances).toHaveLength(1)
    await elapse(PAST_FIRST_STEP - FIRST_STEP_FLOOR)
    expect(FakeStream.instances).toHaveLength(2)
  })

  it('spends its backoff budget from zero again after a successful open', async () => {
    // Without the reset, a connection that drops once an hour climbs to the 30 s ceiling over
    // a day: the slowest reconnects would be the ones on the healthiest endpoints. The second
    // drop must therefore wait the FIRST step (~1 s), not the second (~2 s).
    subscribeSse('u', 't', { onMessage: noop })
    await settleF()
    FakeStream.instances[0]?.end()
    await settleF()
    await elapse(PAST_FIRST_STEP)
    expect(FakeStream.instances).toHaveLength(2)

    FakeStream.instances[1]?.end()
    await settleF()
    await elapse(PAST_FIRST_STEP)
    expect(FakeStream.instances).toHaveLength(3)
  })

  it('does NOT reconnect once the last subscriber has gone', async () => {
    const unsubscribe = subscribeSse('u', 't', { onMessage: noop })
    await settleF()
    unsubscribe()
    await settleF()
    await elapse(PAST_FIRST_STEP * 4)
    expect(FakeStream.instances).toHaveLength(1)
  })

  it('never resurrects a connection whose pending retry was torn down', async () => {
    subscribeSse('u', 't', { onMessage: noop })
    await settleF()
    FakeStream.instances[0]?.end()
    await settleF()
    // The retry is armed; drop the whole module's state under it.
    __resetSseConnections()
    await elapse(PAST_FIRST_STEP * 4)
    expect(FakeStream.instances).toHaveLength(1)
  })

  it('tells subscribers which opens are REOPENS, so they can refetch the baseline they missed', async () => {
    const opens: boolean[] = []
    subscribeSse('u', 't', { onMessage: noop, onOpen: ({ reopened }) => opens.push(reopened) })
    await settleF()
    expect(opens).toEqual([false])

    FakeStream.instances[0]?.end()
    await settleF()
    await elapse(PAST_FIRST_STEP)
    // Frames published while it was down are gone: no replay, no ids, nothing to resume from.
    expect(opens).toEqual([false, true])
  })

  describe('an auth failure is not a transport fault', () => {
    it('raises session-resume ONCE and schedules no retry', async () => {
      // Retrying IS the defect: the same dead token re-presented on a timer produced 553
      // gateway rejections in one window, backing off to the ceiling with no way back.
      nextStatus = 401
      subscribeSse('u', 't', { onMessage: noop })
      await settleF()
      expect(resume.raises).toBe(1)

      await elapse(PAST_FIRST_STEP * 4)
      expect(FakeStream.instances).toHaveLength(1)
      expect(resume.raises).toBe(1)
    })

    it('reopens with the new credential once the session is resumed', async () => {
      nextStatus = 401
      subscribeSse('u', 't', { onMessage: noop })
      await settleF()

      nextStatus = 200
      auth.token.current = 'tok-after-resume'
      resume.settle[0]?.('resumed')
      await settleF()
      expect(FakeStream.instances).toHaveLength(2)
      expect(FakeStream.instances[1]?.headers.Authorization).toBe('Bearer tok-after-resume')
    })

    it('drops the connection when the user did not resume', async () => {
      nextStatus = 401
      subscribeSse('u', 't', { onMessage: noop })
      await settleF()
      resume.settle[0]?.('logout')
      await settleF()

      await elapse(PAST_FIRST_STEP * 4)
      expect(FakeStream.instances).toHaveLength(1)
      // The connection is gone, so a later subscribe opens a fresh one rather than joining a corpse.
      nextStatus = 200
      subscribeSse('u', 't', { onMessage: noop })
      await settleF()
      expect(FakeStream.instances).toHaveLength(2)
    })

    it('treats a 403 the same way — a refused user is not a blip', async () => {
      nextStatus = 403
      subscribeSse('u', 't', { onMessage: noop })
      await settleF()
      expect(resume.raises).toBe(1)
      await elapse(PAST_FIRST_STEP * 4)
      expect(FakeStream.instances).toHaveLength(1)
    })
  })
})
