import { ZoneContextManager } from '@opentelemetry/context-zone'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

import { getAccessToken } from '../utils/getAccessToken'

import { ContractSpanProcessor, redactUrlAttributes } from './spanContract'

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
 * Build the `propagateTraceHeaderCorsUrls` allowlist as origin-anchored RegExps.
 *
 * CRITICAL: traceparent is ONLY injected on requests whose URL matches one of
 * these patterns. We derive them strictly from the configured backend origins
 * (authn / snowplow / events / events-push) so we never blanket-inject the
 * header on arbitrary cross-origin calls (which would trigger CORS preflights
 * and leak trace context to third parties). Each backend must also CORS-allow
 * the `traceparent` request header, or those requests will fail preflight.
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

let initialized = false

/**
 * Initialise browser-side OTel tracing. Idempotent and side-effecting: registers
 * a global `WebTracerProvider` + fetch/XHR auto-instrumentation that start spans
 * and inject W3C traceparent on the allow-listed backend origins.
 *
 * This module is dynamically imported and only invoked when
 * `config.api.OTEL_COLLECTOR_URL` is set, so the default runtime path (no key)
 * ships byte-identical behaviour: no provider, no instrumentation, no headers.
 */
export function initTracing(cfg: TracingConfig): void {
  if (initialized) {
    return
  }

  const tracesEndpoint = cfg.api.OTEL_TRACES_ENDPOINT ?? cfg.api.OTEL_COLLECTOR_URL
  if (!tracesEndpoint) {
    return
  }

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
      // the five accepted names and only our own origins reach the batch at all. Filtering here
      // rather than letting snowplow drop server-side protects its size cap and per-user rate
      // limit, which an unexportable span would otherwise spend.
      new ContractSpanProcessor(
        new BatchSpanProcessor(new OTLPTraceExporter({
          // A FUNCTION, evaluated per request (otlp-exporter-base: `headers: await
          // this._parameters.headers()`), so a rotated token is picked up without rebuilding the
          // exporter. snowplow's endpoint answers 401 without it. Wrapped because the SPA throws
          // when no session is stored, and a telemetry export must never be the thing that throws.
          headers: (): Promise<Record<string, string>> => {
            try {
              return Promise.resolve({ Authorization: `Bearer ${getAccessToken()}` })
            } catch {
              // No stored session: send nothing rather than a malformed header. snowplow answers
              // 401 and the batch is dropped, which is the right outcome — telemetry must never
              // be the thing that throws, and an export is not worth raising to the user.
              return Promise.resolve({})
            }
          },
          url: tracesEndpoint,
        })),
        snowplowPrefix,
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
        // Route template IN, raw URL OUT, here — where the span is still mutable. A raw
        // `http.url` carries the query string, which is exactly what must not leave the browser:
        // `?extras={...}` can hold a filter, and a page name is not ours to ship. snowplow
        // allowlists attributes independently, but a value it would reject is a value we should
        // not have sent.
        applyCustomAttributesOnSpan: (span) => {
          redactUrlAttributes(span, snowplowPrefix)
        },
        clearTimingResources: true,
        propagateTraceHeaderCorsUrls,
      }),
      new XMLHttpRequestInstrumentation({
        applyCustomAttributesOnSpan: (span) => {
          redactUrlAttributes(span, snowplowPrefix)
        },
        propagateTraceHeaderCorsUrls,
      }),
    ],
  })
}
