/**
 * The five span names the SLI is computed from, the spans exported outside it, and the processor
 * that enforces them (X5).
 *
 * THESE NAMES ARE A CONTRACT, not labels. The SLI query and the SLO dashboard key on them
 * literally, so renaming one is a breaking change for the consumer even though nothing here fails
 * to compile. The same is true of the BOUNDARIES recorded in docs/observability.md: moving where a
 * span starts or ends changes what the p95 claims, silently.
 *
 * WHY A PROCESSOR AND NOT JUST CAREFUL NAMING. snowplow's ingestion (snowplow#1015) accepts ONLY
 * the names it allowlists and drops everything else server-side. Auto-instrumented fetch spans are NOT
 * named any of them, so without a rename every span the portal produces is dropped — and dropped
 * invisibly: the browser sees a 2xx and nothing arrives. That is the failure this file exists to
 * prevent, and it is a failure this file ONCE CAUSED.
 *
 * THE SPAN IS IDENTIFIED BY ITS ATTRIBUTES, NOT ITS NAME, AND THAT IS THE WHOLE POINT (#588).
 * This used to match `/^HTTP [A-Z]+$/`, correct for instrumentation-fetch 0.219 and WRONG from
 * 0.223, where `_createSpan` sets `const name = normMethod` — the bare method, `GET`, per stable
 * semconv. The otel bump in #571 therefore silently stopped every fetch span being renamed, so
 * every one was dropped at `onEnd`.
 *
 * The tests did not catch it because they CONSTRUCTED `HTTP GET` by hand: the fixture and the
 * predicate shared the same wrong belief about what the library emits, so a control that broke the
 * predicate failed them exactly as it should and proved nothing about reality. A span name is the
 * library's presentation choice and it moves; `http.request.method` is a stable semantic convention
 * and is what actually means "this is an HTTP client span". Matching the attribute cannot drift
 * with a naming change, which is why the next bump will not repeat this.
 */
import { context, createContextKey, type Attributes, type Context, type Span as ApiSpan } from '@opentelemetry/api'
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-web'
import { ATTR_HTTP_REQUEST_METHOD, ATTR_HTTP_RESPONSE_STATUS_CODE, ATTR_HTTP_ROUTE, ATTR_URL_FULL } from '@opentelemetry/semantic-conventions'
// `http.url` is deprecated AND experimental on semconv's own surface, hence the `/incubating`
// subpath. Imported anyway rather than hand-typed: if semconv removes it in a minor, this file
// fails to BUILD, which is the loud version of the only other outcome — a legacy key quietly
// kept alive in a literal long after it means nothing.
import { ATTR_HTTP_URL } from '@opentelemetry/semantic-conventions/incubating'

/** The five SLI span names. With `COUNTED_SPAN_NAMES`, the whole set `ContractSpanProcessor` exports. */
export const SPAN_NAMES = {
  /** A composition detail opened: navigation intent → every initial widget resolved. */
  compositionOpen: 'krateo.composition.open',
  /** A Form widget submitted: after validation (and confirm) → outcome rendered. */
  formSubmit: 'krateo.form.submit',
  /** Document load. Instrumented, but reported OUTSIDE the interaction SLO: it measures network
   *  and bundle size rather than anything the portal controls. */
  pageLoad: 'krateo.page.load',
  /** A page published: the write confirmed (the blast-radius Confirm, not the Publish press) →
   *  the provider's answer rendered (the change-request link, or the refusal). */
  pagePublish: 'krateo.page.publish',
  /** One portal → snowplow request. The carrier of W3C traceparent, and the child that links an
   *  interaction to snowplow's own Server span. */
  widgetFetch: 'krateo.widget.fetch',
} as const

export type SpanName = typeof SPAN_NAMES[keyof typeof SPAN_NAMES]

