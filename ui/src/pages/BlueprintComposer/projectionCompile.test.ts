/**
 * S12a: the descriptor compiles to the `<chart>-status` RESTAction a CompositionDefinition's apiRef
 * can name, and to the statusDataTemplate rows that project it. What core-provider refuses, refused
 * here first; what the page computes, computed by the same jq.
 */
/* eslint-disable no-template-curly-in-string -- fixtures and expectations are literal ${ jq } substitutions (snowplow and CDC syntax). */
import { createHash } from 'node:crypto'

import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { edgeChart } from './__fixtures__/s4b'
import { ARCHITECTURE_TEMPLATE_PATH, parseArchitecture, serializeArchitecture, unwrapFromConfigMapTemplate, type ChartArchitecture } from './architecture'
import { S11_ARCH_STEP_FILTER, S11_OBJECT_FILTER, S11_TOP_FILTER } from './architectureStateJq'
import { ARCHITECTURE_ROWS, compileProjection, statusRestActionPath } from './projectionCompile'

interface Step { name: string; path: string; verb: string; dependsOn?: unknown; endpointRef?: unknown; filter: string; errorKey: string; continueOnError: boolean }
interface RestAction { apiVersion: string; kind: string; metadata: { name: string; namespace: string }; spec: { api: Step[]; filter: string } }

const archOf = (files: Record<string, string>): ChartArchitecture => {
  const parsed = parseArchitecture(unwrapFromConfigMapTemplate(files[ARCHITECTURE_TEMPLATE_PATH]) ?? '')
  if (!parsed.ok) { throw new Error(JSON.stringify(parsed.problems)) }
  return parsed.architecture
}

