/**
 * Wave-4 preview verbs — pure-logic coverage (no RTL/jsdom). The drawer surface is
 * mocked at the previewBus seam, so these tests assert exactly what each verb DOES:
 *   - all three are registered read-only entries (deny-by-default preserved);
 *   - malformed args are denied (null) with no fetch and no drawer;
 *   - previewBlueprint PREFERS the server-side `blueprint-render` RESTAction (snowplow
 *     `/call`) and falls back to the direct RENDER_API_BASE_URL fetch; with NEITHER
 *     transport → the graceful "unavailable" chip, ZERO network; either → drawer (objects,
 *     or the render error as content);
 *   - previewPage / previewRestDef never touch the network at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PortalActionProposal } from './actionBridge'
import type { AutopilotPreviewPayload } from './previewBus'
import { openAutopilotPreview } from './previewBus'
import { describeResourceSpec, explainUpgradeImpactSpec, previewBlueprintSpec, previewPageSpec, previewRestDefSpec, RENDER_UNAVAILABLE_LABEL, UPGRADE_IMPACT_UNAVAILABLE_LABEL } from './previewHandlers'
import { isReadOnlyVerb, READONLY_VERB_REGISTRY, type VerbDeps } from './verbRegistry'

vi.mock('./previewBus', () => ({ openAutopilotPreview: vi.fn(), setPreviewProblems: vi.fn() }))

const openPreviewMock = vi.mocked(openAutopilotPreview)

/** Direct-fetch (legacy RENDER_API_BASE_URL) deps: only `renderBaseUrl`, no RA transport. */
const makeDeps = (renderBaseUrl?: string): VerbDeps => ({
  handleAction: vi.fn((): Promise<void> => Promise.resolve()),
  routePatterns: [],
  ...(renderBaseUrl ? { renderBaseUrl } : {}),
})

/** RA-transport deps: snowplow base URL + the RA's frontend namespace (the PREFERRED path). */
const makeRADeps = (overrides?: Partial<VerbDeps>): VerbDeps => ({
  frontendNamespace: 'krateo-system',
  handleAction: vi.fn((): Promise<void> => Promise.resolve()),
  routePatterns: [],
  snowplowBaseUrl: 'http://snowplow.local',
  ...overrides,
})

const asProposal = (verb: string, extra: Record<string, unknown>): PortalActionProposal =>
  ({ verb, ...extra } as PortalActionProposal)

/** The payload the (mocked) drawer was opened with on the first call. */
const openedPayload = (): AutopilotPreviewPayload => openPreviewMock.mock.calls[0][0]

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('registry — the three preview verbs are read-only entries', () => {
  it('registers previewBlueprint / previewPage / previewRestDef, all sideEffect:read', () => {
    for (const verb of ['previewBlueprint', 'previewPage', 'previewRestDef']) {
      expect(READONLY_VERB_REGISTRY[verb]).toBeDefined()
      expect(READONLY_VERB_REGISTRY[verb].sideEffect).toBe('read')
      expect(isReadOnlyVerb(verb)).toBe(true)
    }
  })
})

