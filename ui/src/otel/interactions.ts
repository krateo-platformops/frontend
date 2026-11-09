/**
 * The four spans the contract reserves and NOTHING produced until now (X5 session 2).
 *
 * `spanContract.ts` names five SLI spans and its processor drops everything it does not name; only
 * `krateo.widget.fetch` had a producer, and only because the processor RENAMES auto-instrumented
 * fetch spans to it. The
 * other four — `krateo.page.load`, `krateo.composition.open`, `krateo.form.submit`,
 * `krateo.page.publish` — were declared, allowlisted by snowplow, keyed on by the SLI query, and
 * emitted by no one. This module is their producer. Where each is emitted:
 *
 *   krateo.page.load        Shell.tsx        (once per document, when the landing route resolves)
 *   krateo.composition.open WidgetPage.tsx   (useCompositionOpenSpan)
 *   krateo.form.submit      useHandleActions (runRest, past the HITL gate)
 *   krateo.page.publish     BuilderHost.tsx  (Publish pressed → the answer rendered)
 *
 * ATTRIBUTE KEYS COME FROM `@opentelemetry/semantic-conventions`, never from literals. A literal
 * outlives its meaning silently — #589 was exactly that — and the consumer keys on the string, so
 * a key that drifts in the convention must drift here too or stop matching.
 *
 * WHAT THE CONSUMER DOES WITH THESE, and the three rules it imposes (observability#90, the
 * `span_metrics` connector in contrib 0.158.0 — their system, their facts, relayed):
 *
 * 1. `http.route` MUST be the TEMPLATED route (`/compositions/:namespace/:name`), never a concrete
 *    path. Every distinct value is its own metric series and the cap is 1,000 combinations per
 *    service per agent, so a concrete path blows the cap in production and makes the metric
 *    useless. The route therefore comes from the ROUTER's matched pattern (`otel/route.ts`), never
 *    from `location.pathname`. WHERE NO TEMPLATED ROUTE CAN BE RESOLVED, NO SPAN IS EMITTED — see
 *    rule 2 for why a span without the key is the worse of the two.
 *
 * 2. Per span NAME, each attribute key is ALWAYS present or ALWAYS absent. `http.response
 *    .status_code` is a metric dimension with no default: a span name that carries it sometimes
 *    splits into TWO series. So the choice is made per span name, below, with its reason — and
 *    "the status happens to be available here" is NOT a reason to add it. Do not improve this by
 *    adding a key where it is reachable.
 *
 * 3. On failure: span status ERROR and NO status code. `krateo.sli.error` is derived as "5xx, or
 *    ERROR with no status code", so the span status alone is what makes a failure count. The
 *    mirror of that rule is the one worth fearing: an ERROR status on a SUCCESSFUL operation
 *    counts every success as a failure, which is why `interactions.instrumentation.test.ts` pins
 *    the must-NOT-fire case for each of the four.
 *
 * WHAT EACH SPAN CARRIES, and why:
 *
 *   krateo.page.load        http.route                              (rule 3 of the brief: a
 *                                                                    navigation has no method and
 *                                                                    no single response)
 *   krateo.composition.open http.route                              (an open fans out over N
 *                                                                    widget reads: there is no one
 *                                                                    method and no one status)
 *   krateo.form.submit      http.route, http.request.method          (ONE write, whose verb is
 *                                                                    known on every path — see
 *                                                                    the status-code note below)
 *   krateo.page.publish     http.route                              (the publish is a request to
 *                                                                    the provider over the draft
 *                                                                    bus, not an HTTP call this
 *                                                                    surface makes)
 *
 * NOT ONE OF THE FOUR CARRIES `http.response.status_code`. For `form.submit` the status IS known
 * when the server answered — and is NOT known when it did not (a network failure or a timeout
 * waiting for the awaited event), which is precisely the sometimes-present case rule 2 forbids. A
 * failure is therefore signalled by the span status alone, uniformly, and the series stays one.
 *
 * THE BOUNDARIES ARE THE CONTRACT TOO (docs/observability.md): a span measures what the user
 * waited for, from committed intent to visible outcome. Time spent thinking or confirming is not
 * ours. Each `start*` below records where it starts and ends, and moving one silently changes what
 * the p95 claims — which is worse than no span.
 */
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api'
import { ATTR_HTTP_REQUEST_METHOD, ATTR_HTTP_ROUTE } from '@opentelemetry/semantic-conventions'
import type { RouteObject } from 'react-router'

