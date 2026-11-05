/**
 * Wave-4 preview bridge — the TRANSPORT seams (the only part of the bridge that touches the
 * network), split out of previewBridge.test.ts so the pure parsing/payload coverage next to it
 * stays free of fetch stubbing. Each `call*` helper must resolve EVERY failure mode into
 * `{error}` content — an {error} body, a non-2xx status, an unreachable service — and never
 * reject, because a failed preview is data the drawer renders, not a crash. The two
 * `build*Extras` describes sit here too: they pin the ?extras envelope these calls put on the wire.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildBlueprintRenderExtras,
  buildUpgradeImpactExtras,
  callBlueprintRenderRA,
  callHelmRender,
  callUpgradeImpactRA,
  toYamlString,
} from './previewBridge'

/** Stub `fetch` for one test and hand back the mock, so the request itself can be asserted on. */
const stubFetch = (impl: (...args: unknown[]) => unknown) => {
  const fetchMock = vi.fn(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const chartArgs = { chart: { url: 'oci://ghcr.io/x/aws-vpc', version: '1.0.0' }, values: { cidr: '10.0.0.0/16' } }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('callHelmRender — the render-service transport seam', () => {
  it('POSTs {chart, values} to <base>/render and normalizes the returned objects', async () => {
    const fetchMock = stubFetch(() => Promise.resolve({
      json: () => Promise.resolve({
        objects: [
          { apiVersion: 'apps/v1', kind: 'Deployment', name: 'web', namespace: 'demo', yaml: 'kind: Deployment' },
          { name: 'anonymous' },
        ],
        valuesSchema: { type: 'object' },
      }),
      ok: true,
      status: 200,
    }))
    // trailing slash on the base URL is normalized away
    const result = await callHelmRender('http://render.local/', chartArgs)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://render.local/render')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ chart: chartArgs.chart, values: chartArgs.values })
    expect(result.error).toBeUndefined()
    expect(result.valuesSchema).toEqual({ type: 'object' })
    expect(result.objects).toEqual([
      { apiVersion: 'apps/v1', kind: 'Deployment', name: 'web', namespace: 'demo', yaml: 'kind: Deployment' },
      // a shapeless entry still previews: kind falls back, its own JSON becomes the YAML
      { kind: 'Object', name: 'anonymous', yaml: toYamlString({ name: 'anonymous' }) },
    ])
  })

  it('surfaces a 200 {error} body as content — a bad chart is data', async () => {
    stubFetch(() => Promise.resolve({
      json: () => Promise.resolve({ error: 'template: aws-vpc/templates/vpc.yaml: required value missing' }),
      ok: true,
      status: 200,
    }))
    const result = await callHelmRender('http://render.local', chartArgs)
    expect(result.error).toContain('required value missing')
    expect(result.objects).toEqual([])
  })

  it('surfaces a non-2xx {error} body, and a body-less failure as the status code', async () => {
    stubFetch(() => Promise.resolve({
      json: () => Promise.resolve({ error: 'chart not found' }),
      ok: false,
      status: 400,
    }))
    expect((await callHelmRender('http://render.local', chartArgs)).error).toBe('chart not found')

    stubFetch(() => Promise.resolve({
      json: () => Promise.reject(new Error('no body')),
      ok: false,
      status: 503,
    }))
    expect((await callHelmRender('http://render.local', chartArgs)).error).toBe('render service responded 503')
  })

  it('resolves (never rejects) when the service is unreachable', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const result = await callHelmRender('http://render.local', chartArgs)
    expect(result.error).toContain('render service unreachable')
    expect(result.error).toContain('Failed to fetch')
    expect(result.objects).toEqual([])
  })

  it('forwards the session Bearer when a token exists, and omits it gracefully otherwise', async () => {
    const fetchMock = stubFetch(() => Promise.resolve({ json: () => Promise.resolve({ objects: [] }), ok: true, status: 200 }))
    // no localStorage in the node test env → getAccessToken throws → header omitted
    await callHelmRender('http://render.local', chartArgs)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
})

describe('buildBlueprintRenderExtras — the ?extras envelope', () => {
  it('carries the chart source + values for the remote mode', () => {
    expect(JSON.parse(buildBlueprintRenderExtras({ chart: { url: 'oci://x/aws-vpc', version: '1.0.0' }, values: { region: 'eu' } })))
      .toEqual({ chart: { url: 'oci://x/aws-vpc', version: '1.0.0' }, values: { region: 'eu' } })
  })

  it('carries rawTemplates (NOT chart) for the inline-draft mode, defaulting values to {}', () => {
    expect(JSON.parse(buildBlueprintRenderExtras({ rawTemplates: { 'Chart.yaml': 'apiVersion: v2\n' } })))
      .toEqual({ rawTemplates: { 'Chart.yaml': 'apiVersion: v2\n' }, values: {} })
  })
})

describe('callBlueprintRenderRA — the server-side RESTAction transport seam', () => {
  it('GETs /call?resource=restactions&name=blueprint-render with the args in ?extras and reads .status', async () => {
    const fetchMock = stubFetch(() => Promise.resolve({
      json: () => Promise.resolve({
        // snowplow places a RESTAction's jq filter output DIRECTLY in .status (not .status.widgetData)
        status: {
          objects: [
            { apiVersion: 'ec2.services.k8s.aws/v1alpha1', kind: 'VPC', name: 'demo-vpc', namespace: 'demo-system', yaml: 'kind: VPC' },
            { name: 'anonymous' },
          ],
          valuesSchema: { type: 'object' },
        },
      }),
      ok: true,
      status: 200,
    }))
    const result = await callBlueprintRenderRA('http://snowplow.local/', 'krateo-system', chartArgs)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined]
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('http://snowplow.local/call')
    expect(parsed.searchParams.get('resource')).toBe('restactions')
    expect(parsed.searchParams.get('apiVersion')).toBe('templates.krateo.io/v1')
    expect(parsed.searchParams.get('name')).toBe('blueprint-render')
    expect(parsed.searchParams.get('namespace')).toBe('krateo-system')
    expect(JSON.parse(parsed.searchParams.get('extras') ?? '{}')).toEqual({ chart: chartArgs.chart, values: chartArgs.values })
    // GET (no method) — the browser never POSTs the ClusterIP-only render service directly
    expect(init?.method).toBeUndefined()
    expect(result.error).toBeUndefined()
    expect(result.valuesSchema).toEqual({ type: 'object' })
    expect(result.objects).toEqual([
      { apiVersion: 'ec2.services.k8s.aws/v1alpha1', kind: 'VPC', name: 'demo-vpc', namespace: 'demo-system', yaml: 'kind: VPC' },
      // a shapeless entry still previews: kind falls back, its own JSON becomes the YAML
      { kind: 'Object', name: 'anonymous', yaml: toYamlString({ name: 'anonymous' }) },
    ])
  })

  it('surfaces the render {error} from .status as content — a bad chart is data', async () => {
    stubFetch(() => Promise.resolve({
      json: () => Promise.resolve({ status: { error: 'chart: failed to pull oci://…:9.9.9: not found', objects: [] } }),
      ok: true,
      status: 200,
    }))
    const result = await callBlueprintRenderRA('http://snowplow.local', 'krateo-system', chartArgs)
    expect(result.error).toContain('not found')
    expect(result.objects).toEqual([])
  })

  it('a non-2xx (RA missing / RBAC-denied / snowplow 5xx) surfaces as content, not a throw', async () => {
    stubFetch(() => Promise.resolve({ json: () => Promise.resolve(null), ok: false, status: 404 }))
    const result = await callBlueprintRenderRA('http://snowplow.local', 'krateo-system', chartArgs)
    expect(result.error).toBe('blueprint-render RESTAction responded 404')
    expect(result.objects).toEqual([])
  })

  it('resolves (never rejects) when snowplow is unreachable', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const result = await callBlueprintRenderRA('http://snowplow.local', 'krateo-system', chartArgs)
    expect(result.error).toContain('blueprint-render RESTAction unreachable')
    expect(result.error).toContain('Failed to fetch')
    expect(result.objects).toEqual([])
  })

  it('treats a missing/empty .status as an empty (no-objects) result, never a crash', async () => {
    stubFetch(() => Promise.resolve({ json: () => Promise.resolve({ metadata: { name: 'blueprint-render' } }), ok: true, status: 200 }))
    const result = await callBlueprintRenderRA('http://snowplow.local', 'krateo-system', chartArgs)
    expect(result.error).toBeUndefined()
    expect(result.objects).toEqual([])
  })
})

describe('buildUpgradeImpactExtras — the ?extras envelope', () => {
  it('maps the composition identity + target version to {namespace, name, to}', () => {
    expect(JSON.parse(buildUpgradeImpactExtras({ name: 'aws-vpc', namespace: 'demo', toVersion: '1.2.0' })))
      .toEqual({ name: 'aws-vpc', namespace: 'demo', to: '1.2.0' })
  })
})

describe('callUpgradeImpactRA — the server-side upgrade-impact RESTAction transport', () => {
  const args = { name: 'aws-vpc', namespace: 'demo', toVersion: '1.2.0' }

  it('GETs /call?name=upgrade-impact with {namespace,name,to} in ?extras and reads the shaped .status', async () => {
    const fetchMock = stubFetch(() => Promise.resolve({
      json: () => Promise.resolve({
        status: {
          from: '1.1.0',
          rows: [{ change: 'modified', detail: 'changed: replicas', kind: 'Deployment', name: 'api', namespace: 'demo' }],
          summary: '0 added · 0 removed · 1 modified · values schema changed',
          to: '1.2.0',
          valuesSchemaChanged: true,
        },
      }),
      ok: true,
      status: 200,
    }))
    const result = await callUpgradeImpactRA('http://snowplow.local/', 'krateo-system', args)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined]
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('http://snowplow.local/call')
    expect(parsed.searchParams.get('name')).toBe('upgrade-impact')
    expect(parsed.searchParams.get('resource')).toBe('restactions')
    expect(parsed.searchParams.get('namespace')).toBe('krateo-system')
    expect(JSON.parse(parsed.searchParams.get('extras') ?? '{}')).toEqual({ name: 'aws-vpc', namespace: 'demo', to: '1.2.0' })
    // GET (no method) — the browser never POSTs the ClusterIP-only render service directly
    expect(init?.method).toBeUndefined()
    expect(result.error).toBeUndefined()
    expect(result.from).toBe('1.1.0')
    expect(result.valuesSchemaChanged).toBe(true)
    expect(result.rows).toEqual([{ change: 'modified', detail: 'changed: replicas', kind: 'Deployment', name: 'api', namespace: 'demo' }])
  })

  it('surfaces the RA .status.error as content — a render failure is data', async () => {
    stubFetch(() => Promise.resolve({ json: () => Promise.resolve({ status: { error: 'chart: not found', from: '1.1.0', to: '1.2.0' } }), ok: true, status: 200 }))
    const result = await callUpgradeImpactRA('http://snowplow.local', 'krateo-system', args)
    expect(result.error).toBe('chart: not found')
    expect(result.rows).toEqual([])
  })

  it('a non-2xx and an unreachable snowplow both resolve to {error}, never a throw', async () => {
    stubFetch(() => Promise.resolve({ json: () => Promise.resolve(null), ok: false, status: 403 }))
    expect((await callUpgradeImpactRA('http://snowplow.local', 'krateo-system', args)).error).toBe('upgrade-impact RESTAction responded 403')
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    expect((await callUpgradeImpactRA('http://snowplow.local', 'krateo-system', args)).error).toContain('unreachable')
  })

  it('treats a missing .status as an error result, never a crash', async () => {
    stubFetch(() => Promise.resolve({ json: () => Promise.resolve({ metadata: { name: 'upgrade-impact' } }), ok: true, status: 200 }))
    expect((await callUpgradeImpactRA('http://snowplow.local', 'krateo-system', args)).error).toContain('no status')
  })
})
