// @vitest-environment jsdom
/**
 * `krateo.form.submit` through the REAL dispatcher, because the span's boundary lives there.
 *
 * WHY NOT TEST THE EMITTER ALONE (interactions.instrumentation.test.ts already does). The emitter
 * cannot be wrong about the boundary — only the call site can, and the boundary is the part of this
 * span that is easy to get wrong in a way nothing notices. The contract says the submit is measured
 * from after validation AND after the blast-radius confirm, to the outcome being rendered. Start it
 * where a Form would naturally start it, at submit, and every gated write carries the user's own
 * confirm time: a gate that can sit unanswered for FIVE MINUTES (CONFIRM_TIMEOUT_MS) in a span
 * whose SLO is two seconds. The p95 would be a measure of how fast people read modals, and it would
 * look like a portal regression.
 *
 * So this drives `dispatchAction` itself, with a confirm that deliberately takes its time, and
 * asserts the span is SHORTER than the confirm it waited for. That is the one assertion that cannot
 * pass if the span is started at the wrong place.
 */
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { hrTimeToMilliseconds } from '@opentelemetry/core'
import { WebTracerProvider, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace-web'
import { ATTR_HTTP_REQUEST_METHOD, ATTR_HTTP_RESPONSE_STATUS_CODE, ATTR_HTTP_ROUTE } from '@opentelemetry/semantic-conventions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ContractSpanProcessor, SPAN_NAMES } from '../otel/spanContract'
import type { ResourcesRefs, WidgetAction } from '../types/Widget'

import { dispatchAction, type ActionContext } from './useHandleActions'

/** The templated route a Form submit happens on, as `useHandleAction` resolves it. */
const ROUTE = '/compositions/:namespace/:name'
/** How long the human takes over the blast-radius confirm, in this test. */
const CONFIRM_MS = 300

let recorded: ReadableSpan[] = []

const recorder = (): SpanProcessor => ({
  forceFlush: () => Promise.resolve(),
  onEnd: (span) => { recorded.push(span) },
  onStart: () => undefined,
  shutdown: () => Promise.resolve(),
})

// The same fully-mocked ActionContext the dispatcher's own suite uses, so this file tests the
// dispatcher and not a second implementation of it.
const makeCtx = (over: Partial<ActionContext> = {}): ActionContext => ({
  apiBaseUrl: 'http://sp',
  closeDrawer: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(true)),
  eventsBaseUrl: 'http://ev',
  getAccessToken: vi.fn(() => 'tok'),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  message: { destroy: vi.fn(), loading: vi.fn() } as unknown as ActionContext['message'],
  navigate: vi.fn(),
  notification: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } as unknown as ActionContext['notification'],
  openDrawer: vi.fn(),
  openModal: vi.fn(),
  provenanceEnabled: false,
  registerCleanup: vi.fn(),
  reloadRoutes: vi.fn(),
  resolveJq: vi.fn((expr: string) => Promise.resolve(`jq:${expr}`)),
  setLoading: vi.fn(),
  subscribeSse: vi.fn(() => () => undefined),
  // An older snowplow (no `call.provenance`): the AuditRecord path these tests pin.
  supportsCallProvenance: () => Promise.resolve(false),
  ...over,
})

const refs = (items: ResourcesRefs['items']): ResourcesRefs => ({ items })
const postRef = { allowed: true, id: 'ref', path: '/api/x', payload: {}, verb: 'POST' as const }
const submit: WidgetAction = { headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }
const fakeResponse = (ok: boolean, body: string): Response =>
  ({ ok, status: ok ? 201 : 500, text: () => Promise.resolve(body) } as unknown as Response)

/** A confirm the human takes `CONFIRM_MS` to answer. */
const slowConfirm = (answer: boolean) => vi.fn(() => new Promise<boolean>((resolve) => {
  setTimeout(() => resolve(answer), CONFIRM_MS)
}))