/**
 * Spans exported OUTSIDE the SLI: no SLI keys on them. Kept out of `SPAN_NAMES` so that set stays
 * exactly what the SLI is computed from. (The set is named for its first member, which is counted
 * rather than timed. `krateo.agentiko.a2a` is timed, but what it times is the agent's work, and no
 * interaction SLI is computed from it.)
 *
 * `krateo.agentiko.claim.unbacked` — one per reply that claims an action its turn did not back
 * (`components/Agentiko/claimTelemetry.ts`). Counted, not timed: its duration means nothing. Name
 * and attributes agreed with snowplow 2026-11; its ingest forwards the span only once its allowlist
 * names it, and drops it until then (per span, as `dropped_name`: the rest of the batch is
 * unaffected).
 *
 * `krateo.agentiko.a2a` — one portal → Agentiko A2A request: the auto fetch span ITSELF, renamed by
 * `ContractSpanProcessor` when its URL sits under the configured A2A base (`AGENTIKO_API_BASE_URL`,
 * same-origin only — see `agentikoA2aPrefixOf` in tracing.ts). Because it is the same span, its
 * context IS the `traceparent` the request carried, so the gateway's `POST /api/a2a/*` span finds
 * its parent stored instead of dangling. No separate span is started. Its attributes are exactly
 * the ones `a2aAttributesOf` keeps. Name, attributes and values agreed with snowplow 2026-11
 * (snowplow#1398), whose ingest allowlists the same name.
 *
 * ITS BOUNDARY, which is NOT "time to stream start". It starts when `fetch` is called and ends when
 * the instrumentation has read the response BODY to its end: instrumentation-fetch 0.223's
 * `onSuccess` clones the response and drains the clone before ending the span, rather than ending
 * it when the headers resolve. So for `message/stream` it measures the WHOLE streamed turn, request
 * → last SSE byte. A body that errors mid-way (the rail's AbortController, a dropped connection)
 * ends the span at that moment through the library's error path, with `http.response.status_code`
 * 0 even though a 200 had arrived. A tab closed mid-stream never ends it, so nothing is exported.
 * spanContract.a2a.test.ts pins this against the installed library: a bump that changes where the
 * span ends fails there, because moving a boundary silently changes what the duration claims.
 */
export const COUNTED_SPAN_NAMES = {
  agentikoA2a: 'krateo.agentiko.a2a',
  agentikoClaimUnbacked: 'krateo.agentiko.claim.unbacked',
} as const

const ACCEPTED: ReadonlySet<string> = new Set([...Object.values(SPAN_NAMES), ...Object.values(COUNTED_SPAN_NAMES)])

/**
 * Marks a span the user navigated away from. Excluded from the latency SLI, not dropped.
 *
 * SNOWPLOW ENFORCES THIS NARROWLY, agreed 2026-11-01 — the ingest accepts it
 *
 *   ONLY as boolean `true`, and
 *   ONLY on krateo.composition.open, krateo.form.submit and krateo.page.publish.
 *
 * SNOWPLOW DROPS THE ATTRIBUTE, NOT THE SPAN. A span carrying `false`, a string, or this flag on
 * any other span name is still FORWARDED — without the attribute — and
 * `snowplow_rum_ingest_attributes_dropped_total` goes up by one. Same rule as any other non-allowlisted
 * attribute. (An earlier version of this comment said the span was discarded and the interaction
 * lost from the SLI. That was wrong, and wrong in the reassuring direction.)
 *
 * So `false` is not destructive — its effect is identical to absence, and the span counts in p95.
 * Still never emit it: it carries nothing and spends a drop-counter increment saying so.
 *
 * THE CASE TO FEAR IS THE OPPOSITE ONE. A genuinely abandoned interaction whose flag is mis-typed —
 * the string `"true"`, or `false` by mistake — is forwarded WITHOUT the flag, so it silently
 * pollutes p95 with a duration that measures when someone left. Nothing fails, nothing is missing,
 * and the latency number is quietly wrong. The only visible trace is that counter, which is why
 * snowplow counts rather than ignores. Emit a real boolean `true` or emit nothing.
 *
 * Not on krateo.widget.fetch (a child, not an interaction) and not on krateo.page.load (already
 * reported outside the interaction SLO — it measures network and bundle size).
 *
 * WHY AN ATTRIBUTE AND NOT A SPAN STATUS: an abandoned interaction did not fail. `StatusCode.ERROR`
 * would move it into the error-rate SLI, which is a worse distortion than the one it fixes. It
 * still counts for throughput; it must only be excluded from p95, because its duration measures
 * when someone left rather than when the portal finished.
 *
 * NOTHING EMITS THIS YET. The three interaction spans are part 2 (X5 session 2). snowplow is
 * allowlisting it ahead of that, knowing it will carry no traffic until then.
 */