describe('previewBlueprint', () => {
  const chart = { url: 'oci://ghcr.io/x/aws-vpc', version: '1.0.0' }

  it('denies malformed args (no chart / empty url): null, no fetch, no drawer', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const deps = makeDeps('http://render.local')
    expect(previewBlueprintSpec.argSchema(asProposal('previewBlueprint', {}))).toBe(false)
    expect(await previewBlueprintSpec.apply(asProposal('previewBlueprint', {}), deps)).toBeNull()
    expect(await previewBlueprintSpec.apply(asProposal('previewBlueprint', { chart: { url: '' } }), deps)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openPreviewMock).not.toHaveBeenCalled()
  })

  it('returns the graceful "unavailable" chip when NEITHER transport is available — ZERO network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // no renderBaseUrl AND no snowplow RA transport
    const chip = await previewBlueprintSpec.apply(asProposal('previewBlueprint', { chart }), makeDeps())
    expect(chip).toEqual({ label: RENDER_UNAVAILABLE_LABEL, readOnly: true, verb: 'previewBlueprint' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openPreviewMock).not.toHaveBeenCalled()
  })

  it('unavailable when snowplowBaseUrl is set but frontendNamespace is not (RA needs both), no direct URL — ZERO network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const chip = await previewBlueprintSpec.apply(
      asProposal('previewBlueprint', { chart }),
      makeRADeps({ frontendNamespace: undefined }),
    )
    expect(chip).toEqual({ label: RENDER_UNAVAILABLE_LABEL, readOnly: true, verb: 'previewBlueprint' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openPreviewMock).not.toHaveBeenCalled()
  })

  it('DIRECT fallback: POSTs to <base>/render and opens the drawer with the rendered objects', async () => {
    const fetchMock = vi.fn((..._args: unknown[]) => Promise.resolve({
      json: () => Promise.resolve({
        objects: [{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'web', namespace: 'demo', yaml: 'kind: Deployment' }],
      }),
      ok: true,
      status: 200,
    }))
    vi.stubGlobal('fetch', fetchMock)
    const chip = await previewBlueprintSpec.apply(
      asProposal('previewBlueprint', { chart, values: { cidr: '10.0.0.0/16' } }),
      makeDeps('http://render.local'),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('http://render.local/render')
    expect(openPreviewMock).toHaveBeenCalledTimes(1)
    const payload = openedPayload()
    expect(payload.title).toBe('Blueprint preview — aws-vpc')
    // A published chart's dry run holds nothing: an inspection, shown in the drawer, never adopted
    // by a page composer and never written into by a Files-tab edit.
    expect(payload.builder).toBe('inspect')
    expect(payload.error).toBeUndefined()
    expect(payload.objects).toEqual([{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'web', namespace: 'demo', yaml: 'kind: Deployment' }])
    expect(chip).toEqual({ label: 'preview aws-vpc (1 object)', readOnly: true, verb: 'previewBlueprint' })
  })

  it('a render {error} is shown AS the preview content — a bad chart is data', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ error: 'template: vpc.yaml: required value missing' }),
      ok: true,
      status: 200,
    })))
    const chip = await previewBlueprintSpec.apply(asProposal('previewBlueprint', { chart }), makeDeps('http://render.local'))
    expect(openPreviewMock).toHaveBeenCalledTimes(1)
    expect(openedPayload().error).toBe('template: vpc.yaml: required value missing')
    // `previewFailed` is what stops the host arming the publish gate on a chart that does
    // not render. Asserted here rather than only in the provider, because it is the chip's
    // contract: the drawer showed this error all along and nothing acted on it.
    expect(chip).toEqual({ label: 'preview aws-vpc (render failed)', previewFailed: true, readOnly: true, verb: 'previewBlueprint' })
  })

  it('honors the proposal label on the chip', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ objects: [] }), ok: true, status: 200 })))
    const chip = await previewBlueprintSpec.apply(
      asProposal('previewBlueprint', { chart, label: 'previewed the VPC blueprint' }),
      makeDeps('http://render.local'),
    )
    expect(chip?.label).toBe('previewed the VPC blueprint')
  })
})

