// @vitest-environment jsdom
/**
 * `krateo.agentiko.a2a`: Agentiko's A2A request, exported as the SAME span whose context the request
 * carried as `traceparent` — so the gateway's `POST /api/a2a/*` span, which already has that span as
 * its parent, finds the parent stored.
 *
 * EVERY SPAN HERE IS MADE BY THE INSTALLED LIBRARY (#588). The real `FetchInstrumentation` patches a
 * stub `fetch`, a real `WebTracerProvider` creates the span and calls the real
 * `ContractSpanProcessor.onStart`, the real W3C propagator writes the header, and a recorder sits
 * inside the contract processor exactly where `BatchSpanProcessor` sits in tracing.ts. The A2A
 * requests go through the real Agentiko transport. Nothing is hand-named: a hand-built `POST` span
 * would agree with the predicate about what the library emits, and #588 shipped on exactly that.
 *
 * The stub fetch stands in for the network only. It records the headers the instrumentation
 * injected, so the trace and span id the request CARRIED can be compared with the span exported.
 * No session, token or credential is involved: the transport's Bearer helper finds no stored
 * session and sends no Authorization header.
 */
import { context, propagation, SpanStatusCode, trace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { WebTracerProvider, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace-web'
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_URL_FULL,
} from '@opentelemetry/semantic-conventions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createKagentTransport } from '../components/Agentiko/transport'
import type { AgentikoFrame } from '../components/Agentiko/types'

import {
  A2A_METHODS,
  A2A_ROUTE,
  ATTR_A2A_METHOD,
  ContractSpanProcessor,
  COUNTED_SPAN_NAMES,
  redactUrlAttributes,
  SPAN_NAMES,
  withA2aMethod,
} from './spanContract'
import { agentikoA2aPrefixOf } from './tracing'

const ORIGIN = window.location.origin
const SNOWPLOW = `${ORIGIN}/content`
/** The gateway form the chart writes: `<origin>/api/a2a/<release namespace>/<agentName>`. */
const A2A_BASE = `${ORIGIN}/api/a2a/krateo-system/agentiko`

/** One SSE event that completes the turn, so the transport stops after one request. */
const COMPLETED = `data: ${JSON.stringify({
  id: 1,
  jsonrpc: '2.0',
  result: { contextId: 'ctx-1', final: true, kind: 'status-update', status: { state: 'completed' }, taskId: 'task-1' },
})}\n\n`

interface Sent { headers: Headers; url: string }

let recorded: ReadableSpan[] = []
let sent: Sent[] = []
let respond: () => Response = () => new Response(COMPLETED, { status: 200 })
let instrumentation: FetchInstrumentation | null = null
const realFetch = globalThis.fetch

/** Stands exactly where `BatchSpanProcessor` stands in tracing.ts: inside the contract processor. */
const recorder = (): SpanProcessor => ({
  forceFlush: () => Promise.resolve(),
  onEnd: (span) => { recorded.push(span) },
  onStart: () => undefined,
  shutdown: () => Promise.resolve(),
})

/**
 * The production wiring, minus the exporter: the provider registered with the W3C propagator, and
 * the fetch instrumentation with tracing.ts's `applyCustomAttributesOnSpan`. The stub `fetch` is
 * installed BEFORE the instrumentation is constructed, because construction is what patches it.
 */
const install = (a2aPrefix: string | null) => {
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ headers: new Headers(init?.headers), url: String(input) })
    // Through `.then`, so a `respond` that throws is a REJECTED fetch, as a network failure is.
    return Promise.resolve().then(respond)
  }) as typeof fetch
  const provider = new WebTracerProvider({
    spanProcessors: [new ContractSpanProcessor(recorder(), SNOWPLOW, a2aPrefix)],
  })
  provider.register({ propagator: new W3CTraceContextPropagator() })
  instrumentation = new FetchInstrumentation({
    applyCustomAttributesOnSpan: (span) => { redactUrlAttributes(span, SNOWPLOW) },
  })
  instrumentation.setTracerProvider(provider)
}

beforeEach(() => {
  recorded = []
  sent = []
  respond = () => new Response(COMPLETED, { status: 200 })
  // `disable` first: the globals are set once per process, and a second `set` is ignored with a
  // warning — which would quietly run every case after the first against a dead recorder.
  trace.disable()
  context.disable()
  propagation.disable()
})