const compiled = (arch: ChartArchitecture) => {
  const out = compileProjection(arch)
  if (!out.ok) { throw new Error(out.reason) }
  return { ...out, ra: load(out.restaction) as RestAction }
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

describe('the <chart>-status RESTAction', () => {
  it('is dispatch-free: no dependsOn, no endpointRef, every path built from the CDC extras alone', () => {
    // core-provider asks snowplow's GET /rbac for the read-set WITHOUT dispatching: a dependsOn, a
    // `${…}` left after the extras, or a non-kube path is ErrIncomplete and the composition gets no
    // RBAC (restactionrbac.go:26-31). So a path may read nothing but the extras.
    const { ra } = compiled(archOf(edgeChart()))
    expect(ra.kind).toBe('RESTAction')
    expect(ra.metadata).toMatchObject({ name: 'orders-status', namespace: 'krateo-system' })
    for (const step of ra.spec.api) {
      expect(step.dependsOn).toBeUndefined()
      expect(step.endpointRef).toBeUndefined()
      expect(step.verb).toBe('GET')
      // The keys the jq reads — string literals (the path segments) removed first.
      const reads = [...step.path.replace(/"[^"]*"/g, '""').matchAll(/\.([A-Za-z]+)/g)].map((match) => match[1])
      expect(reads.length).toBeGreaterThan(0)
      expect(reads.every((key) => ['compositionNamespace', 'namespace', 'compositionName', 'name'].includes(key))).toBe(true)
      expect(step.path).toMatch(/^\$\{ "\/apis?\//)
    }
  })

  it('reads the architecture ConfigMap, then ONE namespaced LIST per kind the nodes use', () => {
    const { ra } = compiled(archOf(edgeChart()))
    expect(ra.spec.api.map((step) => step.name)).toEqual(['arch', 'o0', 'o1', 'o2', 'o3', 'o4'])
    expect(ra.spec.api[0].path).toBe('${ "/api/v1/namespaces/" + ((.compositionNamespace // .namespace) // "") + "/configmaps/" + ((.compositionName // .name) // "") + "-architecture" }')
    expect(ra.spec.api[1].path).toBe('${ "/apis/github.krateo.io/v2022-11-28/namespaces/" + ((.compositionNamespace // .namespace) // "") + "/repositories" }')
    // Two nodes of one kind share a LIST.
    const twice: ChartArchitecture = { apiVersion: 'architecture.krateo.io/v1alpha1',
      chart: 'x',
      kind: 'ChartArchitecture',
      resources: [
        { apiVersion: 'v1', class: 'native', id: 'a', kind: 'ConfigMap', resource: 'configmaps', template: 'templates/a.yaml' },
        { apiVersion: 'v1', class: 'native', id: 'b', kind: 'ConfigMap', resource: 'configmaps', template: 'templates/b.yaml' },
      ] }
    const shared = compiled(twice).ra.spec.api
    expect(shared.map((step) => step.name)).toEqual(['arch', 'o0'])
    expect(shared[1].path).toBe('${ "/api/v1/namespaces/" + ((.compositionNamespace // .namespace) // "") + "/configmaps" }')
  })

  it('runs the S11 page filter VERBATIM — the controller and the page cannot disagree about the state', () => {
    // The digests are the portal file's own (helm/portal/templates/restaction.composition-architecture.yaml
    // at portal f73ad15). A change to either copy without the other fails here.
    expect(sha(S11_ARCH_STEP_FILTER)).toBe('d17b7211bda6d3277625adb5c9c0ef5a69d65c36d9da685f43ee65ae02f45f76')
    expect(sha(S11_OBJECT_FILTER)).toBe('90c0dc9ab9e5dc0cc00f428905c167becdb595a924d49e447d847849d0e2472d')
    expect(sha(S11_TOP_FILTER)).toBe('3e88fa4ca537d455e527f415a1e3dd5b291d13d5fdc9a84acde113276dcc2161')
    const { ra } = compiled(archOf(edgeChart()))
    expect(ra.spec.api[0].filter).toBe(S11_ARCH_STEP_FILTER)
    expect(ra.spec.filter).toContain(S11_TOP_FILTER)
    // Every LIST's errors are kept apart, so the fold can tell which kind could not be listed.
    expect(ra.spec.api.slice(1).map((step) => step.errorKey)).toEqual(['o0Err', 'o1Err', 'o2Err', 'o3Err', 'o4Err'])
    expect(ra.spec.api.every((step) => step.continueOnError)).toBe(true)
  })

  it('is byte-stable, and commits at the chart root as restaction.<chart>-status.yaml', () => {
    expect(compileProjection(archOf(edgeChart()))).toEqual(compileProjection(archOf(edgeChart())))
    expect(statusRestActionPath('orders')).toBe('restaction.orders-status.yaml')
    expect(compiled(archOf(edgeChart())).path).toBe('restaction.orders-status.yaml')
  })
})

describe('refusals', () => {
  it('names every node that has no plural — a kind cannot be listed without one', () => {
    const arch = archOf(edgeChart())
    const bare = { ...arch, resources: arch.resources.map((node) => (node.id === 'repo' || node.id === 'mongodb' ? { ...node, resource: undefined } : node)) }
    expect(compileProjection(bare)).toEqual({ ok: false, reason: 'Status projection lists each resource by its plural — add resource: to repo, mongodb in templates/architecture.yaml.' })
  })

  it('has nothing to project for a chart with no sequenced resources', () => {
    expect(compileProjection({ apiVersion: 'architecture.krateo.io/v1alpha1', chart: 'x', kind: 'ChartArchitecture', resources: [] }).ok).toBe(false)
  })
})

describe('apiRef and statusDataTemplate', () => {
  it('always projects the architecture rows first, typed — never workloadHealthy', () => {
    const out = compiled(archOf(edgeChart()))
    expect(out.apiRef).toEqual({ name: 'orders-status', namespace: 'krateo-system' })
    expect(out.statusDataTemplate).toEqual([...ARCHITECTURE_ROWS])
    expect(out.statusDataTemplate.map((row) => row.forPath)).not.toContain('workloadHealthy')
  })

  it('appends the author rows and carries the static extras into apiRef', () => {
    const arch = { ...archOf(edgeChart()), status: { extras: { appNamespace: '{{ .Values.namespace }}' }, project: [{ expression: '${ .api.nodes | length }', forPath: 'nodes', type: 'integer' as const }] } }
    const out = compiled(arch)
    expect(out.apiRef.extras).toEqual({ appNamespace: '{{ .Values.namespace }}' })
    expect(out.statusDataTemplate.slice(ARCHITECTURE_ROWS.length)).toEqual([{ expression: '${ .api.nodes | length }', forPath: 'nodes', type: 'integer' }])
  })
})

describe('the descriptor\'s status: section and resource field', () => {
  const base = (extra: string): string => [
    'apiVersion: architecture.krateo.io/v1alpha1',
    'kind: ChartArchitecture',
    'chart: x',
    'resources:',
    '  - { id: a, class: native, apiVersion: v1, kind: ConfigMap, resource: configmaps, template: templates/a.yaml }',
    extra,
  ].join('\n')
  const problems = (text: string): string[] => {
    const parsed = parseArchitecture(text)
    return parsed.ok ? [] : parsed.problems.map((problem) => `${problem.path}: ${problem.message}`)
  }

  it('round-trips, in a stable key order', () => {
    const text = base('status:\n  extras: { appNamespace: demo }\n  project:\n    - { forPath: endpoint, expression: "${ .api.endpoint }", type: string }')
    const parsed = parseArchitecture(text)
    if (!parsed.ok) { throw new Error(JSON.stringify(parsed.problems)) }
    expect(parsed.architecture.status).toEqual({ extras: { appNamespace: 'demo' }, project: [{ expression: '${ .api.endpoint }', forPath: 'endpoint', type: 'string' }] })
    expect(parsed.architecture.resources[0].resource).toBe('configmaps')
    const again = parseArchitecture(serializeArchitecture(parsed.architecture))
    expect(again.ok && again.architecture).toEqual(parsed.architecture)
  })

  it('refuses what core-provider would: a reserved or generated field, a duplicate, a bare expression, a .status prefix', () => {
    const rows = (row: string) => problems(base(`status:\n  project:\n${row}`))
    expect(rows('    - { forPath: conditions, expression: "${ 1 }" }')[0]).toMatch(/conditions is the controller's own status field/)
    expect(rows('    - { forPath: architectureReady, expression: "${ 1 }" }')[0]).toMatch(/generated from the architecture/)
    expect(rows('    - { forPath: a, expression: "${ 1 }" }\n    - { forPath: a, expression: "${ 2 }" }')[0]).toMatch(/already projected/)
    expect(rows('    - { forPath: a, expression: ".api.x" }')[0]).toMatch(/one \$\{ jq \} substitution/)
    expect(rows('    - { forPath: .status.a, expression: "${ 1 }" }')[0]).toMatch(/written without it/)
    expect(rows('    - { forPath: a, expression: "${ 1 }", type: map }')[0]).toMatch(/one of string/)
  })

  it('refuses a plural the apiserver could not serve', () => {
    expect(problems(base('').replace('resource: configmaps', 'resource: ConfigMaps'))[0]).toMatch(/resource: must be the plural/)
  })
})
