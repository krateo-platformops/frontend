/**
 * Wave-4 preview bridge — pure-logic coverage (no RTL/jsdom, no network), matching the repo's
 * other Autopilot tests:
 *   - the arg guards DENY malformed proposals (null) and accept the contract;
 *   - the payload builders turn a parsed draft into exactly what the drawer shows;
 *   - previewRestDef's summary extraction parses verbs/paths from a CR fixture;
 *   - the `parse*Edit` guards re-validate a hand-edited source and surface a bad edit as
 *     data (ok=false plus the error line), never as a throw.
 *
 * The transport seams live in previewBridge.transport.test.ts — they are the only part that
 * stubs fetch, and keeping them apart is what lets this file stay pure.
 */
import { describe, expect, it } from 'vitest'

import type { PortalActionProposal } from './actionBridge'
import {
  buildPagePreviewPayload,
  buildRestDefPreviewPayload,
  buildUpgradeImpactPayload,
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
  ({ verb: 'previewBlueprint', ...extra })

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

  // A `---` separator is ordinary in both kinds of file, and js-yaml's single-document `load`
  // throws on it. The portal chart has seven multi-document template files; one holds fifteen.
  it('accepts a MULTI-DOCUMENT blueprint chart template', () => {
    const multi = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: a\n---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: b\n'
    expect(parseFileEdit(multi, false).ok).toBe(true)
  })

  it('accepts a MULTI-DOCUMENT widget-CR file when every document carries the CR shape', () => {
    const multi = 'apiVersion: widgets.templates.krateo.io/v1beta1\nkind: Flex\nmetadata:\n  name: a\n---\napiVersion: widgets.templates.krateo.io/v1beta1\nkind: Card\nmetadata:\n  name: b\n'
    expect(parseFileEdit(multi, true).ok).toBe(true)
  })

  it('rejects a multi-document CR file when a LATER document is malformed — not just the first', () => {
    const multi = 'apiVersion: widgets.templates.krateo.io/v1beta1\nkind: Flex\nmetadata:\n  name: a\n---\nkind: Card\nmetadata:\n  name: b\n'
    expect(parseFileEdit(multi, true).ok).toBe(false)
    expect(parseFileEdit(multi, true).problems).toEqual([FILE_EDIT_SHAPE_ERROR])
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
    expect(parseUpgradeImpactArgs(asProposal({ name: 'x', namespace: 'demo', toVersion: 5 }))).toBeNull()
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