describe('previewBlueprint — server-side RESTAction transport (preferred)', () => {
  const chart = { url: 'oci://ghcr.io/x/aws-vpc', version: '1.0.0' }

  /** The RA path GETs snowplow /call?resource=restactions&name=blueprint-render&extras=<json>. */
  const raResponse = (status: unknown, ok = true, httpStatus = 200) => vi.fn((..._args: unknown[]) =>
    Promise.resolve({ json: () => Promise.resolve({ status }), ok, status: httpStatus }))

  it('fetches the blueprint-render RESTAction via /call (GET, with the args in ?extras) and opens the drawer', async () => {
    const fetchMock = raResponse({
      objects: [{ apiVersion: 'ec2.services.k8s.aws/v1alpha1', kind: 'VPC', name: 'demo-vpc', namespace: 'demo-system', yaml: 'kind: VPC' }],
      valuesSchema: { type: 'object' },
    })
    vi.stubGlobal('fetch', fetchMock)
    const chip = await previewBlueprintSpec.apply(
      asProposal('previewBlueprint', { chart, values: { cidr: '10.0.0.0/16' } }),
      makeRADeps(),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined]
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('http://snowplow.local/call')
    expect(parsed.searchParams.get('resource')).toBe('restactions')
    expect(parsed.searchParams.get('apiVersion')).toBe('templates.krateo.io/v1')
    expect(parsed.searchParams.get('name')).toBe('blueprint-render')
    expect(parsed.searchParams.get('namespace')).toBe('krateo-system')
    // the exactly-one-of source + values ride in ?extras
    expect(JSON.parse(parsed.searchParams.get('extras') ?? '{}')).toEqual({ chart, values: { cidr: '10.0.0.0/16' } })
    // GET, not POST — the render service is never browser-hit; snowplow POSTs it in-cluster
    expect(init?.method).toBeUndefined()
    const payload = openedPayload()
    expect(payload.title).toBe('Blueprint preview — aws-vpc')
    expect(payload.error).toBeUndefined()
    expect(payload.objects).toEqual([{ apiVersion: 'ec2.services.k8s.aws/v1alpha1', kind: 'VPC', name: 'demo-vpc', namespace: 'demo-system', yaml: 'kind: VPC' }])
    expect(chip).toEqual({ label: 'preview aws-vpc (1 object)', readOnly: true, verb: 'previewBlueprint' })
  })

  it('reads the render {error} out of the RESTAction .status (a bad chart is data)', async () => {
    vi.stubGlobal('fetch', raResponse({ error: 'chart: failed to pull oci://…:9.9.9: not found', objects: [] }))
    const chip = await previewBlueprintSpec.apply(asProposal('previewBlueprint', { chart }), makeRADeps())
    expect(openedPayload().error).toBe('chart: failed to pull oci://…:9.9.9: not found')
    // `previewFailed` is what stops the host arming the publish gate on a chart that does
    // not render. Asserted here rather than only in the provider, because it is the chip's
    // contract: the drawer showed this error all along and nothing acted on it.
    expect(chip).toEqual({ label: 'preview aws-vpc (render failed)', previewFailed: true, readOnly: true, verb: 'previewBlueprint' })
  })

  it('a non-2xx from snowplow (RA missing / RBAC) surfaces as content, never a throw', async () => {
    vi.stubGlobal('fetch', raResponse(null, false, 403))
    const chip = await previewBlueprintSpec.apply(asProposal('previewBlueprint', { chart }), makeRADeps())
    expect(openedPayload().error).toBe('blueprint-render RESTAction responded 403')
    expect(chip?.label).toBe('preview aws-vpc (render failed)')
  })

  it('PREFERS the RA over a direct renderBaseUrl when both are configured', async () => {
    const fetchMock = raResponse({ objects: [] })
    vi.stubGlobal('fetch', fetchMock)
    await previewBlueprintSpec.apply(
      asProposal('previewBlueprint', { chart }),
      makeRADeps({ renderBaseUrl: 'http://render.local' }),
    )
    // the fetch went to snowplow /call, NOT the direct render service
    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toBe('/call')
  })
})

