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

import { ContractSpanProcessor } from './spanContract'

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
function originsOf(api: TracingConfig['api']): string[] {
  const rawUrls = [
    api.AUTHN_API_BASE_URL,
    api.SNOWPLOW_API_BASE_URL,
    api.EVENTS_API_BASE_URL,
    api.EVENTS_PUSH_API_BASE_URL,
  ].filter((url): url is string => typeof url === 'string' && url.length > 0)

  const origins = new Set<string>()
  for (const url of rawUrls) {
    try {
      // Resolve relative URLs against the current document origin so same-origin
      // backends still produce a usable absolute origin.
      origins.add(new URL(url, window.location.origin).origin)
    } catch {
      // Ignore malformed URLs — a bad config entry must not break tracing init.
    }
  }

  return Array.from(origins)
}

/**
 * The propagator's allowlist, as origin-anchored RegExps, derived from the same origin set the
 * exporter filters on (`originsOf`). One derivation, two consumers.
 */
function buildCorsUrls(api: TracingConfig['api']): RegExp[] {
  return originsOf(api).map((origin) => new RegExp(`^${escapeRegExp(origin)}`))
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

  const propagateTraceHeaderCorsUrls = buildCorsUrls(cfg.api)
  // The SAME origins the propagator uses. Passing the derived set rather than re-deriving it is
  // what stops "we inject traceparent here" and "we export spans from here" drifting apart: a
  // span exported for an origin we do not propagate to has no server span to link to, and a
  // propagated header with no exported span is a header sent for nothing.
  const exportOrigins = originsOf(cfg.api)

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
          headers: () => {
            try {
              return { Authorization: `Bearer ${getAccessToken()}` }
            } catch {
              return {}
            }
          },
          url: tracesEndpoint,
        })),
        exportOrigins,
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
        clearTimingResources: true,
        propagateTraceHeaderCorsUrls,
      }),
      new XMLHttpRequestInstrumentation({
        propagateTraceHeaderCorsUrls,
      }),
    ],
  })
}
