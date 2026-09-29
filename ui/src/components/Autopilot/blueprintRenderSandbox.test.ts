/**
 * A draft chart is rendered by writing it to the preview sandbox and reading it back by name, so it
 * never rides a URL (the gateway refuses HTTP/2 headers past 16 KB). These pin the three steps, that
 * the draft never outlives its render, and that every way the sandbox path is unavailable falls
 * back to the ?extras RESTAction instead of losing the preview.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SetDispatchOptions, WriteOpResult } from '../../hooks/runRestSet'
import type { WriteOp } from '../BlastRadius/buildBlastRadius'

import {
  DRAFT_CHART_KEY,
  draftChartName,
  renderBlueprint,
  renderDraftViaSandbox,
  type SandboxWriter,
} from './blueprintRenderSandbox'

afterEach(() => { vi.unstubAllGlobals() })

const SANDBOX = 'krateo-preview'
const rawTemplates = {
  'Chart.yaml': 'apiVersion: v2\nname: catalog-service\nversion: 0.1.0\n',
  'values.schema.json': JSON.stringify({ properties: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`p${i}`, { title: 'x'.repeat(200), type: 'string' }])), type: 'object' }),
}

type Call = { ops: readonly WriteOp[]; options?: SetDispatchOptions }

const writer = (answer: (op: WriteOp) => Partial<WriteOpResult> = () => ({})): SandboxWriter & { calls: Call[] } => {
  const calls: Call[] = []
  return {
    calls,
    handleActionSet: (ops, options) => {
      calls.push({ ops, ...(options ? { options } : {}) })
      return Promise.resolve(ops.map((op, index) => ({ index, message: 'OK', ok: true, status: 200, ...answer(op) })))
    },
    sandboxNamespace: SANDBOX,
  }
}

const stubFetch = (status: Record<string, unknown> | null, ok = true, code = 200) => {
  const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve(status === null ? null : { status }), ok, status: code }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The target a /call write path names: `/call?apiVersion=v1&resource=configmaps&namespace=…&name=…`. */
const targetOf = (op: WriteOp) => {
  const params = new URL(op.path, 'http://x').searchParams
  return { name: params.get('name'), namespace: params.get('namespace'), resource: params.get('resource') }
}

const extrasOf = (fetchMock: ReturnType<typeof stubFetch>) => {
  const [url] = fetchMock.mock.calls[0] as unknown as [string]
  const parsed = new URL(url)
  return { extras: JSON.parse(parsed.searchParams.get('extras') ?? '{}') as Record<string, unknown>, name: parsed.searchParams.get('name'), url }
}

describe('draftChartName', () => {
  it('is a DNS-1123 name within 63 characters, named for the chart', () => {
    expect(draftChartName('catalog-service', 'a1b2c3d4')).toBe('bp-preview-catalog-service-a1b2c3d4')
    const long = draftChartName('A_Very Long chart NAME '.repeat(6), 'zz')
    expect(long.length).toBeLessThanOrEqual(63)
    expect(long).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/)
  })
})

describe('renderDraftViaSandbox', () => {
  it('writes the chart as one ConfigMap in the sandbox, renders it by name, then deletes it', async () => {
    const sandbox = writer()
    const fetchMock = stubFetch({ objects: [{ kind: 'Deployment', name: 'r-app', yaml: 'kind: Deployment\n' }] })
    const result = await renderDraftViaSandbox('http://snowplow.local', 'krateo-system', { rawTemplates, values: { a: 1 } }, sandbox, 'n0nce')

    expect(result?.objects.map((object) => object.kind)).toEqual(['Deployment'])
    // 1. the write: POST, into the sandbox only, confirm skipped because it is confined there
    const [write, del] = sandbox.calls
    expect(write.ops).toHaveLength(1)
    expect(write.ops[0].verb).toBe('POST')
    expect(targetOf(write.ops[0])).toMatchObject({ namespace: SANDBOX, resource: 'configmaps' })
    expect(write.options).toEqual({ silent: true, skipConfirmForSandbox: SANDBOX })
    const cm = write.ops[0].payload as { metadata: { name: string; labels: Record<string, string> }; data: Record<string, string> }
    expect(cm.metadata.name).toBe('bp-preview-catalog-service-n0nce')
    expect(cm.metadata.labels['krateo.io/purpose']).toBe('blueprint-preview')
    expect(JSON.parse(cm.data[DRAFT_CHART_KEY])).toMatchObject({ rawTemplates, values: { a: 1 } })
    // 2. the render: the draft RESTAction, with only the name in the URL
    const { extras, name, url } = extrasOf(fetchMock)
    expect(name).toBe('blueprint-render-draft')
    expect(extras).toEqual({ name: 'bp-preview-catalog-service-n0nce', namespace: SANDBOX })
    expect(url.length).toBeLessThan(1000)
    // 3. the delete: the same ConfigMap, by name
    expect(del.ops[0].verb).toBe('DELETE')
    expect(targetOf(del.ops[0])).toEqual({ name: 'bp-preview-catalog-service-n0nce', namespace: SANDBOX, resource: 'configmaps' })
  })

  it('a render that ran and failed is the answer — and the draft is still deleted', async () => {
    const sandbox = writer()
    stubFetch({ error: 'template: deployment.yaml:3: unexpected EOF', objects: [] })
    const result = await renderDraftViaSandbox('http://snowplow.local', 'krateo-system', { rawTemplates }, sandbox, 'x')
    expect(result?.error).toContain('unexpected EOF')
    expect(sandbox.calls.map((call) => call.ops[0].verb)).toEqual(['POST', 'DELETE'])
  })

  it('a refused write (no grant, an older frontend chart) is null, and nothing is rendered', async () => {
    const sandbox = writer(() => ({ message: 'forbidden', ok: false, status: 403 }))
    const fetchMock = stubFetch({ objects: [] })
    expect(await renderDraftViaSandbox('http://snowplow.local', 'krateo-system', { rawTemplates }, sandbox)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a missing draft RESTAction (an older portal) is null — and the written draft is deleted', async () => {
    const sandbox = writer()
    stubFetch(null, false, 404)
    expect(await renderDraftViaSandbox('http://snowplow.local', 'krateo-system', { rawTemplates }, sandbox)).toBeNull()
    expect(sandbox.calls.map((call) => call.ops[0].verb)).toEqual(['POST', 'DELETE'])
  })
})

describe('renderBlueprint', () => {
  it('falls back to the ?extras RESTAction when the sandbox path is unavailable', async () => {
    const sandbox = writer(() => ({ ok: false, status: 403 }))
    const fetchMock = stubFetch({ objects: [] })
    await renderBlueprint('http://snowplow.local', 'krateo-system', { rawTemplates }, sandbox)
    expect(extrasOf(fetchMock).name).toBe('blueprint-render')
  })

  it('never writes for a published chart — a URL is small', async () => {
    const sandbox = writer()
    const fetchMock = stubFetch({ objects: [] })
    await renderBlueprint('http://snowplow.local', 'krateo-system', { chart: { url: 'oci://ghcr.io/x/y' } }, sandbox)
    expect(sandbox.calls).toHaveLength(0)
    expect(extrasOf(fetchMock).name).toBe('blueprint-render')
  })

  it('with no sandbox configured, renders the old way', async () => {
    const fetchMock = stubFetch({ objects: [] })
    await renderBlueprint('http://snowplow.local', 'krateo-system', { rawTemplates })
    expect(extrasOf(fetchMock).name).toBe('blueprint-render')
  })
})
