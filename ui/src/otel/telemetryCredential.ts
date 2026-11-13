/**
 * The credential the OTLP exporter sends with a span batch, held for it by the signed-in shell.
 *
 * Tracing starts before React (index.tsx) and lives for the whole document, so it cannot take its
 * credential from the widget transport in context the way the widget tree does. It used to read the
 * stored token itself, which meant a public page — one rendered outside the signed-in shell, by
 * someone who may still have a token in storage — exported its spans WITH that token. A public page
 * sends no credential, its telemetry included.
 *
 * So the exporter asks this holder, and only the signed-in transport provider (mounted by the shell)
 * fills it, for exactly as long as it is mounted. Outside the shell the holder is empty, the batch
 * goes out with no header, snowplow answers 401 and the batch is dropped — the outcome a signed-out
 * export always had.
 */

let source: (() => string) | null = null

/** Install the credential getter; returns the release. A newer install replaces an older one. */
export const holdTelemetryCredential = (getToken: () => string): (() => void) => {
  source = getToken
  return () => {
    if (source === getToken) { source = null }
  }
}

/**
 * The exporter's headers, evaluated per export. `{}` when nothing is held, and `{}` when the getter
 * throws (no session stored): a telemetry export must never be the thing that throws.
 */
export const telemetryAuthHeaders = (): Record<string, string> => {
  if (!source) { return {} }
  try {
    return { Authorization: `Bearer ${source()}` }
  } catch {
    return {}
  }
}