export const ATTR_ABANDONED = 'krateo.interaction.abandoned'

/**
 * `http.request.method` — the stable-semconv attribute every HTTP client span carries — and
 * `http.route`, below, both IMPORTED FROM THE CONVENTION PACKAGE rather than written out.
 *
 * This file's whole subject is that a span's NAME is the library's presentation choice and moves,
 * while the semantic attribute does not. Spelling the attribute by hand would reintroduce exactly
 * the drift the predicate exists to survive: a literal outlives its meaning silently, which is
 * what #589 was.
 */

/**
 * An auto-instrumented HTTP client span: one carrying the semconv method attribute that is not
 * already one of ours.
 *
 * Deliberately NOT a name test — see the file header. The `ACCEPTED` guard matters: a renamed
 * `krateo.widget.fetch` still carries the attribute, and `onStart` must not treat a span it has
 * already named as a fresh candidate.
 *
 * `attributes?.` is load-bearing, not defensive noise. `onStart` runs for EVERY span the SDK
 * creates, including ones a manual `startSpan` made with no attributes at all — and a predicate
 * that throws in `onStart` takes the tracer down rather than losing one span. Caught by running
 * this file's tests alongside the hand-built fixtures in spanContract.test.ts, which is the only
 * reason it was caught before shipping.
 */
const isAutoHttpSpan = (span: Span): boolean =>
  !ACCEPTED.has(span.name) && typeof span.attributes?.[ATTR_HTTP_REQUEST_METHOD] === 'string'

/**
 * THE URL KEYS THIS FILE READS. One array, because it is one contract.
 *
 * Both `redactUrlAttributes` (write side) and `urlOf` (read side) walk this list, and they used to
 * each carry their own copy of the literal — so the two could disagree about which key a span's URL
 * lives under while both compiled and both passed. Same shape of defect as #588: a belief about the
 * library held in a literal, in more than one place, with nothing checking it against the library.
 *
 * `url.full` is what the INSTALLED instrumentation actually emits — instrumentation-fetch 0.223's
 * `_createSpan` sets `ATTR_URL_FULL`, and instrumentation-xml-http-request does the same. (An
 * earlier comment here claimed `http.url` was "what the installed instrumentation emits". That was
 * wrong; nothing in either package has written `http.url` since the stable-semconv move.)
 *
 * `http.url` is kept for the older convention, so a pin to an earlier instrumentation still works.
 * Order is read-preference and is NOT load-bearing — a span carries one or the other.
 *
 * WHY THIS IS PINNED BY A TEST AND NOT ONLY BY A COMMENT: if a bump moves the URL to a THIRD key,
 * `urlOf` returns null, `isExportable` returns false, and every `krateo.widget.fetch` span is
 * dropped before export — invisibly, with a green suite. spanContract.instrumentation.test.ts
 * asserts the installed instrumentation's URL key is a member of this array, so that bump fails a
 * test instead.
 */
export const URL_ATTRS = [ATTR_HTTP_URL, ATTR_URL_FULL] as const

/**
 * Is `url` under `prefix`, matching at a PATH BOUNDARY?
 *
 * A bare `startsWith` is wrong and the mistake is easy to miss: with a prefix of
 * `https://portal.krateo.dev/content`, a bare prefix test also matches
 * `https://portal.krateo.dev/contentious/call` — a different path that happens to share the first
 * seven characters of its segment. Same family as matching a host by prefix and admitting
 * `portal.krateo.dev.evil.test`. So the URL must equal the prefix or continue with `/`.
 */
