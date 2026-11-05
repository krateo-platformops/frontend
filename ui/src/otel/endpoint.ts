/**
 * The one reading of "is browser telemetry configured, and where to".
 *
 * Its own module with no OTel imports, because `index.tsx` must answer this BEFORE deciding to load
 * the SDK. It was two readings: `index.tsx` gated on `OTEL_COLLECTOR_URL` alone while `tracing.ts`
 * and the docs said `OTEL_TRACES_ENDPOINT` wins, so setting only the current name did nothing.
 *
 * `||` and not `??`: the chart ships these as empty strings, and a blank current name must not
 * shadow a set older one.
 */
export type TelemetryConfig = {
  OTEL_COLLECTOR_URL?: string
  OTEL_TRACES_ENDPOINT?: string
}

export const tracesEndpointOf = (api?: TelemetryConfig): string | undefined =>
  api?.OTEL_TRACES_ENDPOINT || api?.OTEL_COLLECTOR_URL || undefined
