/**
 * Wave-4 preview bridge — pure-logic coverage (no RTL/jsdom), matching the repo's
 * other Autopilot tests:
 *   - the three arg guards DENY malformed proposals (null) and accept the contract;
 *   - callHelmRender maps request→response and resolves EVERY failure mode into
 *     `{error}` content (an {error} body, a non-2xx status, an unreachable service);
 *   - callBlueprintRenderRA (the server-side transport) GETs snowplow /call with the args
 *     in ?extras and reads the render contract out of the RESTAction .status;
 *   - previewRestDef's summary extraction parses verbs/paths from a CR fixture.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PortalActionProposal } from './actionBridge'
import {
  buildBlueprintRenderExtras,
  buildPagePreviewPayload,
  buildRestDefPreviewPayload,
  buildUpgradeImpactExtras,
  buildUpgradeImpactPayload,
  callBlueprintRenderRA,
  callHelmRender,
  callUpgradeImpactRA,
  chartDisplayName,
  extractRestDefSummary,
  FILE_EDIT_PARSE_ERROR,
  FILE_EDIT_SHAPE_ERROR,
  parseBlueprintPreviewArgs,
  parseFileEdit,
  parsePagePreviewArgs,
  parseRestDefEdit,
  parseRestDefPreviewArgs,
  parseUpgradeImpactArgs,
  REST_DEF_EDIT_PARSE_ERROR,
  toYamlString,
  type UpgradeImpactResult,
} from './previewBridge'

const asProposal = (extra: Record<string, unknown>): PortalActionProposal =>
  ({ verb: 'previewBlueprint', ...extra } as PortalActionProposal)

/** The RestDefinition draft fixture (the ogen.krateo.io shape the KOG builder emits). */
const restDefFixture = {
  apiVersion: 'ogen.krateo.io/v1alpha1',
  kind: 'RestDefinition',
  metadata: { name: 'gh-repo', namespace: 'krateo-system' },
  spec: {
    oasPath: 'configmap://krateo-system/gh-oas/openapi.yaml',
    resource: {
      identifiers: ['id', 'name'],
      kind: 'Repo',
      verbsDescription: [
        { action: 'create', method: 'POST', path: '/orgs/{org}/repos' },
        { action: 'get', method: 'get', path: '/repos/{owner}/{repo}' },
        { action: 'delete', method: 'DELETE', path: '/repos/{owner}/{repo}' },
      ],
    },
    resourceGroup: 'github.ogen.krateo.io',
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseBlueprintPreviewArgs — {chart:{url,version?,repo?}, values?}', () => {
  it('accepts a minimal chart ref and a full one', () => {
    expect(parseBlueprintPreviewArgs(asProposal({ chart: { url: 'oci://ghcr.io/x/aws-vpc' } })))
      .toEqual({ chart: { url: 'oci://ghcr.io/x/aws-vpc' } })
    expect(parseBlueprintPreviewArgs(asProposal({
      chart: { repo: 'https://charts.example.io', url: 'aws-vpc', version: '1.2.3' },
      values: { region: 'eu-central-1' },
    }))).toEqual({
      chart: { repo: 'https://charts.example.io', url: 'aws-vpc', version: '1.2.3' },
      values: { region: 'eu-central-1' },
    })
  })

  it('denies a missing/malformed chart or a non-object values (null)', () => {
    expect(parseBlueprintPreviewArgs(asProposal({}))).toBeNull()
    expect(parseBlueprintPreviewArgs(asProposal({ chart: 'oci://x' }))).toBeNull()
    expect(parseBlueprintPreviewArgs(asProposal({ chart: { url: '' } }))).toBeNull()
    expect(parseBlueprintPreviewArgs(asProposal({ chart: { url: 'x', version: 3 } }))).toBeNull()
    expect(parseBlueprintPreviewArgs(asProposal({ chart: { url: 'x' }, values: ['not-an-object'] }))).toBeNull()
  })
})

