/**
 * The five span names the SLI is computed from, and the processor that enforces them (X5).
 *
 * THESE NAMES ARE A CONTRACT, not labels. The SLI query and the SLO dashboard key on them
 * literally, so renaming one is a breaking change for the consumer even though nothing here fails
 * to compile. The same is true of the BOUNDARIES recorded in docs/observability.md: moving where a
 * span starts or ends changes what the p95 claims, silently.
 *
 * WHY A PROCESSOR AND NOT JUST CAREFUL NAMING. snowplow's ingestion (snowplow#1015) accepts ONLY
 * these five names and drops everything else server-side. Auto-instrumented fetch spans are named
 * `HTTP ${method}` — `instrumentation-fetch/build/src/fetch.js:138` — so without a rename EVERY
 * span the portal already produces would be dropped, and dropped invisibly: the browser sees a 2xx
 * and nothing arrives. That is the failure this file exists to prevent.
 */
import type { Context } from '@opentelemetry/api'
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

/** The auto-instrumentation span names this renames. `HTTP ${method}`, per instrumentation-fetch. */
const isAutoHttpSpan = (name: string): boolean => /^HTTP [A-Z]+$/.test(name)

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
 * Dropping client-side rather than letting snowplow drop it is deliberate (acmp's call): the
 * ingestion has a size cap and a per-user rate limit, so an unexportable span still costs budget
 * that a real one needs. It also keeps the two decisions from disagreeing — `exportOrigins` is the
 * SAME set the propagator uses, so "we propagate traceparent here" and "we export spans from here"
 * cannot drift apart.
 */
export class ContractSpanProcessor implements SpanProcessor {
  private readonly exportOrigins: readonly string[]
  private readonly inner: SpanProcessor

  constructor(inner: SpanProcessor, exportOrigins: readonly string[]) {
    this.exportOrigins = exportOrigins
    this.inner = inner
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
    if (isAutoHttpSpan(span.name)) {
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

  /** True when the span's URL is on one of the origins we export for. */
  private isExportable(span: ReadableSpan): boolean {
    const url = urlOf(span)
    if (url === null) {
      // No URL attribute: we cannot tell whose request it was, and "cannot tell" must not read as
      // "ours". Dropping is the honest choice — the alternative exports spans of unknown origin.
      return false
    }
    try {
      const { origin } = new URL(url, window.location.origin)
      return this.exportOrigins.includes(origin)
    } catch {
      return false
    }
  }
}
