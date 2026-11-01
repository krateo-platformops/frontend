/**
 * The five span names the SLI is computed from, and the processor that enforces them (X5).
 *
 * THESE NAMES ARE A CONTRACT, not labels. The SLI query and the SLO dashboard key on them
 * literally, so renaming one is a breaking change for the consumer even though nothing here fails
 * to compile. The same is true of the BOUNDARIES recorded in docs/observability.md: moving where a
 * span starts or ends changes what the p95 claims, silently.
 *
 * WHY A PROCESSOR AND NOT JUST CAREFUL NAMING. snowplow's ingestion (snowplow#1015) accepts ONLY
 * these five names and drops everything else server-side. Auto-instrumented fetch spans are NOT
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
import type { Context, Span as ApiSpan } from '@opentelemetry/api'
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-web'

/** The complete accepted set. snowplow drops anything else; so does `ContractSpanProcessor`. */
export const SPAN_NAMES = {
  /** A composition detail opened: navigation intent → every initial widget resolved. */
  compositionOpen: 'krateo.composition.open',
  /** A Form widget submitted: after validation (and confirm) → outcome rendered. */
  formSubmit: 'krateo.form.submit',
  /** Document load. Instrumented, but reported OUTSIDE the interaction SLO: it measures network
   *  and bundle size rather than anything the portal controls. */
  pageLoad: 'krateo.page.load',
  /** A page published: publish confirmed → published state visible. */
  pagePublish: 'krateo.page.publish',
  /** One portal → snowplow request. The carrier of W3C traceparent, and the child that links an
   *  interaction to snowplow's own Server span. */
  widgetFetch: 'krateo.widget.fetch',
} as const

export type SpanName = typeof SPAN_NAMES[keyof typeof SPAN_NAMES]

const ACCEPTED: ReadonlySet<string> = new Set(Object.values(SPAN_NAMES))

/** Marks a span the user navigated away from. Excluded from the latency SLI, not dropped. */
export const ATTR_ABANDONED = 'krateo.interaction.abandoned'

/** `http.request.method` — the stable-semconv attribute every HTTP client span carries. */
const ATTR_HTTP_REQUEST_METHOD = 'http.request.method'

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

/** The URL attributes auto-instrumentation writes. Older convention first; both are handled. */
const URL_ATTRS = ['http.url', 'url.full'] as const

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
export const ATTR_ROUTE = 'http.route'

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
 * The URL attribute auto-instrumentation records. `http.url` is the older convention and what the
 * installed instrumentation emits; `url.full` is the newer one. Both are read so a dependency bump
 * cannot silently turn every span into "origin unknown" — which would drop them all.
 */
const urlOf = (span: ReadableSpan): string | null => {
  for (const key of ['http.url', 'url.full'] as const) {
    const value = span.attributes[key]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return null
}

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
 */
export class ContractSpanProcessor implements SpanProcessor {
  private readonly inner: SpanProcessor
  private readonly snowplowPrefix: string | null

  constructor(inner: SpanProcessor, snowplowPrefix: string | null) {
    this.inner = inner
    this.snowplowPrefix = snowplowPrefix
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
   */
  onStart(span: Span, parentContext: Context): void {
    if (isAutoHttpSpan(span)) {
      span.updateName(SPAN_NAMES.widgetFetch)
    }
    this.inner.onStart(span, parentContext)
  }

  onEnd(span: ReadableSpan): void {
    if (!ACCEPTED.has(span.name)) {
      return
    }
    // A renamed fetch span is only ours if it went to a backend we export for. A fetch to a static
    // asset or a third party carries no traceparent and must not be exported either.
    if (span.name === SPAN_NAMES.widgetFetch && !this.isExportable(span)) {
      return
    }
    this.inner.onEnd(span)
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }

  /** True when the span's URL sits under the snowplow base. */
  private isExportable(span: ReadableSpan): boolean {
    if (this.snowplowPrefix === null) {
      return false
    }
    const url = urlOf(span)
    if (url === null) {
      // No URL attribute: we cannot tell whose request it was, and "cannot tell" must not read as
      // "ours". Dropping is the honest choice — the alternative exports spans of unknown origin.
      return false
    }
    try {
      return underPrefix(new URL(url, window.location.origin).href, this.snowplowPrefix)
    } catch {
      return false
    }
  }
}