const underPrefix = (url: string, prefix: string): boolean =>
  url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`)

/** Set by `redactUrlAttributes`: the path relative to the snowplow base, with no query. */
export const ATTR_ROUTE: typeof ATTR_HTTP_ROUTE = ATTR_HTTP_ROUTE

/**
 * Replace a span's raw URL attributes with a query-free path, and record the route.
 *
 * Called from the instrumentations' `applyCustomAttributesOnSpan`, which is the ONLY point where
 * the span is still mutable — by the time the contract processor sees it on `onEnd` the attributes
 * are frozen behind a `ReadableSpan`.
 *
 * WHY THE QUERY MUST GO HERE rather than at the server. `?extras={…}` carries whatever the user
 * filtered or searched for, and a page name is not ours to ship. snowplow allowlists attributes
 * independently, but a value it would reject is a value the browser should not have sent — the
 * only copy that never leaks is the one never transmitted.
 */
export const redactUrlAttributes = (span: ApiSpan, snowplowPrefix: string | null): void => {
  // `applyCustomAttributesOnSpan` hands us the API Span, which exposes no attribute getter, so the
  // raw URL is read through the SDK shape the web instrumentations actually pass.
  const readable = span as unknown as { attributes?: Record<string, unknown> }
  let raw: string | null = null
  for (const key of URL_ATTRS) {
    const value = readable.attributes?.[key]
    if (typeof value === 'string' && value.length > 0) {
      raw = value
      break
    }
  }
  if (raw === null) {
    return
  }

  let withoutQuery = raw
  try {
    const url = new URL(raw, window.location.origin)
    withoutQuery = `${url.origin}${url.pathname}`
    if (snowplowPrefix !== null && underPrefix(withoutQuery, snowplowPrefix)) {
      const route = withoutQuery.slice(snowplowPrefix.length) || '/'
      span.setAttribute(ATTR_ROUTE, route)
    }
  } catch {
    // Unparseable: strip from the first `?` so a query cannot survive a URL we cannot parse.
    withoutQuery = raw.split('?')[0]
  }

  for (const key of URL_ATTRS) {
    if (typeof readable.attributes?.[key] === 'string') {
      span.setAttribute(key, withoutQuery)
    }
  }
}

/**
 * The URL attribute auto-instrumentation records — read through the shared `URL_ATTRS`, so this
 * cannot drift from the write side in `redactUrlAttributes`. A bump that moves the URL to a key
 * outside that list turns every span into "origin unknown", which drops them all; the pin against
 * the installed instrumentation lives in spanContract.instrumentation.test.ts.
 */
const urlOf = (span: Pick<ReadableSpan, 'attributes'>): string | null => {
  for (const key of URL_ATTRS) {
    const value = span.attributes[key]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return null
}

/** True when the span's URL sits under `prefix` (path boundary). No prefix, or no URL: false. */
const spanUnder = (span: Pick<ReadableSpan, 'attributes'>, prefix: string | null): boolean => {
  if (prefix === null) {
    return false
  }
  const url = urlOf(span)
  if (url === null) {
    // No URL attribute: we cannot tell whose request it was, and "cannot tell" must not read as
    // "ours". Dropping is the honest choice — the alternative exports spans of unknown origin.
    return false
  }
  try {
    return underPrefix(new URL(url, window.location.origin).href, prefix)
  } catch {
    return false
  }
}

/**
 * `http.route` on every `krateo.agentiko.a2a` span: ALWAYS this literal template, never the
 * concrete path. snowplow refuses a concrete route (snowplow#1398), and every distinct value would
 * be its own metric series. The concrete path also names the namespace and the agent, which the
 * template deliberately does not. The same value whether the configured base is the gateway's
 * `…/api/a2a/<ns>/<agent>` or the same-origin nginx location `/<agent>`, because nginx rewrites the
 * latter to the former and the template describes the request the gateway serves.
 */
export const A2A_ROUTE = '/api/a2a/{namespace}/{agent}'

/** The JSON-RPC method of the A2A request a `krateo.agentiko.a2a` span measures. Optional. */
export const ATTR_A2A_METHOD = 'krateo.a2a.method'

/**
 * The values `krateo.a2a.method` may carry: a CLOSED enum agreed with snowplow (snowplow#1398),
 * which drops and counts any other value. So any other method — `tasks/resubscribe`, which the
 * transport sends to resume a dropped stream, or a method a future transport adds — is OMITTED
 * rather than sent, and the span is still exported without it.
 */
export const A2A_METHODS: ReadonlySet<string> = new Set(['message/send', 'message/stream', 'tasks/get'])

/**
 * Where the transport's JSON-RPC method travels to the processor: the ACTIVE CONTEXT at the moment
 * `fetch` is called, which is the parent context the SDK hands `onStart` for the span the fetch
 * instrumentation creates inside that call.
 *
 * Why not read the request body: the body is the user's message, and parsing it to find one field
 * means the telemetry path reading content it must never ship. The transport knows the method
 * because it wrote it; it says so here instead.
 */
const A2A_METHOD_KEY = createContextKey('krateo.a2a.method')

/**
 * Run `fn` — the transport's `fetch` call — with its JSON-RPC method on the active context, so the
 * A2A span that call creates records it. Without a registered tracer (telemetry off) the context
 * API is a no-op passthrough, so this costs nothing on an install that does not collect traces.
 */
export const withA2aMethod = <T>(method: string, fn: () => T): T =>
  context.with(context.active().setValue(A2A_METHOD_KEY, method), fn)

/** The method on a context, when it is one of the agreed values; otherwise nothing. */
const a2aMethodOf = (ctx: Context): string | null => {
  const value = ctx.getValue(A2A_METHOD_KEY)
  return typeof value === 'string' && A2A_METHODS.has(value) ? value : null
}

/** The attributes copied from the span as the instrumentation recorded them. */
const A2A_COPIED = [ATTR_HTTP_REQUEST_METHOD, ATTR_HTTP_RESPONSE_STATUS_CODE] as const

/**
 * The ONLY attributes a `krateo.agentiko.a2a` span exports: `http.request.method`,
 * `http.response.status_code`, `http.route` (the template) and, when it is an agreed value,
 * `krateo.a2a.method`.
 *
 * An ALLOWLIST, built fresh, rather than a list of things to strip. Everything else the
 * instrumentation recorded goes: `url.full` (it names the namespace and agent; `redactUrlAttributes`
 * already took its query), `server.address`, `server.port`, `error.type`,
 * `http.request.method_original`, and whatever a future instrumentation adds. A strip list would
 * export the next new attribute by default; this exports nothing it was not told to. The request's
 * headers and body never become attributes at all — instrumentation-fetch does not record them.
 */
export const a2aAttributesOf = (attributes: Attributes): Attributes => {
  const kept: Attributes = { [ATTR_HTTP_ROUTE]: A2A_ROUTE }
  for (const key of A2A_COPIED) {
    if (attributes[key] !== undefined) {
      kept[key] = attributes[key]
    }
  }
  const method = attributes[ATTR_A2A_METHOD]
  if (typeof method === 'string' && A2A_METHODS.has(method)) {
    kept[ATTR_A2A_METHOD] = method
  }
  return kept
}

/**
 * The same ended span with only `attributes` replaced. Everything else — above all `spanContext`,
 * which is the traceparent the request carried, and the parent — is the original's, read through.
 *
 * Every `ReadableSpan` field is written out, so if the SDK adds one this stops COMPILING rather than
 * exporting a span with the new field silently missing.
 */
const withAttributes = (span: ReadableSpan, attributes: Attributes): ReadableSpan => ({
  attributes,
  droppedAttributesCount: span.droppedAttributesCount,
  droppedEventsCount: span.droppedEventsCount,
  droppedLinksCount: span.droppedLinksCount,
  duration: span.duration,
  ended: span.ended,
  endTime: span.endTime,
  events: span.events,
  instrumentationScope: span.instrumentationScope,
  kind: span.kind,
  links: span.links,
  name: span.name,
  parentSpanContext: span.parentSpanContext,
  resource: span.resource,
  spanContext: () => span.spanContext(),
  startTime: span.startTime,
  status: span.status,
})

/**
 * Renames auto-instrumented portal → snowplow requests to `krateo.widget.fetch`, and DROPS every
 * other span the contract does not name.
 *
 * Dropping client-side rather than letting snowplow drop it is deliberate: the ingestion has a
 * size cap and a per-user rate limit, so an unexportable span still costs budget a real one needs.
 *
 * MATCHED ON A PREFIX, NOT AN ORIGIN. An origin check is right only where snowplow has an origin
 * of its own. On a same-origin install — 057 serves portal, snowplow and authn all from
 * `portal.krateo.dev` — "same origin as snowplow" is also true of authn calls and of the SPA's own
 * `/config/config.json`, so an origin check would rename and export those as widget fetches. The
 * prefix `https://portal.krateo.dev/content` is what identifies a snowplow call. It is the same
 * derivation the propagator uses, so "we propagate here" and "we export from here" cannot drift.
 *
 * AND renames auto-instrumented portal → Agentiko A2A requests to `krateo.agentiko.a2a`: the same
 * attribute test, a URL under `agentikoA2aPrefix` instead. That prefix is null — and A2A requests
 * stay exactly as before, renamed `krateo.widget.fetch` and dropped at `onEnd` for not being under
 * the snowplow base — when no A2A base is configured or it is on another origin (tracing.ts).
 */
