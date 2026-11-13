// @vitest-environment jsdom
/**
 * The auto-instrumented request spans as the contract processor exports them, through the REAL
 * libraries:
 *
 *   - `krateo.agentiko.a2a`: Agentiko's A2A request, exported as the SAME span whose context the
 *     request carried as `traceparent` — so the gateway's `POST /api/a2a/*` span, which already has
 *     that span as its parent, finds the parent stored;
 *   - a request that got NO response: an abort is not exported, any other failure is `ERROR` with no
 *     status code, for `krateo.widget.fetch` over fetch and XHR alike.
 *
 * EVERY SPAN HERE IS MADE BY THE INSTALLED LIBRARY (#588). The real `FetchInstrumentation` patches a
 * stub `fetch` (and the real `XMLHttpRequestInstrumentation` jsdom's XHR), a real
 * `WebTracerProvider` creates the span and calls the real `ContractSpanProcessor.onStart`, the real
 * W3C propagator writes the header, and a recorder sits inside the contract processor exactly where
 * `BatchSpanProcessor` sits in tracing.ts. The A2A requests go through the real Agentiko transport.
 * Nothing is hand-named and no outcome is hand-written: a hand-built `POST` span would agree with
 * the predicate about what the library emits, and #588 shipped on exactly that. Above all the status
 * code 0 and the abort record are the library's own, which is what the abort rule reads.
 *
 * The stub fetch stands in for the network only. It records the headers the instrumentation
 * injected, so the trace and span id the request CARRIED can be compared with the span exported.
 * No session, token or credential is involved: the transport's Bearer helper finds no stored
 * session and sends no Authorization header.
 */
import { context, propagation, SpanStatusCode, trace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request'
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
  fetchSpanHook,
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
let respond: () => Response | Promise<Response> = () => new Response(COMPLETED, { status: 200 })
let instrumentation: FetchInstrumentation | null = null
let xhrInstrumentation: XMLHttpRequestInstrumentation | null = null
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
 * the fetch instrumentation with tracing.ts's own `applyCustomAttributesOnSpan` (`fetchSpanHook`).
 * The stub `fetch` is installed BEFORE the instrumentation is constructed, because construction is
 * what patches it.
 *
 * The stub honours the request's signal as fetch does: aborting it rejects the fetch with the
 * signal's abort REASON — a DOMException named `AbortError` for a bare `abort()`, a `TimeoutError`
 * for `AbortSignal.timeout()` or the portal's `fetchWithTimeout`.
 */
const install = (a2aPrefix: string | null, snowplow: string = SNOWPLOW) => {
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ headers: new Headers(init?.headers), url: input instanceof Request ? input.url : input.toString() })
    const signal = init?.signal
    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }
      signal?.addEventListener('abort', () => { reject(signal.reason) })
      // Through `.then`, so a `respond` that throws is a REJECTED fetch, as a network failure is.
      Promise.resolve().then(respond).then(resolve, reject)
    })
  })
  const provider = new WebTracerProvider({
    spanProcessors: [new ContractSpanProcessor(recorder(), snowplow, a2aPrefix)],
  })
  provider.register({ propagator: new W3CTraceContextPropagator() })
  instrumentation = new FetchInstrumentation({ applyCustomAttributesOnSpan: fetchSpanHook(snowplow) })
  instrumentation.setTracerProvider(provider)
  // As tracing.ts installs it: the XHR hook only redacts, because XHR records an abort itself.
  xhrInstrumentation = new XMLHttpRequestInstrumentation({
    applyCustomAttributesOnSpan: (span) => { redactUrlAttributes(span, snowplow) },
  })
  xhrInstrumentation.setTracerProvider(provider)
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
  xhrInstrumentation?.disable()
  xhrInstrumentation = null
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

/**
 * A response whose body stays open until `close` is called, as a streamed turn does. `error` fails
 * the body the way an aborted request's body fails: with the signal's default reason, `AbortError`.
 */
const openStream = () => {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const body = new ReadableStream<Uint8Array>({ start: (ctrl) => { controller = ctrl } })
  return {
    close: () => { controller?.close() },
    error: () => { controller?.error(new DOMException('aborted', 'AbortError')) },
    response: () => new Response(body, { status: 200 }),
  }
}

const sleep = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms) })

/** A request that never answers, until its signal aborts it. */
const never = () => new Promise<Response>(() => undefined)

