import { ZoneContextManager } from '@opentelemetry/context-zone'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

import { agentikoConfig } from '../context/agentikoConfig'

import { tracesEndpointOf } from './endpoint'
import { ContractSpanProcessor, redactUrlAttributes } from './spanContract'
import { telemetryAuthHeaders } from './telemetryCredential'

/**
 * Minimal shape of the runtime config consumed by tracing init. We intentionally
 * accept a loosely-typed object (rather than the full `Config`) because tracing
 * is bootstrapped from a standalone pre-React fetch in `index.tsx`, before the
 * `ConfigProvider` / typed config is available.
 */
export interface TracingConfig {
  api: {
    /**
     * Where traces are POSTed, OTLP/HTTP JSON. When neither key is set, init is never called.
     *
     * `OTEL_TRACES_ENDPOINT` is the current name and wins. `OTEL_COLLECTOR_URL` keeps working for
     * every install that already sets it, and is read second — it is not deprecated so much as
     * misnamed now: under X5 the destination is snowplow's `/telemetry/v1/traces`, which validates
     * and forwards to the collector, so nothing a collector serves lives at that URL any more.
     * Renaming it silently would leave the next reader looking for a collector that is not there.
     */
    OTEL_TRACES_ENDPOINT?: string
    OTEL_COLLECTOR_URL?: string
    /** Cross-origin backends whose calls should carry W3C `traceparent`. */
    AUTHN_API_BASE_URL?: string
    SNOWPLOW_API_BASE_URL?: string
    EVENTS_API_BASE_URL?: string
    EVENTS_PUSH_API_BASE_URL?: string
  }
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The snowplow URL prefix (`SNOWPLOW_API_BASE_URL`, resolved against the document origin, no
 * trailing slash) — the ONE derivation behind both the export filter and the
 * `propagateTraceHeaderCorsUrls` allowlist built from it in `initTracing`.
 *
 * What that allowlist does and does not decide: `@opentelemetry/sdk-trace-web`'s
 * `shouldPropagateTraceHeaders` ALWAYS injects traceparent on same-origin requests; the list only
 * governs CROSS-origin ones. So the list exists to keep trace context away from every other
 * origin (third parties, CORS preflights) and to reach a snowplow that lives on its own origin —
 * which must then CORS-allow the `traceparent` request header. authn and events are deliberately
 * NOT listed: only snowplow emits a Server span to link to.
 */
function snowplowPrefixOf(api: TracingConfig['api']): string | null {
  const base = api.SNOWPLOW_API_BASE_URL
  if (typeof base !== 'string' || base.length === 0) {
    return null
  }
  try {
    // Resolved against the document origin so a relative base still yields an absolute prefix.
    // Trailing slash stripped so `…/content` and `…/content/` behave identically.
    return new URL(base, window.location.origin).href.replace(/\/+$/, '')
  } catch {
    // A malformed config entry must not break tracing init.
    return null
  }
}

/**
 * The Agentiko A2A URL prefix (`AGENTIKO_API_BASE_URL`, read through `agentikoConfig` like every
 * other reader of it; resolved against the document origin, no trailing slash) — or null, which
 * leaves A2A requests exactly as they were before `krateo.agentiko.a2a` existed: renamed
 * `krateo.widget.fetch` and dropped at export for not being under the snowplow base.
 *
 * NULL WHEN THE BASE IS ON ANOTHER ORIGIN, deliberately. The point of exporting this span is that
 * its context is the `traceparent` the request carried. Cross-origin, `propagateTraceHeaderCorsUrls`
 * (snowplow only) does not list the A2A base, so the request carries NO traceparent and the span
 * would be an orphan root linked to nothing — budget spent on a trace that joins nothing. Listing
 * the base there would also need the gateway to CORS-allow the header, which is not this change.
 *
 * Same-origin needs no propagation entry: `shouldPropagateTraceHeaders` always injects on
 * same-origin requests, which is why the span's context already reaches the gateway today.
 */
export function agentikoA2aPrefixOf(api: TracingConfig['api']): string | null {
  const base = agentikoConfig(api, 'API_BASE_URL')
  if (typeof base !== 'string' || base.length === 0) {
    return null
  }
  try {
    const resolved = new URL(base, window.location.origin)
    if (resolved.origin !== window.location.origin) {
      return null
    }
    // `a2aUrl` POSTs to the base WITH a trailing slash; the prefix is matched at a path boundary
    // (`underPrefix`), so the slash-less form covers both.
    return resolved.href.replace(/\/+$/, '')
  } catch {
    // A malformed config entry must not break tracing init.
    return null
  }
}

let initialized = false

/**
 * Initialise browser-side OTel tracing. Idempotent and side-effecting: registers
 * a global `WebTracerProvider` + fetch/XHR auto-instrumentation that start spans
 * and inject W3C traceparent on the allow-listed backend origins.
 *
 * This module is dynamically imported and only invoked when
 * a traces endpoint is set (see endpoint.ts), so the default runtime path (no key)
 * ships byte-identical behaviour: no provider, no instrumentation, no headers.
 */
export function initTracing(cfg: TracingConfig): void {
  if (initialized) {
    return
  }

  const tracesEndpoint = tracesEndpointOf(cfg.api)
  if (!tracesEndpoint) {
    return
  }

  // The export's own POST must never become a span. It goes through the patched `fetch` and sits
  // under the snowplow prefix, so if it were instrumented it would be renamed
  // `krateo.widget.fetch` and shipped by the next batch, and an idle tab would export forever.
  // Absolute, because the instrumentation compares against the resolved URL.
  const ignoreUrls = [new URL(tracesEndpoint, window.location.origin).href]

  initialized = true

  // ONE derivation, used for BOTH propagation and export, and it is a PREFIX rather than an
  // origin.
  //
  // An origin check is correct only where snowplow has an origin of its own. On a same-origin
  // install — 057 serves portal, snowplow AND authn from `portal.krateo.dev` — "same origin as
  // snowplow" is true of authn calls and of the SPA's own `/config/config.json`, so an
  // origin-scoped export would rename and ship those as `krateo.widget.fetch`. The prefix
  // `https://portal.krateo.dev/content` is what actually identifies a snowplow call.
  //
  // Narrowing propagation to the same prefix also removes a header that was achieving nothing:
  // only snowplow emits a Server span to link to (snowplow#1013), so traceparent on authn and
  // events calls had no counterpart.
  const snowplowPrefix = snowplowPrefixOf(cfg.api)
  // The SAME path boundary the export filter applies (`underPrefix` in spanContract.ts). Without
  // `(?:[/?]|$)` this matches `…/contentious/call` as if it were under `…/content` — the identical
  // bug, in the second consumer. Same-origin it is harmless because same-origin requests get
  // traceparent regardless; cross-origin it would send trace context to a look-alike path.
  //
  // "One derivation, two consumers" only holds if both consumers apply the same rule to it.
  const propagateTraceHeaderCorsUrls = snowplowPrefix === null
    ? []
    : [new RegExp(`^${escapeRegExp(snowplowPrefix)}(?:[/?]|$)`)]

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'krateo-frontend',
    }),
    spanProcessors: [
      // The contract processor WRAPS the batcher: it renames on start and filters on end, so only
      // the accepted names (spanContract.ts) and only our own origins reach the batch at all. Filtering here
      // rather than letting snowplow drop server-side protects its size cap and per-user rate
      // limit, which an unexportable span would otherwise spend.
      new ContractSpanProcessor(
        new BatchSpanProcessor(new OTLPTraceExporter({
          // A FUNCTION, evaluated per request (otlp-exporter-base: `headers: await
          // this._parameters.headers()`), so a rotated token is picked up without rebuilding the
          // exporter. snowplow's endpoint answers 401 without it.
          //
          // The credential comes from the holder the SIGNED-IN SHELL fills while it is mounted
          // (telemetryCredential.ts), not from storage: a public page renders outside the shell
          // and sends no credential, its span exports included, even when an earlier sign-in left
          // a token behind. Nothing held, or no session stored: no header, snowplow answers 401 and
          // the batch is dropped — telemetry must never be the thing that throws.
          headers: (): Promise<Record<string, string>> => Promise.resolve(telemetryAuthHeaders()),
          url: tracesEndpoint,
        })),
        snowplowPrefix,
        agentikoA2aPrefixOf(cfg.api),
      ),
    ],
  })

  provider.register({
    contextManager: new ZoneContextManager(),
    propagator: new W3CTraceContextPropagator(),
  })

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        // Route template IN, raw URL OUT, here — where the span is still mutable. The raw URL
        // attribute (`url.full` at 0.223; see URL_ATTRS for the full read-set) carries the query
        // string, which is exactly what must not leave the browser: `?extras={...}` can hold a
        // filter, and a page name is not ours to ship. snowplow allowlists attributes
        // independently, but a value it would reject is a value we should not have sent.
        applyCustomAttributesOnSpan: (span) => {
          redactUrlAttributes(span, snowplowPrefix)
        },
        clearTimingResources: true,
        ignoreUrls,
        propagateTraceHeaderCorsUrls,
      }),
      new XMLHttpRequestInstrumentation({
        applyCustomAttributesOnSpan: (span) => {
          redactUrlAttributes(span, snowplowPrefix)
        },
        ignoreUrls,
        propagateTraceHeaderCorsUrls,
      }),
    ],
  })
}