import { templatedRouteOf } from './route'
import { ATTR_ABANDONED, SPAN_NAMES } from './spanContract'

/**
 * The tracer's NAME IS NOT A CONTRACT and is not versioned here on purpose: snowplow's rum-ingest
 * replaces the instrumentation scope with `snowplow/rum-ingest` when it re-exports, so nothing
 * downstream can read it. `getTracer` requires an argument; this is that argument and no more.
 *
 * Looked up per span rather than cached at module load so a provider registered later — tracing is
 * a dynamic import that only runs when a traces endpoint is configured — is picked up, and so a
 * test that swaps the global provider between cases gets the one it registered.
 */
const tracer = () => trace.getTracer('krateo-frontend')

/**
 * An interaction in flight. The caller ends it exactly once, with the outcome the USER saw.
 *
 * FIRST END WINS, and later ones are ignored rather than throwing: the dispatcher's catch-all is
 * also a span ender (useHandleActions), so a throw on the tail of an already-reported outcome must
 * not re-end the span — `Span.end` is specified to warn and ignore, but relying on that would also
 * overwrite the status. An ended handle is inert.
 */
export interface InteractionSpan {
  /** The outcome the user waited for is visible. Status unset, which the consumer reads as OK. */
  ok: () => void
  /**
   * The interaction failed. Status ERROR, and NO `http.response.status_code` — see rule 3 above.
   * `reason` is a short, non-user-data description; it never carries a response body or a name.
   */
  failed: (reason?: string) => void
  /**
   * The user navigated away before the outcome. Ends the span with `krateo.interaction.abandoned`
   * = boolean `true`, which snowplow excludes from the latency SLI but still counts.
   *
   * MARKED, NOT DROPPED (docs/observability.md): a silently missing span hides the abandonment
   * rate, and ending it as OK would pollute p95 with a duration that measures when someone left.
   * Read the `ATTR_ABANDONED` doc comment before touching this: the flag is accepted ONLY as
   * boolean `true` and ONLY on the three interaction spans. `false` is never emitted — its effect
   * is identical to absence and it spends a drop-counter increment saying so.
   */
  abandoned: () => void
}

/** Wraps one raw span in the end-once handle above. */
const handleFor = (span: Span): InteractionSpan => {
  let ended = false
  const end = (finish: () => void) => {
    if (ended) {
      return
    }
    ended = true
    finish()
  }
  return {
    abandoned: () => end(() => {
      span.setAttribute(ATTR_ABANDONED, true)
      span.end()
    }),
    failed: (reason?: string) => end(() => {
      span.setStatus({ code: SpanStatusCode.ERROR, ...(reason === undefined ? {} : { message: reason }) })
      span.end()
    }),
    ok: () => end(() => { span.end() }),
  }
}

/**
 * A composition detail page opened.
 *
 * STARTS at the navigation that mounted the page — the committed intent, not the click, because a
 * click that does not navigate is not an open. ENDS when every widget read the page started has
 * settled, NOT at first paint: an empty shell is not "open", and first paint is the number that
 * would have looked best. Abandoned when the page unmounts before that.
 */
export const startCompositionOpen = (route: string): InteractionSpan =>
  handleFor(tracer().startSpan(SPAN_NAMES.compositionOpen, { attributes: { [ATTR_HTTP_ROUTE]: route } }))

/**
 * A Form widget submitted.
 *
 * STARTS once the write is committed: after antd's validation passed AND after the blast-radius
 * confirm, if one interposed. Both exclusions are deliberate and both move the number the wrong
 * way if dropped — a client-side validation failure never made the user wait on us (counting it
 * would improve the percentile by doing less), and the confirm is the user's own time, bounded by
 * a FIVE MINUTE timeout that would dominate every p95 it entered. That is why the span is started
 * by the dispatcher past the gate and not by the Form at submit.
 *
 * ENDS when the outcome is rendered: the success toast, or the error. For an event-driven action
 * (`onEventNavigateTo`) that is the awaited event's toast, not the POST's response — the user is
 * still waiting, and the "Waiting for resource…" message says so.
 *
 * `method` is the resourceRef's verb, which the dispatcher has on every path including failure.
 */