describe('parsePagePreviewArgs — {widgets:[<widget CR objects>]}', () => {
  it('accepts a non-empty list of kind-carrying CR objects', () => {
    const widgets = [
      { apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', metadata: { name: 'page-root' } },
      { kind: 'Table', metadata: { name: 'rows', namespace: 'krateo-system' } },
    ]
    expect(parsePagePreviewArgs(asProposal({ widgets }))).toEqual(widgets)
  })

  it('denies an empty list, a non-array, and a kind-less entry', () => {
    expect(parsePagePreviewArgs(asProposal({}))).toBeNull()
    expect(parsePagePreviewArgs(asProposal({ widgets: [] }))).toBeNull()
    expect(parsePagePreviewArgs(asProposal({ widgets: 'Flex' }))).toBeNull()
    expect(parsePagePreviewArgs(asProposal({ widgets: [{ metadata: { name: 'no-kind' } }] }))).toBeNull()
    expect(parsePagePreviewArgs(asProposal({ widgets: [{ kind: 'Flex' }, 'not-an-object'] }))).toBeNull()
  })
})

describe('parseRestDefPreviewArgs — {restDefinition: object}', () => {
  it('accepts a CR draft object and denies non-objects / empty objects', () => {
    expect(parseRestDefPreviewArgs(asProposal({ restDefinition: restDefFixture }))).toEqual(restDefFixture)
    expect(parseRestDefPreviewArgs(asProposal({}))).toBeNull()
    expect(parseRestDefPreviewArgs(asProposal({ restDefinition: 'kind: RestDefinition' }))).toBeNull()
    expect(parseRestDefPreviewArgs(asProposal({ restDefinition: {} }))).toBeNull()
  })
})

describe('chartDisplayName', () => {
  it('takes the last URL segment and strips archive suffixes', () => {
    expect(chartDisplayName('oci://ghcr.io/krateoplatformops/aws-vpc')).toBe('aws-vpc')
    expect(chartDisplayName('https://charts.example.io/postgres-1.2.3.tgz')).toBe('postgres-1.2.3')
    expect(chartDisplayName('plain-chart')).toBe('plain-chart')
  })
})

describe('callHelmRender — the render-service transport seam', () => {
  const chartArgs = { chart: { url: 'oci://ghcr.io/x/aws-vpc', version: '1.0.0' }, values: { cidr: '10.0.0.0/16' } }

  const stubFetch = (impl: (...args: unknown[]) => unknown) => {
    const fetchMock = vi.fn(impl)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

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
  const chartArgs = { chart: { url: 'oci://ghcr.io/x/aws-vpc', version: '1.0.0' }, values: { cidr: '10.0.0.0/16' } }

  const stubFetch = (impl: (...args: unknown[]) => unknown) => {
    const fetchMock = vi.fn(impl)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

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

describe('previewPage payload — honest source preview', () => {
  it('builds one YAML object entry per proposed widget CR (zero network by construction)', () => {
    const widgets = [
      { apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', metadata: { name: 'page-root', namespace: 'krateo-system' }, spec: { widgetData: { items: [] } } },
      { kind: 'Table', metadata: { name: 'rows' } },
    ]
    const payload = buildPagePreviewPayload(widgets)
    expect(payload.title).toBe('Page preview — 2 proposed widgets')
    expect(payload.caption).toContain('Source preview')
    expect(payload.objects).toHaveLength(2)
    expect(payload.objects?.[0]).toMatchObject({ apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', name: 'page-root', namespace: 'krateo-system' })
    expect(payload.objects?.[0].yaml).toContain('kind: Flex')
    expect(payload.objects?.[1]).toMatchObject({ kind: 'Table', name: 'rows' })
  })
})

describe('previewRestDef summary — mapped verbs/paths parsed client-side', () => {
  it('extracts kind/group, one line per verb, and the identifiers from the fixture', () => {
    const summary = extractRestDefSummary(restDefFixture)
    expect(summary).toEqual([
      'kind: Repo',
      'group: github.ogen.krateo.io',
      'create · POST /orgs/{org}/repos',
      'get · GET /repos/{owner}/{repo}',
      'delete · DELETE /repos/{owner}/{repo}',
      'identifiers: id, name',
    ])
  })

  it('says "no verbs mapped" for a draft without verbsDescription (data, not a crash)', () => {
    expect(extractRestDefSummary({ spec: { resource: { kind: 'Repo' } } })).toEqual(['kind: Repo', 'no verbs mapped'])
    expect(extractRestDefSummary({})).toEqual(['no verbs mapped'])
  })

  it('builds the full drawer payload: title, summary, and the draft YAML', () => {
    const payload = buildRestDefPreviewPayload(restDefFixture)
    expect(payload.title).toBe('RestDefinition preview — gh-repo')
    expect(payload.summary).toContain('create · POST /orgs/{org}/repos')
    expect(payload.objects).toHaveLength(1)
    expect(payload.objects?.[0]).toMatchObject({ kind: 'RestDefinition', name: 'gh-repo', namespace: 'krateo-system' })
    expect(payload.objects?.[0].yaml).toContain('kind: RestDefinition')
    expect(payload.objects?.[0].yaml).toContain('resourceGroup: github.ogen.krateo.io')
  })

  it('FE-K1 wiring: the payload carries validation problems + immutability warnings', () => {
    // the fixture's `get` verb uses a lowercase method — a REAL live-CRD enum violation
    const payload = buildRestDefPreviewPayload(restDefFixture)
    expect(payload.problems).toEqual([expect.stringContaining('method must be one of GET|POST|PUT|DELETE|PATCH')])
    expect(payload.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('immutable once generated: resource.kind (Repo)'),
      expect.stringContaining('immutable once generated: resourceGroup (github.ogen.krateo.io)'),
      expect.stringContaining('immutable once generated: identifiers (id, name)'),
    ]))
    // a fully valid draft carries NO problems key (the drawer shows no error Alert)
    const valid = JSON.parse(JSON.stringify(restDefFixture)) as typeof restDefFixture
    valid.spec.resource.verbsDescription[1].method = 'GET'
    expect(buildRestDefPreviewPayload(valid).problems).toBeUndefined()
  })

  it('FE-K(edit) wiring: the RestDefinition payload is marked editable with its kind', () => {
    const payload = buildRestDefPreviewPayload(restDefFixture)
    expect(payload.editRestDef).toBe(true)
    expect(payload.restDefKind).toBe('RestDefinition')
  })
})

describe('parseRestDefEdit — re-validate an EDITED RestDefinition source (drawer edit path)', () => {
  const validYaml = toYamlString({
    apiVersion: 'ogen.krateo.io/v1alpha1',
    kind: 'RestDefinition',
    metadata: { name: 'gh-repo', namespace: 'krateo-system' },
    spec: {
      oasPath: 'https://example.org/openapi.yaml',
      resource: { identifiers: ['id'], kind: 'Repo', verbsDescription: [{ action: 'get', method: 'GET', path: '/repos' }] },
      resourceGroup: 'github.ogen.krateo.io',
    },
  })

  it('accepts a clean edit: ok=true, no problems, and re-derives warnings + summary', () => {
    const result = parseRestDefEdit(validYaml)
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
    expect(result.draft).toMatchObject({ kind: 'RestDefinition', metadata: { name: 'gh-repo' } })
    expect(result.summary).toContain('get · GET /repos')
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('immutable once generated: resource.kind (Repo)'),
    ]))
  })

  it('rejects a CRD-invalid edit: ok=false with the exact validation errors, draft still parsed', () => {
    // lowercase method — a live-CRD enum violation (same class the FE-K1 fixture trips)
    const broken = validYaml.replace('method: GET', 'method: get')
    const result = parseRestDefEdit(broken)
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([expect.stringContaining('method must be one of GET|POST|PUT|DELETE|PATCH')])
    // the draft parsed — the drawer keeps showing the (invalid) edited source
    expect(result.draft).not.toBeNull()
  })

  it('rejects a required-field deletion (removing verbsDescription 422s at publish)', () => {
    const result = parseRestDefEdit(toYamlString({
      apiVersion: 'ogen.krateo.io/v1alpha1',
      kind: 'RestDefinition',
      metadata: { name: 'gh-repo', namespace: 'krateo-system' },
      spec: { oasPath: 'https://example.org/openapi.yaml', resource: { kind: 'Repo' }, resourceGroup: 'github.ogen.krateo.io' },
    }))
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(expect.arrayContaining([
      expect.stringContaining('verbsDescription requires at least one'),
    ]))
  })

  it('treats unparseable YAML as data, not a crash: ok=false, the parse-error line, null draft', () => {
    const result = parseRestDefEdit('spec:\n  - : : bad')
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([REST_DEF_EDIT_PARSE_ERROR])
    expect(result.draft).toBeNull()
  })

  it('treats a non-object document (a scalar / list) as a parse error, never a crash', () => {
    expect(parseRestDefEdit('just a string').ok).toBe(false)
    expect(parseRestDefEdit('- a\n- b').problems).toEqual([REST_DEF_EDIT_PARSE_ERROR])
  })
})

describe('parseFileEdit — re-validate an EDITED "Files"-tab file (page/blueprint edit path)', () => {
  const pageWidgetYaml = toYamlString({
    apiVersion: 'widgets.templates.krateo.io/v1beta1',
    kind: 'Flex',
    metadata: { name: 'root', namespace: 'krateo-system' },
    spec: { widgetData: {} },
  })

  it('a PAGE widget CR: accepts a clean edit and echoes the bytes verbatim (held == published)', () => {
    const result = parseFileEdit(pageWidgetYaml, true)
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
    expect(result.content).toBe(pageWidgetYaml)
  })

  it('a PAGE widget CR: rejects a document missing apiVersion/kind/metadata.name (CR-shape)', () => {
    const noName = toYamlString({ apiVersion: 'v1', kind: 'Flex', metadata: {} })
    const noKind = toYamlString({ apiVersion: 'v1', metadata: { name: 'root' } })
    expect(parseFileEdit(noName, true).ok).toBe(false)
    expect(parseFileEdit(noName, true).problems).toEqual([FILE_EDIT_SHAPE_ERROR])
    expect(parseFileEdit(noKind, true).ok).toBe(false)
  })

  it('a PAGE widget CR: unparseable YAML / a non-object document is a parse error, not a crash', () => {
    expect(parseFileEdit('spec:\n  - : : bad', true).problems).toEqual([FILE_EDIT_PARSE_ERROR])
    expect(parseFileEdit('- a\n- b', true).problems).toEqual([FILE_EDIT_SHAPE_ERROR])
    expect(parseFileEdit('just a string', true).problems).toEqual([FILE_EDIT_SHAPE_ERROR])
  })

  it('a BLUEPRINT chart template: YAML-parse-only — no CR-shape requirement', () => {
    // A Helm template renders to objects server-side; it need not itself be a CR.
    const template = 'apiVersion: v2\nname: hello\nversion: 0.1.0\n'
    const result = parseFileEdit(template, false)
    expect(result.ok).toBe(true)
    expect(result.content).toBe(template)
    // a Go-template fragment is still just text js-yaml parses as a scalar/string — accepted
    expect(parseFileEdit('{{ .Values.replicas }}', false).ok).toBe(true)
    // an empty file is a valid (publishable) template
    expect(parseFileEdit('', false).ok).toBe(true)
  })

  it('a BLUEPRINT chart template: rejects genuinely unparseable YAML', () => {
    const result = parseFileEdit('spec:\n  - : : bad', false)
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([FILE_EDIT_PARSE_ERROR])
  })
})

describe('parseUpgradeImpactArgs — {name, namespace, toVersion}', () => {
  it('accepts a well-formed proposal (no chart source — the RA fetches the compdef)', () => {
    expect(parseUpgradeImpactArgs(asProposal({ name: 'aws-vpc', namespace: 'demo', toVersion: '1.2.0' })))
      .toEqual({ name: 'aws-vpc', namespace: 'demo', toVersion: '1.2.0' })
  })

  it('DENIES a missing or empty name / namespace / toVersion', () => {
    expect(parseUpgradeImpactArgs(asProposal({ namespace: 'demo', toVersion: '1.2.0' }))).toBeNull()
    expect(parseUpgradeImpactArgs(asProposal({ name: 'x', toVersion: '1.2.0' }))).toBeNull()
    expect(parseUpgradeImpactArgs(asProposal({ name: 'x', namespace: 'demo' }))).toBeNull()
    expect(parseUpgradeImpactArgs(asProposal({ name: 'x', namespace: '  ', toVersion: '1.2.0' }))).toBeNull()
    expect(parseUpgradeImpactArgs(asProposal({ name: 'x', namespace: 'demo', toVersion: 5 as unknown as string }))).toBeNull()
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
  const stubFetch = (impl: (...fetchArgs: unknown[]) => unknown) => {
    const fetchMock = vi.fn(impl)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

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

describe('buildUpgradeImpactPayload — drawer content', () => {
  it('renders a render error as the drawer error, never rows', () => {
    const payload = buildUpgradeImpactPayload({ error: 'chart: not found', from: '1.1.0', rows: [], summary: '', to: '1.2.0', valuesSchemaChanged: false })
    expect(payload.title).toBe('Upgrade impact — 1.1.0 → 1.2.0')
    expect(payload.error).toBe('chart: not found')
    expect(payload.summary).toBeUndefined()
  })

  it('renders the RA headline + one marked line per object (+ / - / ~)', () => {
    const result: UpgradeImpactResult = {
      from: '1.1.0',
      rows: [
        { change: 'added', detail: 'new object in 1.2.0', kind: 'ConfigMap', name: 'cfg', namespace: 'demo' },
        { change: 'removed', detail: 'no longer rendered by 1.2.0', kind: 'Service', name: 'svc', namespace: 'demo' },
        { change: 'modified', detail: 'changed: replicas', kind: 'Deployment', name: 'api', namespace: 'demo' },
      ],
      summary: '1 added · 1 removed · 1 modified · values schema changed',
      to: '1.2.0',
      valuesSchemaChanged: true,
    }
    expect(buildUpgradeImpactPayload(result).summary).toEqual([
      '1 added · 1 removed · 1 modified · values schema changed',
      '+ ConfigMap demo/cfg — new object in 1.2.0',
      '- Service demo/svc — no longer rendered by 1.2.0',
      '~ Deployment demo/api — changed: replicas',
    ])
  })

  it('falls back to a no-changes line when there are no rows and no summary', () => {
    expect(buildUpgradeImpactPayload({ from: '1.1.0', rows: [], summary: '', to: '1.2.0', valuesSchemaChanged: false }).summary)
      .toEqual(['No changes between the two versions (chart defaults).'])
  })
})