export class ContractSpanProcessor implements SpanProcessor {
  private readonly inner: SpanProcessor
  private readonly snowplowPrefix: string | null
  private readonly agentikoA2aPrefix: string | null

  constructor(inner: SpanProcessor, snowplowPrefix: string | null, agentikoA2aPrefix: string | null = null) {
    this.inner = inner
    this.snowplowPrefix = snowplowPrefix
    this.agentikoA2aPrefix = agentikoA2aPrefix
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush()
  }

  /**
   * The rename happens on START, not on END.
   *
   * `ReadableSpan.name` is read-only, so by `onEnd` the name cannot be changed — only the mutable
   * `Span` handed to `onStart` can be renamed, via `updateName`. Attempting it at the end is the
   * obvious implementation and silently does nothing.
   *
   * The A2A test needs the URL at START, and has it: instrumentation-fetch passes `url.full` in the
   * `startSpan` attributes, and the SDK sets those before calling `onStart`. `krateo.a2a.method` is
   * set here too, because `parentContext` — where the transport put it — exists only here.
   */
  onStart(span: Span, parentContext: Context): void {
    if (isAutoHttpSpan(span)) {
      if (spanUnder(span, this.agentikoA2aPrefix)) {
        span.updateName(COUNTED_SPAN_NAMES.agentikoA2a)
        const method = a2aMethodOf(parentContext)
        if (method !== null) {
          span.setAttribute(ATTR_A2A_METHOD, method)
        }
      } else {
        span.updateName(SPAN_NAMES.widgetFetch)
      }
    }
    this.inner.onStart(span, parentContext)
  }

  onEnd(span: ReadableSpan): void {
    if (!ACCEPTED.has(span.name)) {
      return
    }
    // A renamed fetch span is only ours if it went to a backend we export for. A fetch to a static
    // asset or a third party carries no traceparent and must not be exported either.
    if (span.name === SPAN_NAMES.widgetFetch && !spanUnder(span, this.snowplowPrefix)) {
      return
    }
    if (span.name === COUNTED_SPAN_NAMES.agentikoA2a) {
      // The same rule, against the A2A base — checked BEFORE the allowlist below drops the URL.
      if (!spanUnder(span, this.agentikoA2aPrefix)) {
        return
      }
      this.inner.onEnd(withAttributes(span, a2aAttributesOf(span.attributes)))
      return
    }
    this.inner.onEnd(span)
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }
}