describe('previewPage — honest source preview, zero network', () => {
  const widgets = [
    { apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Flex', metadata: { name: 'page-root', namespace: 'krateo-system' } },
    { kind: 'Table', metadata: { name: 'rows' } },
  ]

  it('opens the drawer with one YAML entry per proposed widget CR — and NEVER fetches', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const chip = await previewPageSpec.apply(asProposal('previewPage', { widgets }), makeDeps('http://render.local'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openPreviewMock).toHaveBeenCalledTimes(1)
    const payload = openedPayload()
    expect(payload.objects).toHaveLength(2)
    expect(payload.objects?.[0]).toMatchObject({ kind: 'Flex', name: 'page-root', namespace: 'krateo-system' })
    expect(payload.caption).toContain('Source preview')
    // A page is the one kind with no `builder` — the composer adopts exactly those.
    expect(payload.builder).toBeUndefined()
    expect(chip).toEqual({ label: 'preview page (2 widgets)', readOnly: true, verb: 'previewPage' })
  })

  it('a set with NO page-<slug> root is an inspection — the store cannot hold it, so nothing may edit it', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const rootless = [{ apiVersion: 'widgets.templates.krateo.io/v1beta1', kind: 'Table', metadata: { name: 'pods', namespace: 'krateo-system' }, spec: { widgetData: {} } }]
    await previewPageSpec.apply(asProposal('previewPage', { widgets: rootless }), makeDeps())
    expect(openedPayload().builder).toBe('inspect')
  })

  it('denies malformed args (empty list / kind-less entry): null, no drawer', async () => {
    const deps = makeDeps()
    expect(previewPageSpec.argSchema(asProposal('previewPage', { widgets: [] }))).toBe(false)
    expect(await previewPageSpec.apply(asProposal('previewPage', { widgets: [] }), deps)).toBeNull()
    expect(await previewPageSpec.apply(asProposal('previewPage', { widgets: [{ metadata: {} }] }), deps)).toBeNull()
    expect(await previewPageSpec.apply(asProposal('previewPage', {}), deps)).toBeNull()
    expect(openPreviewMock).not.toHaveBeenCalled()
  })
})

describe('previewRestDef — structured source preview, zero network', () => {
  const restDefinition = {
    apiVersion: 'ogen.krateo.io/v1alpha1',
    kind: 'RestDefinition',
    metadata: { name: 'gh-repo', namespace: 'krateo-system' },
    spec: {
      oasPath: 'https://example.com/gh.yaml',
      resource: {
        kind: 'Repo',
        verbsDescription: [
          { action: 'create', method: 'POST', path: '/orgs/{org}/repos' },
          { action: 'get', method: 'GET', path: '/repos/{owner}/{repo}' },
        ],
      },
      resourceGroup: 'github.ogen.krateo.io',
    },
  }

  it('opens the drawer with the draft YAML + the mapped verbs/paths summary — no fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const chip = await previewRestDefSpec.apply(asProposal('previewRestDef', { restDefinition }), makeDeps())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openPreviewMock).toHaveBeenCalledTimes(1)
    const payload = openedPayload()
    expect(payload.title).toBe('RestDefinition preview — gh-repo')
    expect(payload.builder).toBe('restdef')
    expect(payload.summary).toEqual([
      'kind: Repo',
      'group: github.ogen.krateo.io',
      'create · POST /orgs/{org}/repos',
      'get · GET /repos/{owner}/{repo}',
    ])
    expect(payload.objects?.[0].yaml).toContain('kind: RestDefinition')
    expect(chip).toEqual({ label: 'RestDefinition preview — gh-repo', readOnly: true, verb: 'previewRestDef' })
  })

  it('FE-P5 (KOG): a problems-carrying draft yields the "preview blocked" chip convention', async () => {
    const { spec, ...rest } = restDefinition
    const { oasPath, ...specNoPath } = spec
    void oasPath
    const chip = await previewRestDefSpec.apply(asProposal('previewRestDef', { restDefinition: { ...rest, spec: specNoPath } }), makeDeps())
    expect(chip?.label).toMatch(/^preview blocked — \d+ validation error/)
  })

  it('denies malformed args (missing / non-object / empty draft): null, no drawer', async () => {
    const deps = makeDeps()
    expect(previewRestDefSpec.argSchema(asProposal('previewRestDef', {}))).toBe(false)
    expect(await previewRestDefSpec.apply(asProposal('previewRestDef', {}), deps)).toBeNull()
    expect(await previewRestDefSpec.apply(asProposal('previewRestDef', { restDefinition: 'kind: RestDefinition' }), deps)).toBeNull()
    expect(await previewRestDefSpec.apply(asProposal('previewRestDef', { restDefinition: {} }), deps)).toBeNull()
    expect(openPreviewMock).not.toHaveBeenCalled()
  })
})

