// @vitest-environment jsdom
/**
 * The exporter's own POST must not be instrumented.
 *
 * It goes through the patched `fetch` and sits under the snowplow prefix, so an instrumented export
 * would become a `krateo.widget.fetch` span shipped by the next batch. Whether the SDK's tracing
 * suppression survives the exporter's `await headers()` was not established, so this does not rely
 * on it: the endpoint is excluded outright. The match itself goes through the library's own
 * `isUrlIgnored`, so a change in how it compares strings fails here.
 */
import { isUrlIgnored } from '@opentelemetry/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ configs: [] as Array<{ ignoreUrls?: string[] }> }))

vi.mock('@opentelemetry/instrumentation', () => ({ registerInstrumentations: vi.fn() }))
vi.mock('@opentelemetry/instrumentation-fetch', () => ({
  FetchInstrumentation: class { constructor(config: { ignoreUrls?: string[] }) { captured.configs.push(config) } },
}))
vi.mock('@opentelemetry/instrumentation-xml-http-request', () => ({
  XMLHttpRequestInstrumentation: class { constructor(config: { ignoreUrls?: string[] }) { captured.configs.push(config) } },
}))
vi.mock('@opentelemetry/sdk-trace-web', async (original) => ({
  ...(await original<object>()),
  WebTracerProvider: class { register() { return undefined } },
}))

const init = async (api: Record<string, string>) => {
  vi.resetModules()
  captured.configs.length = 0
  const { initTracing } = await import('./tracing')
  initTracing({ api } as never)
}

describe('the export endpoint is excluded from instrumentation', () => {
  beforeEach(() => { captured.configs.length = 0 })

  it('on both transports, for an absolute endpoint', async () => {
    const endpoint = 'https://portal.invalid/content/telemetry/v1/traces'
    await init({ OTEL_COLLECTOR_URL: endpoint, SNOWPLOW_API_BASE_URL: 'https://portal.invalid/content' })
    expect(captured.configs).toHaveLength(2)
    for (const config of captured.configs) {
      expect(isUrlIgnored(endpoint, config.ignoreUrls)).toBe(true)
      expect(isUrlIgnored('https://portal.invalid/content/call', config.ignoreUrls)).toBe(false)
    }
  })

  it('resolves a relative endpoint, because the instrumentation compares resolved URLs', async () => {
    await init({ OTEL_TRACES_ENDPOINT: '/content/telemetry/v1/traces' })
    const resolved = new URL('/content/telemetry/v1/traces', window.location.origin).href
    for (const config of captured.configs) {
      expect(isUrlIgnored(resolved, config.ignoreUrls)).toBe(true)
    }
  })
})
