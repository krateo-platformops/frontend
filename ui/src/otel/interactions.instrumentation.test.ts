// @vitest-environment jsdom
/**
 * The four producers, through a REAL SDK provider and the REAL contract processor.
 *
 * WHAT IS THE SUBJECT HERE. Not "does our code call `startSpan`" — a recorded call proves nothing
 * about what reaches snowplow. The subject is the span as the EXPORT SIDE sees it: its name, its
 * attribute set, its status, and whether `ContractSpanProcessor` lets it through at all. So the
 * spans below are produced by the real emitters, created by a real `WebTracerProvider` registered
 * as the global tracer provider (the same seam `tracing.ts` registers), and captured by a recording
 * processor sitting INSIDE the contract processor — exactly where `BatchSpanProcessor` sits in
 * production. A misnamed span is not recorded, because the contract processor drops it; that is the
 * failure mode this file exists to catch, and it is the one #588 shipped.
 *
 * THE INSTRUMENT IS ITSELF CHECKED, both ways. `the harness drops a span the contract does not
 * name` is the must-NOT-fire case for the recorder: without it, a recorder that captured
 * everything would make every assertion below pass for the wrong reason. Each emission then has a
 * must-fire assertion (the name, the attributes, ERROR on failure) and the must-NOT-fire one that
 * matters most for the SLI: a SUCCESSFUL operation carries no ERROR status. The consumer derives
 * `krateo.sli.error` as "5xx, or ERROR with no status code" (observability#90), so a stray ERROR on
 * a success counts every success as a failure — nothing in the browser would show it, and the
 * error-rate panel would be wrong in the reassuring direction: busy.
 *
 * EVERY ATTRIBUTE KEY IN THE ASSERTIONS COMES FROM `@opentelemetry/semantic-conventions`, for the
 * same reason the producers take them from there: a test that hardcodes `'http.route'` agrees with
 * a producer that hardcodes `'http.route'` and neither notices when the convention moves (#589).
 */
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { hrTimeToMilliseconds } from '@opentelemetry/core'
import { WebTracerProvider, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace-web'
import { ATTR_HTTP_REQUEST_METHOD, ATTR_HTTP_RESPONSE_STATUS_CODE, ATTR_HTTP_ROUTE } from '@opentelemetry/semantic-conventions'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { recordPageLoad, startCompositionOpen, startFormSubmit, startPagePublish } from './interactions'
import { ATTR_ABANDONED, ContractSpanProcessor, SPAN_NAMES } from './spanContract'

const PREFIX = 'https://portal.krateo.dev/content'
/** A composition detail route, templated as the consumer requires. */
const DETAIL = '/compositions/:namespace/:name'

let recorded: ReadableSpan[] = []

/** Stands exactly where `BatchSpanProcessor` stands in `tracing.ts`: inside the contract processor. */
const recorder = (): SpanProcessor => ({
  // `Promise.resolve()` rather than an async function with nothing to await, which only looks
  // like it does work.
  forceFlush: () => Promise.resolve(),
  onEnd: (span) => { recorded.push(span) },
  onStart: () => undefined,
  shutdown: () => Promise.resolve(),
})

beforeEach(() => {
  recorded = []
  // `disable` first: the global provider is set once per process, and a second `set` is ignored
  // with a warning — which would quietly run every case after the first against a dead recorder.
  trace.disable()
  trace.setGlobalTracerProvider(new WebTracerProvider({
    spanProcessors: [new ContractSpanProcessor(recorder(), PREFIX)],
  }))
})

afterEach(() => { trace.disable() })

/** The one span the case produced. Fails loudly when the contract processor dropped it. */
const only = (): ReadableSpan => {
  expect(recorded.map(({ name }) => name)).toHaveLength(1)

  return recorded[0]
}

describe('the recorder itself', () => {
  it('drops a span the contract does not name, so a pass below means the name is right', () => {
    trace.getTracer('probe').startSpan('krateo.composition.opened').end()
    expect(recorded).toHaveLength(0)
  })

  it('and keeps one it does', () => {
    trace.getTracer('probe').startSpan(SPAN_NAMES.compositionOpen).end()
    expect(recorded).toHaveLength(1)
  })
})

describe('krateo.page.load', () => {
  it('carries the templated route and nothing else, timed from navigation start', () => {
    recordPageLoad(DETAIL)

    const span = only()
    expect(span.name).toBe(SPAN_NAMES.pageLoad)
    // The complete attribute set, asserted as a whole: a key added "because it was available" is
    // what splits one metric series into two, so the test has to fail when one appears.
    expect(span.attributes).toEqual({ [ATTR_HTTP_ROUTE]: DETAIL })
    // A navigation has no method and no single response. The abandonment flag is accepted by
    // snowplow on the three interaction spans only — never on this one.
    expect(span.attributes[ATTR_HTTP_REQUEST_METHOD]).toBeUndefined()
    expect(span.attributes[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBeUndefined()
    expect(span.attributes[ATTR_ABANDONED]).toBeUndefined()
    // MUST NOT FIRE: a document load that happened is not an error.
    expect(span.status.code).toBe(SpanStatusCode.UNSET)
    // The boundary: the span starts at the navigation, not at the moment it was created — which is
    // the whole reason it may be created late enough for the route table to exist.
    expect(Math.abs(hrTimeToMilliseconds(span.startTime) - performance.timeOrigin)).toBeLessThan(1)
    expect(hrTimeToMilliseconds(span.endTime)).toBeGreaterThanOrEqual(hrTimeToMilliseconds(span.startTime))
  })
})

describe('krateo.composition.open', () => {
  it('resolved: the templated route, no method, no status code, no ERROR', () => {
    startCompositionOpen(DETAIL).ok()

    const span = only()
    expect(span.name).toBe(SPAN_NAMES.compositionOpen)
    expect(span.attributes).toEqual({ [ATTR_HTTP_ROUTE]: DETAIL })
    expect(span.status.code).toBe(SpanStatusCode.UNSET)
  })

  it('failed: ERROR status and NO status code — the two together are how the SLI counts it', () => {
    startCompositionOpen(DETAIL).failed('a widget read was refused')

    const span = only()
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(span.status.message).toBe('a widget read was refused')
    expect(span.attributes[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBeUndefined()
  })

  it('abandoned: the flag as boolean true, and NOT an error', () => {
    startCompositionOpen(DETAIL).abandoned()

    const span = only()
    // Boolean `true`, asserted with the type: snowplow accepts `true` and drops the ATTRIBUTE for
    // the string `"true"` or for `false`, forwarding the span without it — so a mis-typed flag
    // pollutes p95 with a duration that measures when someone left, and nothing says so.
    expect(span.attributes[ATTR_ABANDONED]).toBe(true)
    expect(span.attributes[ATTR_ABANDONED]).not.toBe('true')
    // An abandoned interaction did not FAIL. An ERROR status would move it into the error-rate
    // SLI, a worse distortion than the one the flag fixes.
    expect(span.status.code).toBe(SpanStatusCode.UNSET)
  })

  it('ends once: a later outcome cannot re-end it or overwrite its status', () => {
    const open = startCompositionOpen(DETAIL)
    open.ok()
    open.failed('too late')
    open.abandoned()

    expect(only().status.code).toBe(SpanStatusCode.UNSET)
  })
})

describe('krateo.form.submit', () => {
  it('carries the templated route AND the method, always both', () => {
    startFormSubmit({ method: 'POST', route: '/compositions/new' }).ok()

    const span = only()
    expect(span.name).toBe(SPAN_NAMES.formSubmit)
    expect(span.attributes).toEqual({
      [ATTR_HTTP_REQUEST_METHOD]: 'POST',
      [ATTR_HTTP_ROUTE]: '/compositions/new',
    })
    expect(span.status.code).toBe(SpanStatusCode.UNSET)
  })

  it('is NOT renamed to krateo.widget.fetch, although it carries the method the renamer matches on', () => {
    // The rename predicate is `http.request.method` present AND the name not already ours
    // (`isAutoHttpSpan`). This span is the only one of the four that carries the method, so the
    // ACCEPTED guard in that predicate is the only thing standing between `krateo.form.submit` and
    // being exported as a widget fetch — with its route, under a name the SLI reads as a child.
    startFormSubmit({ method: 'PUT', route: '/x/:y' }).ok()

    expect(only().name).toBe(SPAN_NAMES.formSubmit)
  })

  it('failed: ERROR and no status code, even though the dispatcher had res.status in hand', () => {
    startFormSubmit({ method: 'POST', route: '/x/:y' }).failed('the write was refused')

    const span = only()
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(span.attributes[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBeUndefined()
    // The method survives the failure: the key is always present on this span name, which is what
    // keeps it to one metric series.
    expect(span.attributes[ATTR_HTTP_REQUEST_METHOD]).toBe('POST')
  })
})

describe('krateo.page.publish', () => {
  it('published: the Builder\'s route, no method, no status code, no ERROR', () => {
    startPagePublish('/portal-builder/compose').ok()

    const span = only()
    expect(span.name).toBe(SPAN_NAMES.pagePublish)
    expect(span.attributes).toEqual({ [ATTR_HTTP_ROUTE]: '/portal-builder/compose' })
    expect(span.status.code).toBe(SpanStatusCode.UNSET)
  })

  it('refused: ERROR — nothing was published, so the press did not succeed', () => {
    startPagePublish('/portal-builder/compose').failed('the provider refused the publish')

    const span = only()
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(span.attributes[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBeUndefined()
  })

  it('abandoned: left the builder before the answer — flagged true, not failed', () => {
    startPagePublish('/portal-builder/compose').abandoned()

    const span = only()
    expect(span.attributes[ATTR_ABANDONED]).toBe(true)
    expect(span.status.code).toBe(SpanStatusCode.UNSET)
  })
})

describe('no provider registered — the default install', () => {
  it('emits nothing and throws nothing: RUM is off unless a traces endpoint is configured', () => {
    trace.disable()

    expect(() => {
      recordPageLoad(DETAIL)
      startCompositionOpen(DETAIL).ok()
      startFormSubmit({ method: 'POST', route: '/x/:y' }).failed('nowhere to send it')
      startPagePublish('/portal-builder/compose').abandoned()
    }).not.toThrow()
    expect(recorded).toHaveLength(0)
  })
})