describe('where the span ENDS, pinned against the installed library', () => {
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

describe('krateo.widget.fetch with NO response: an abort is dropped, a failure is ERROR with no status code', () => {
  const CALL = `${SNOWPLOW}/call?resource=tables`

  it('an ABORTED fetch is not exported — it is not a request outcome', async () => {
    install(null)
    respond = never
    const controller = new AbortController()
    const pending = fetch(CALL, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow()
    // The control, in the same harness: an answered call IS exported, so an empty result below is
    // the rule at work and not a dead recorder.
    respond = () => new Response('{}', { status: 200 })
    await fetch(CALL)
    await settled()
    await sleep(400)

    expect(sent).toHaveLength(2)
    expect(recorded).toHaveLength(1)
    expect(recorded[0].attributes[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBe(200)
  })

  it('a fetch aborted while its body is still arriving is not exported either', async () => {
    install(null)
    const stream = openStream()
    respond = stream.response
    await fetch(CALL)
    stream.error()
    await sleep(700)

    expect(sent).toHaveLength(1)
    expect(recorded).toHaveLength(0)
  })

  it('a NETWORK failure is exported: ERROR, and no http.response.status_code', async () => {
    install(null)
    respond = () => { throw new TypeError('Failed to fetch') }
    await expect(fetch(CALL)).rejects.toThrow('Failed to fetch')
    await settled()

    const [span] = recorded
    expect(span.name).toBe(SPAN_NAMES.widgetFetch)
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(ATTR_HTTP_RESPONSE_STATUS_CODE in span.attributes).toBe(false)
    // Nothing else about it changes: still the redacted URL and the route.
    expect(span.attributes[ATTR_HTTP_ROUTE]).toBe('/call')
    expect(span.attributes[ATTR_URL_FULL]).toBe(`${SNOWPLOW}/call`)
    expect(Object.keys(span.attributes).some((key) => key.startsWith('krateo.internal'))).toBe(false)
  })

  it('a TIMEOUT is a failure, not an abort, even though an AbortSignal delivers it', async () => {
    install(null)
    respond = never
    await expect(fetch(CALL, { signal: AbortSignal.timeout(20) })).rejects.toThrow()
    await settled()

    expect(recorded[0].status.code).toBe(SpanStatusCode.ERROR)
    expect(ATTR_HTTP_RESPONSE_STATUS_CODE in recorded[0].attributes).toBe(false)
  })

  it('a 200 and a 503 are exported unchanged — the 503 keeps its status code and the library\'s ERROR', async () => {
    install(null)
    respond = () => new Response('{}', { status: 200 })
    await fetch(CALL)
    await settled()
    respond = () => new Response('down', { status: 503 })
    await fetch(CALL)
    await vi.waitFor(() => { expect(recorded).toHaveLength(2) }, { timeout: 3000 })

    const [ok, unavailable] = recorded
    const { port } = new URL(ORIGIN)
    const asRecorded = {
      [ATTR_HTTP_REQUEST_METHOD]: 'GET',
      [ATTR_HTTP_ROUTE]: '/call',
      [ATTR_URL_FULL]: `${SNOWPLOW}/call`,
      'server.address': new URL(ORIGIN).hostname,
      ...(port ? { 'server.port': Number(port) } : {}),
    }
    expect(ok.attributes).toEqual({ ...asRecorded, [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200 })
    expect(ok.status.code).toBe(SpanStatusCode.UNSET)
    expect(unavailable.attributes).toEqual({ ...asRecorded, 'error.type': '503', [ATTR_HTTP_RESPONSE_STATUS_CODE]: 503 })
    expect(unavailable.status.code).toBe(SpanStatusCode.ERROR)
  })
})

describe('the same rule over XHR, which snowplow uploads still use (widgets/Upload)', () => {
  /** Port 9 refuses: a request there fails on the network, a real `error` event. */
  const UNREACHABLE = 'http://127.0.0.1:9/content'

  const xhr = (url: string, abort: boolean) => new Promise<void>((resolve) => {
    const request = new XMLHttpRequest()
    request.open('GET', url)
    request.addEventListener('loadend', () => { resolve() })
    request.send()
    if (abort) {
      request.abort()
    }
  })

  it('an ABORTED XHR is not exported — XHR records the abort itself, as an `abort` span event', async () => {
    install(null, UNREACHABLE)
    await xhr(`${UNREACHABLE}/call`, true)
    // The control: a failing XHR in the same harness IS exported.
    await xhr(`${UNREACHABLE}/call`, false)
    await settled()
    await sleep(400)

    expect(recorded).toHaveLength(1)
    expect(recorded[0].events.map(({ name }) => name)).not.toContain('abort')
  })

  it('a network failure stays as the library records it: ERROR, no status code', async () => {
    install(null, UNREACHABLE)
    await xhr(`${UNREACHABLE}/call`, false)
    await settled()

    expect(recorded[0].name).toBe(SPAN_NAMES.widgetFetch)
    expect(recorded[0].status.code).toBe(SpanStatusCode.ERROR)
    expect(ATTR_HTTP_RESPONSE_STATUS_CODE in recorded[0].attributes).toBe(false)
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