afterEach(() => {
  instrumentation?.disable()
  instrumentation = null
  globalThis.fetch = realFetch
  trace.disable()
  context.disable()
  propagation.disable()
})

/** Drive one real turn through the transport, and wait for it to finish. */
const sendTurn = async (): Promise<AgentikoFrame[]> => {
  const frames: AgentikoFrame[] = []
  createKagentTransport(A2A_BASE).send({ context: '', sessionId: 's-1', text: 'hello' }, { onFrame: (frame) => { frames.push(frame) } })
  await vi.waitFor(() => { expect(frames.some((frame) => frame.kind === 'done')).toBe(true) })
  return frames
}

/** The instrumentation ends its span on a 300ms timer after the body completes. */
const settled = () => vi.waitFor(() => { expect(recorded.length).toBeGreaterThan(0) }, { timeout: 3000 })

/** The `traceparent` the request carried, split into its ids. */
const carried = (request: Sent) => {
  const header = request.headers.get('traceparent')
  expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/)
  const [, traceId, spanId] = String(header).split('-')
  return { spanId, traceId }
}

describe('the A2A span is exported as krateo.agentiko.a2a', () => {
  it('(a) with the templated route and ONLY the allowed attributes', async () => {
    install(A2A_BASE)
    await sendTurn()
    await settled()

    // The request really went to the concrete path, which is what the route must NOT carry.
    expect(sent.map(({ url }) => url)).toEqual([`${A2A_BASE}/`])
    expect(recorded).toHaveLength(1)
    const [span] = recorded
    expect(span.name).toBe(COUNTED_SPAN_NAMES.agentikoA2a)
    expect(span.attributes).toEqual({
      [ATTR_A2A_METHOD]: 'message/stream',
      [ATTR_HTTP_REQUEST_METHOD]: 'POST',
      [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
      [ATTR_HTTP_ROUTE]: '/api/a2a/{namespace}/{agent}',
    })
    expect(A2A_ROUTE).toBe('/api/a2a/{namespace}/{agent}')
  })

  it('(b) keeps the span context the request carried as traceparent: the rename does not touch it', async () => {
    install(A2A_BASE)
    await sendTurn()
    await settled()

    const { spanId, traceId } = carried(sent[0])
    const exported = recorded[0].spanContext()
    expect(exported.traceId).toBe(traceId)
    expect(exported.spanId).toBe(spanId)
  })

  it('carries no attribute that holds the URL, the query, the body or a header', async () => {
    install(A2A_BASE)
    await sendTurn()
    await settled()

    const values = Object.values(recorded[0].attributes).map(String)
    expect(values.some((value) => value.includes('krateo-system') || value.includes('agentiko'))).toBe(false)
    expect(values.some((value) => value.includes('hello') || value.includes('?'))).toBe(false)
    expect(recorded[0].attributes[ATTR_URL_FULL]).toBeUndefined()
  })
})

describe('krateo.a2a.method is a CLOSED enum: set only for an agreed value, else omitted', () => {
  it('names exactly the four values snowplow accepts', () => {
    expect([...A2A_METHODS].sort()).toEqual(['message/send', 'message/stream', 'tasks/get', 'tasks/resubscribe'])
  })

  it('records each of them — the context carries the method to the span', async () => {
    install(A2A_BASE)
    for (const method of ['message/send', 'tasks/get', 'tasks/resubscribe']) {
      // eslint-disable-next-line no-await-in-loop -- one request at a time, so the spans keep their order
      await withA2aMethod(method, () => fetch(`${A2A_BASE}/`, { method: 'POST' }))
    }
    await vi.waitFor(() => { expect(recorded).toHaveLength(3) }, { timeout: 3000 })

    expect(recorded.map((span) => span.attributes[ATTR_A2A_METHOD])).toEqual(['message/send', 'tasks/get', 'tasks/resubscribe'])
  })

  it('OMITS any other method, and still exports the span', async () => {
    install(A2A_BASE)
    await withA2aMethod('tasks/cancel', () => fetch(`${A2A_BASE}/`, { method: 'POST' }))
    await settled()

    expect(recorded).toHaveLength(1)
    expect(recorded[0].name).toBe(COUNTED_SPAN_NAMES.agentikoA2a)
    expect(ATTR_A2A_METHOD in recorded[0].attributes).toBe(false)
    expect(recorded[0].attributes[ATTR_HTTP_ROUTE]).toBe(A2A_ROUTE)
  })

  it('omits it when no method is on the context at all', async () => {
    install(A2A_BASE)
    await fetch(`${A2A_BASE}/`, { method: 'POST' })
    await settled()

    expect(recorded[0].name).toBe(COUNTED_SPAN_NAMES.agentikoA2a)
    expect(recorded[0].attributes).toEqual({
      [ATTR_HTTP_REQUEST_METHOD]: 'POST',
      [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
      [ATTR_HTTP_ROUTE]: A2A_ROUTE,
    })
  })
})

describe('only the agent\'s JSON-RPC calls — POSTs — become the A2A span', () => {
  it('the rail\'s availability probe, a GET of the same base, is NOT exported', async () => {
    install(A2A_BASE)
    // The probe's own call shape (availability.ts): a GET of `<base>/`, no method on the context.
    await fetch(`${A2A_BASE}/`, { method: 'GET' })
    // Then a real turn in the same harness, so "nothing recorded" cannot be a dead recorder.
    await sendTurn()
    await settled()
    await new Promise((resolve) => { setTimeout(resolve, 400) })

    expect(sent.map(({ url }) => url)).toEqual([`${A2A_BASE}/`, `${A2A_BASE}/`])
    expect(recorded).toHaveLength(1)
    expect(recorded[0].attributes[ATTR_HTTP_REQUEST_METHOD]).toBe('POST')
  })
})

describe('where the span ENDS, pinned against the installed library', () => {
  /** A response whose body stays open until `close` is called, as a streamed turn does. */
  const openStream = () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c } })
    return {
      close: () => { controller?.close() },
      error: () => { controller?.error(new DOMException('aborted', 'AbortError')) },
      response: () => new Response(body, { status: 200 }),
    }
  }

  it('NOT when the response resolves: it stays open while the stream does, and ends at the last byte', async () => {
    install(A2A_BASE)
    const stream = openStream()
    respond = stream.response
    const response = await withA2aMethod('message/stream', () => fetch(`${A2A_BASE}/`, { method: 'POST' }))
    expect(response.status).toBe(200)

    // Longer than the instrumentation's 300ms end timer: had it ended at response time, it would be here.
    await new Promise((resolve) => { setTimeout(resolve, 600) })
    expect(recorded).toHaveLength(0)

    stream.close()
    await settled()
    expect(recorded[0].name).toBe(COUNTED_SPAN_NAMES.agentikoA2a)
    // The must-NOT-fire case: a turn that completed is not an error.
    expect(recorded[0].status.code).toBe(SpanStatusCode.UNSET)
    expect(recorded[0].attributes[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBe(200)
  })

  it('a stream that errors mid-way ends the span then — ERROR, and NO status code although a 200 arrived', async () => {
    install(A2A_BASE)
    const stream = openStream()
    respond = stream.response
    await withA2aMethod('message/stream', () => fetch(`${A2A_BASE}/`, { method: 'POST' }))
    stream.error()
    await settled()

    // instrumentation-fetch records 0 here and leaves the status UNSET; snowplow accepts 100–599 only,
    // and 0 is the absence of a status, so the export carries the failure as ERROR instead.
    expect(ATTR_HTTP_RESPONSE_STATUS_CODE in recorded[0].attributes).toBe(false)
    expect(recorded[0].status.code).toBe(SpanStatusCode.ERROR)
    expect(recorded[0].attributes[ATTR_A2A_METHOD]).toBe('message/stream')
  })

  it('a request that never got a response (network failure) is the same: ERROR, no status code', async () => {
    install(A2A_BASE)
    respond = () => { throw new TypeError('Failed to fetch') }
    await expect(withA2aMethod('message/stream', () => fetch(`${A2A_BASE}/`, { method: 'POST' }))).rejects.toThrow()
    await settled()

    expect(ATTR_HTTP_RESPONSE_STATUS_CODE in recorded[0].attributes).toBe(false)
    expect(recorded[0].status.code).toBe(SpanStatusCode.ERROR)
  })

  it('a real HTTP failure keeps its status code, and the library\'s own ERROR', async () => {
    install(A2A_BASE)
    respond = () => new Response('upstream down', { status: 503 })
    await withA2aMethod('message/stream', () => fetch(`${A2A_BASE}/`, { method: 'POST' }))
    await settled()

    expect(recorded[0].attributes[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBe(503)
    expect(recorded[0].status.code).toBe(SpanStatusCode.ERROR)
  })
})

describe('everything else is as it was', () => {
  it('(c) a fetch that is neither A2A nor snowplow is still dropped', async () => {
    install(A2A_BASE)
    for (const url of [
      `${ORIGIN}/config/config.json`,
      `${ORIGIN}/auth/login`,
      // A look-alike sharing the A2A base's last segment as a prefix: the boundary holds.
      `${ORIGIN}/api/a2a/krateo-system/agentikox/`,
      `${ORIGIN}/api/a2a/krateo-system/autopilot/`,
    ]) {
      // eslint-disable-next-line no-await-in-loop -- one request at a time, so each span is attributable
      await fetch(url)
    }
    // Long enough for every one of them to have ended and reached the contract processor.
    await new Promise((resolve) => { setTimeout(resolve, 900) })
    expect(sent).toHaveLength(4)
    expect(recorded).toHaveLength(0)
  })

  it('(d) a snowplow fetch is still krateo.widget.fetch, untouched by the A2A allowlist', async () => {
    install(A2A_BASE)
    await fetch(`${SNOWPLOW}/call?resource=tables&extras=%7B%7D`)
    await settled()

    expect(recorded).toHaveLength(1)
    const [span] = recorded
    expect(span.name).toBe(SPAN_NAMES.widgetFetch)
    expect(span.attributes[ATTR_HTTP_ROUTE]).toBe('/call')
    expect(span.attributes[ATTR_URL_FULL]).toBe(`${SNOWPLOW}/call`)
    expect(ATTR_A2A_METHOD in span.attributes).toBe(false)
  })

  it('(e) the SLI name set is still exactly the five, and the A2A name is not in it', () => {
    expect(Object.values(SPAN_NAMES).sort()).toEqual([
      'krateo.composition.open',
      'krateo.form.submit',
      'krateo.page.load',
      'krateo.page.publish',
      'krateo.widget.fetch',
    ])
    expect(Object.values(SPAN_NAMES)).not.toContain(COUNTED_SPAN_NAMES.agentikoA2a)
    expect(COUNTED_SPAN_NAMES.agentikoA2a).toBe('krateo.agentiko.a2a')
  })

  it('with NO A2A base (absent, or cross-origin), an A2A request is dropped exactly as before', async () => {
    install(null)
    await sendTurn()
    await new Promise((resolve) => { setTimeout(resolve, 600) })

    expect(sent).toHaveLength(1)
    expect(recorded).toHaveLength(0)
  })
})

describe('agentikoA2aPrefixOf: the base, only when it is on the document origin', () => {
  it('resolves a same-origin base and drops its trailing slash', () => {
    expect(agentikoA2aPrefixOf({ AGENTIKO_API_BASE_URL: `${A2A_BASE}/` } as never)).toBe(A2A_BASE)
  })

  it('resolves the same-origin nginx location form against the document', () => {
    expect(agentikoA2aPrefixOf({ AGENTIKO_API_BASE_URL: '/agentiko' } as never)).toBe(`${ORIGIN}/agentiko`)
  })

  it('reads the deprecated AUTOPILOT_ name too, through agentikoConfig', () => {
    expect(agentikoA2aPrefixOf({ AUTOPILOT_API_BASE_URL: '/autopilot' } as never)).toBe(`${ORIGIN}/autopilot`)
  })

  it('is null when absent, empty or on another origin — which keeps today\'s behaviour', () => {
    expect(agentikoA2aPrefixOf({})).toBeNull()
    expect(agentikoA2aPrefixOf({ AGENTIKO_API_BASE_URL: '' } as never)).toBeNull()
    expect(agentikoA2aPrefixOf({ AGENTIKO_API_BASE_URL: 'https://agents.example.test/api/a2a/ns/agentiko' } as never)).toBeNull()
  })
})