export const startFormSubmit = ({ method, route }: { method: string; route: string }): InteractionSpan =>
  handleFor(tracer().startSpan(SPAN_NAMES.formSubmit, {
    attributes: { [ATTR_HTTP_REQUEST_METHOD]: method, [ATTR_HTTP_ROUTE]: route },
  }))

/** A dispatch that IS a form submit, and the templated route it is being made from. */
export interface FormSubmitInteraction { kind: 'form.submit'; route: string }

/**
 * The box a dispatch carries its interaction span in, filled once `runRest` is past the gate.
 *
 * A box rather than a return value because the span has two enders: the outcome inside `runRest`
 * (which has a dozen exits) and the dispatcher's catch-all for whatever threw.
 */
export interface InteractionHeld { span?: InteractionSpan }

/**
 * Tag a dispatch as a form submit, resolving the route it happened on — or DON'T tag it, when no
 * templated route resolves. Lives here rather than in the dispatcher because which dispatches are
 * SLO interactions, and what route they may carry, is this module's business and not a widget's.
 *
 * `window.location` rather than a router hook: this reads at DISPATCH time, so there is nothing to
 * re-render on, and it keeps the action hook off react-router's render-coupled hooks (several
 * widget suites mock that module down to `useNavigate`).
 */
export const formSubmitInteraction = (
  routes: RouteObject[] | undefined,
  submitting: boolean
): FormSubmitInteraction | undefined => {
  if (!submitting) {
    return undefined
  }
  const route = templatedRouteOf(routes, window.location.pathname)

  return route === null ? undefined : { kind: 'form.submit', route }
}

/**
 * A page published from a Builder.
 *
 * THE BOUNDARY, DELIBERATELY, because this one spans a multi-step flow and a wrong boundary here
 * produces plausible latency that means nothing. Publish is the LAST step of authoring: hold a
 * draft, lint it, preview it, then publish. Everything before the press is authoring — minutes of
 * a person's own work — so the span STARTS when Publish is pressed (the press IS the confirmation:
 * the button is gated on the lint and the preview, and no modal interposes) and ENDS when this
 * surface renders the provider's answer — the change-request link, or the refusal. Nothing after
 * that answer is the portal's: whether the change request is merged is a human's decision in
 * another system, and a span that waited for it would measure a code review.
 *
 * A REFUSAL IS A FAILURE here: the person pressed Publish and nothing was published. It is the
 * outcome, so it ends the span — with ERROR, which puts it in the error rate rather than making a
 * fast refusal flatter the p95.
 */
export const startPagePublish = (route: string): InteractionSpan =>
  handleFor(tracer().startSpan(SPAN_NAMES.pagePublish, { attributes: { [ATTR_HTTP_ROUTE]: route } }))

/**
 * The document load, reported ONCE per document and OUTSIDE the interaction SLO — it measures
 * network and bundle size rather than anything the portal controls.
 *
 * MEASURED FROM NAVIGATION TIMING, not from when this runs: start is `performance.timeOrigin` (the
 * navigation's own start) and end is the document's `loadEventEnd`, so the duration is the document
 * load even though the span is created later. It has to be created later — the landing route is
 * knowable only once the server-driven routes have arrived, and rule 1 forbids falling back to the
 * concrete path. When the load event has not fired yet, `performance.now()` closes the span at
 * "now", which is the honest reading of "the document is usable".
 *
 * NO FAILURE PATH, and that is not an omission: a document that did not load has nothing to report
 * it with. Every emission here is a success, so none of them may carry an ERROR status — rule 3's
 * mirror, and `interactions.instrumentation.test.ts` pins it.
 */
export const recordPageLoad = (route: string): void => {
  const timing = typeof performance === 'undefined' ? null : performance
  if (timing === null) {
    return
  }
  const navigation = timing.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined
  // `loadEventEnd` is 0 until the load event has fired, and a 0 would date the span to the
  // navigation's own start and report a zero-length load.
  const elapsed = navigation && navigation.loadEventEnd > 0 ? navigation.loadEventEnd : timing.now()
  const span = tracer().startSpan(SPAN_NAMES.pageLoad, {
    attributes: { [ATTR_HTTP_ROUTE]: route },
    startTime: timing.timeOrigin,
  })
  span.end(timing.timeOrigin + elapsed)
}
