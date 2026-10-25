import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetSseConnections, subscribeSse } from './sseClient'

vi.mock('../utils/getAccessToken', () => ({ getAccessToken: () => 'tok-123' }))

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
const settle = () => new Promise<void>((resolve) => { setTimeout(resolve, 0) })

const noop = () => undefined
let nextStatus = 200

describe('sseClient — shared, ref-counted SSE over fetch + Bearer', () => {
  beforeEach(() => {
    nextStatus = 200
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      const fake = new FakeStream(url, init, nextStatus)
      init.signal?.addEventListener('abort', () => { fake.closed = true })
      return Promise.resolve(fake.response())
    })
  })
  afterEach(() => {
    __resetSseConnections()
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

  it('fans onError out and tears the connection down; a later subscribe reopens', async () => {
    let errors = 0
    subscribeSse('u', 't', { onError: () => { errors += 1 }, onMessage: noop })
    await settle()
    FakeStream.instances[0]?.end()
    await settle()
    expect(errors).toBe(1)

    subscribeSse('u', 't', { onMessage: noop })
    await settle()
    expect(FakeStream.instances).toHaveLength(2)
  })

  it('treats a non-ok response as a connection error', async () => {
    nextStatus = 401
    let errors = 0
    subscribeSse('u', 't', { onError: () => { errors += 1 }, onMessage: noop })
    await settle()
    expect(errors).toBe(1)
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

  it('does not report an error when WE tore the connection down', async () => {
    let errors = 0
    const unsubscribe = subscribeSse('u', 't', { onError: () => { errors += 1 }, onMessage: noop })
    await settle()
    unsubscribe()
    await settle()
    expect(errors).toBe(0)
  })
})