describe('explainUpgradeImpact — the version-diff explain verb', () => {
  const stubFetch = (impl: (...fetchArgs: unknown[]) => unknown) => {
    const fetchMock = vi.fn(impl)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }
  const args = { name: 'aws-vpc', namespace: 'demo', toVersion: '1.2.0' }

  it('is a registered read-only verb', () => {
    expect(READONLY_VERB_REGISTRY.explainUpgradeImpact?.sideEffect).toBe('read')
    expect(isReadOnlyVerb('explainUpgradeImpact')).toBe(true)
  })

  it('DENIES malformed args (missing toVersion) — null, no fetch, no drawer', async () => {
    const fetchMock = stubFetch(() => Promise.resolve({ json: () => Promise.resolve({}), ok: true, status: 200 }))
    expect(await explainUpgradeImpactSpec.apply(asProposal('explainUpgradeImpact', { name: 'x', namespace: 'demo' }), makeRADeps())).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openPreviewMock).not.toHaveBeenCalled()
  })

  it('unavailable chip (ZERO network) when the RA transport is not configured', async () => {
    const fetchMock = stubFetch(() => Promise.resolve({ json: () => Promise.resolve({}), ok: true, status: 200 }))
    const chip = await explainUpgradeImpactSpec.apply(asProposal('explainUpgradeImpact', args), makeRADeps({ snowplowBaseUrl: undefined }))
    expect(chip).toEqual({ label: UPGRADE_IMPACT_UNAVAILABLE_LABEL, readOnly: true, verb: 'explainUpgradeImpact' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openPreviewMock).not.toHaveBeenCalled()
  })

  it('fetches the RA and renders the shaped diff into the drawer', async () => {
    stubFetch(() => Promise.resolve({
      json: () => Promise.resolve({ status: {
        from: '1.1.0',
        rows: [{ change: 'modified', detail: 'changed: replicas', kind: 'Deployment', name: 'api', namespace: 'demo' }],
        summary: '0 added · 0 removed · 1 modified · values schema changed',
        to: '1.2.0',
        valuesSchemaChanged: true,
      } }),
      ok: true,
      status: 200,
    }))
    const chip = await explainUpgradeImpactSpec.apply(asProposal('explainUpgradeImpact', args), makeRADeps())
    expect(chip?.verb).toBe('explainUpgradeImpact')
    expect(chip?.readOnly).toBe(true)
    expect(chip?.label).toContain('upgrade impact → 1.2.0')
    const payload = openedPayload()
    expect(payload.title).toBe('Upgrade impact — 1.1.0 → 1.2.0')
    expect(payload.builder).toBe('inspect')
    expect(payload.summary).toContain('~ Deployment demo/api — changed: replicas')
    expect(payload.error).toBeUndefined()
  })

  it('renders a render/diff failure as drawer content (chip says diff failed)', async () => {
    stubFetch(() => Promise.resolve({ json: () => Promise.resolve({ status: { error: 'chart: not found', from: '1.1.0', to: '1.2.0' } }), ok: true, status: 200 }))
    const chip = await explainUpgradeImpactSpec.apply(asProposal('explainUpgradeImpact', args), makeRADeps())
    expect(chip?.label).toContain('diff failed')
    expect(openedPayload().error).toBe('chart: not found')
  })
})

describe('describeResource — an inspection, not a draft', () => {
  it('opens the drawer tagged as an inspection, even when the CRD read fails', async () => {
    // A 404 is content, not a throw — and either way the payload must not read as a PAGE draft, or a
    // mounted page composer adopts a CRD description as the page being authored.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve({}), ok: false, status: 404 })))
    await describeResourceSpec.apply(
      asProposal('describeResource', { gvr: { group: 'github.krateo.io', resource: 'repositories', version: 'v1alpha1' } }),
      makeRADeps(),
    )
    expect(openPreviewMock).toHaveBeenCalledTimes(1)
    expect(openedPayload().builder).toBe('inspect')
  })
})
