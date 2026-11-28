// @vitest-environment jsdom
/**
 * A widget read's `krateo.widget.fetch` span: joined to snowplow by the `traceparent` the request
 * carries (already true on main — the fetch instrumentation injects it; pinned here), and naming the
 * widget with EXACTLY the allowed attributes (widgetIdentity.ts), no identity anywhere.
 */
import { context, propagation, trace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { WebTracerProvider, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace-web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWidgetPage, type WidgetRead } from '../hooks/widgetRequest'

import { ContractSpanProcessor, fetchSpanHook, SPAN_NAMES } from './spanContract'
import { WIDGET_IDENTITY_ATTRS } from './widgetIdentity'

const ORIGIN = window.location.origin
const SNOWPLOW = `${ORIGIN}/content`
const realFetch = globalThis.fetch

let recorded: ReadableSpan[] = []
let sent: Array<{ headers: Headers; url: string }> = []
let instrumentation: FetchInstrumentation | null = null

const recorder = (): SpanProcessor => ({
  forceFlush: () => Promise.resolve(),
  onEnd: (span) => { recorded.push(span) },
  onStart: () => undefined,
  shutdown: () => Promise.resolve(),
})

const install = () => {
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ headers: new Headers(init?.headers), url: input instanceof Request ? input.url : String(input) })
    return Promise.resolve(new Response(JSON.stringify({ kind: 'Table' }), { status: 200 }))
  })
  const provider = new WebTracerProvider({ spanProcessors: [new ContractSpanProcessor(recorder(), SNOWPLOW, null)] })
  provider.register({ propagator: new W3CTraceContextPropagator() })
  instrumentation = new FetchInstrumentation({ applyCustomAttributesOnSpan: fetchSpanHook(SNOWPLOW) })
  instrumentation.setTracerProvider(provider)
}

const read = (url: string, extras = false): WidgetRead => ({
  extrasInBody: extras,
  extrasParam: extras ? '{"a":"b"}' : '',
  // The signed-in transport adds a bearer here; the span must never see it.
  transport: { fetch: (target, init) => fetch(target, { ...init, headers: { ...init?.headers, Authorization: 'Bearer SECRET-TOKEN' } }), onUnauthorized: () => undefined },
  url,
})

const callUrl = `${SNOWPLOW}/call?apiVersion=widgets.templates.krateo.io%2Fv1beta1&resource=tables&name=compositions-table&namespace=krateo-system`

const widgetSpans = () => vi.waitFor(() => { expect(recorded.length).toBeGreaterThan(0) }, { timeout: 3000 })

beforeEach(() => {
  recorded = []
  sent = []
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

describe('a widget /call', () => {
  it('carries a traceparent whose ids are the krateo.widget.fetch span (already true before the attributes)', async () => {
    install()
    await fetchWidgetPage(read(callUrl), {})
    await widgetSpans()
    const header = sent[0].headers.get('traceparent')
    expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/)
    const [, traceId, spanId] = String(header).split('-')
    expect(recorded[0].name).toBe(SPAN_NAMES.widgetFetch)
    expect(recorded[0].spanContext()).toMatchObject({ spanId, traceId })
  })

  it('names the widget with exactly the allowed krateo.* attributes, and no identity anywhere', async () => {
    install()
    await fetchWidgetPage(read(callUrl), {})
    await widgetSpans()
    const attrs = recorded[0].attributes
    expect(Object.keys(attrs).filter((key) => key.startsWith('krateo.')).sort()).toEqual([...WIDGET_IDENTITY_ATTRS].sort())
    expect(attrs).toMatchObject({
      'krateo.widget.name': 'compositions-table',
      'krateo.widget.namespace': 'krateo-system',
      'krateo.widget.resource': 'tables',
    })
    expect([...WIDGET_IDENTITY_ATTRS].sort()).toEqual(['krateo.widget.name', 'krateo.widget.namespace', 'krateo.widget.resource'])
    const everything = JSON.stringify([attrs, recorded[0].events, recorded[0].links])
    expect(everything).not.toMatch(/SECRET-TOKEN|Bearer|username|groups|email/i)
  })

  it('names the widget on the body-extras read (POST /call/read) and keeps extras out of the span', async () => {
    install()
    await fetchWidgetPage(read(callUrl, true), {})
    await widgetSpans()
    expect(recorded[0].attributes['krateo.widget.name']).toBe('compositions-table')
    expect(JSON.stringify(recorded[0].attributes)).not.toContain('"a"')
  })

  it('omits an identifier that is not a Kubernetes name', async () => {
    install()
    await fetchWidgetPage(read(`${SNOWPLOW}/call?resource=tables&name=Not%20A%20Name&namespace=ns`), {})
    await widgetSpans()
    expect(Object.keys(recorded[0].attributes).filter((key) => key.startsWith('krateo.'))).toEqual([])
  })
})

describe('a fetch that is not a widget read', () => {
  it('carries no widget attributes', async () => {
    install()
    await fetch(`${SNOWPLOW}/other?resource=tables&name=x&namespace=y`)
    await widgetSpans()
    expect(Object.keys(recorded[0].attributes).filter((key) => key.startsWith('krateo.'))).toEqual([])
  })

  it('to a third party carries no traceparent and no span', async () => {
    install()
    await fetch('https://third-party.example/call?resource=tables&name=x&namespace=y')
    await new Promise((resolve) => { setTimeout(resolve, 400) })
    expect(sent[0].headers.get('traceparent')).toBeNull()
    expect(recorded).toHaveLength(0)
  })
})