const formSubmits = (): ReadableSpan[] => recorded.filter(({ name }) => name === SPAN_NAMES.formSubmit)

beforeEach(() => {
  recorded = []
  trace.disable()
  trace.setGlobalTracerProvider(new WebTracerProvider({
    spanProcessors: [new ContractSpanProcessor(recorder(), 'https://portal.krateo.dev/content')],
  }))
})

afterEach(() => {
  trace.disable()
  vi.unstubAllGlobals()
})

describe('a Form submit, dispatched for real', () => {
  it('emits ONE krateo.form.submit with the route and the ref\'s verb', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(true, '{"metadata":{"name":"x","namespace":"ns"}}'))))

    await dispatchAction(submit, {
      interaction: { kind: 'form.submit', route: ROUTE },
      resourcesRefs: refs([postRef]),
    }, makeCtx())

    expect(formSubmits()).toHaveLength(1)
    const [span] = formSubmits()
    // The method is the REF's verb, which is where the dispatcher gets it — not a literal the test
    // and the producer could agree on while the app sends something else.
    expect(span.attributes).toEqual({
      [ATTR_HTTP_REQUEST_METHOD]: postRef.verb,
      [ATTR_HTTP_ROUTE]: ROUTE,
    })
    // MUST NOT FIRE: a successful write is not an error. The SLI reads ERROR-without-a-code as a
    // failure, so this one assertion is the difference between a 0% and a 100% error rate.
    expect(span.status.code).toBe(SpanStatusCode.UNSET)
  })

  it('STARTS PAST THE CONFIRM: the span is shorter than the gate it waited on', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(true, '{}'))))

    await dispatchAction(submit, {
      interaction: { kind: 'form.submit', route: ROUTE },
      resourcesRefs: refs([postRef]),
    }, makeCtx({ confirm: slowConfirm(true) }))

    const [span] = formSubmits()
    const elapsed = hrTimeToMilliseconds(span.endTime) - hrTimeToMilliseconds(span.startTime)
    // Generous on purpose — the point is the ~300ms the human spent, not a tight budget on a
    // stubbed fetch. A span started at submit would measure CONFIRM_MS plus the write.
    expect(elapsed).toBeLessThan(CONFIRM_MS * 0.66)
  })

  it('a DECLINED confirm emits no span at all: the user never waited on us', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await dispatchAction(submit, {
      interaction: { kind: 'form.submit', route: ROUTE },
      resourcesRefs: refs([postRef]),
    }, makeCtx({ confirm: slowConfirm(false) }))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(recorded).toHaveLength(0)
  })

  it('a refused write: ERROR status, and NO status code although res.status was in hand', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(false, '{"status":"Failure","reason":"Forbidden"}'))))

    const ctx = makeCtx()
    await dispatchAction(submit, {
      interaction: { kind: 'form.submit', route: ROUTE },
      resourcesRefs: refs([postRef]),
    }, ctx)

    // The outcome the user got, which is what the span ends on.
    expect(ctx.notification.error).toHaveBeenCalledTimes(1)
    const [span] = formSubmits()
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(span.attributes[ATTR_HTTP_RESPONSE_STATUS_CODE]).toBeUndefined()
  })

  it('a network failure ends it ERROR too, through the dispatcher\'s catch-all', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))

    const ctx = makeCtx()
    await dispatchAction(submit, {
      interaction: { kind: 'form.submit', route: ROUTE },
      resourcesRefs: refs([postRef]),
    }, ctx)

    expect(ctx.notification.error).toHaveBeenCalledTimes(1)
    expect(formSubmits()).toHaveLength(1)
    expect(formSubmits()[0].status.code).toBe(SpanStatusCode.ERROR)
  })

  it('a write that is NOT a form submit emits nothing — one row action is not an interaction', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeResponse(true, '{}'))))

    await dispatchAction(submit, { resourcesRefs: refs([postRef]) }, makeCtx())

    expect(recorded).toHaveLength(0)
  })
})
