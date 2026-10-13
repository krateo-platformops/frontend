/**
 * S12a: the descriptor compiles to the `<chart>-status` RESTAction a CompositionDefinition's apiRef
 * can name, and to the statusDataTemplate rows that project it. What core-provider refuses, refused
 * here first; what the page computes, computed by the same jq.
 */
/* eslint-disable no-template-curly-in-string -- fixtures and expectations are literal ${ jq } substitutions (snowplow and CDC syntax). */
import { createHash } from 'node:crypto'

import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import stale from './__fixtures__/eventSiteStatusStale.json'
import { edgeChart } from './__fixtures__/s4b'
import { ARCHITECTURE_TEMPLATE_PATH, parseArchitecture, serializeArchitecture, unwrapFromConfigMapTemplate, type ChartArchitecture } from './architecture'
import { S11_ARCH_STEP_FILTER, S11_OBJECT_FILTER, S11_TOP_FILTER } from './architectureStateJq'
import { ARCHITECTURE_ROWS, compileProjection, FILTER_DIGEST_ANNOTATION, filterDigest, GENERATED_BY_ANNOTATION, PROJECTION_BUNDLE_PATH, projectionForFiles, recoverArchitecture, regenerateProjection } from './projectionCompile'
import { blueprintCompositionDefinition } from './startChart'

interface Step { name: string; path: string; verb: string; dependsOn?: unknown; endpointRef?: unknown; filter: string; errorKey: string; continueOnError: boolean }
interface RestAction { apiVersion: string; kind: string; metadata: { name: string; namespace: string; annotations: Record<string, string> }; spec: { api: Step[]; filter: string } }

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
    // These pin THIS repo's copy. They were the portal file's own at portal f73ad15, and are not any
    // longer: portal #254 added `gateOpen` and `compositionNotSynced` to its copy and not to this one.
    // So the guard is one-directional — it catches a change here, never a change there.
    expect(sha(S11_ARCH_STEP_FILTER)).toBe('d17b7211bda6d3277625adb5c9c0ef5a69d65c36d9da685f43ee65ae02f45f76')
    expect(sha(S11_OBJECT_FILTER)).toBe('90c0dc9ab9e5dc0cc00f428905c167becdb595a924d49e447d847849d0e2472d')
    expect(sha(S11_TOP_FILTER)).toBe('92befd95d84792bcc6689c850894fdc2ae6d1cbb0ec17b0b25fce9aef067dfdd')
    const { ra } = compiled(archOf(edgeChart()))
    expect(ra.spec.api[0].filter).toBe(S11_ARCH_STEP_FILTER)
    expect(ra.spec.filter).toContain(S11_TOP_FILTER)
    // Every LIST's errors are kept apart, so the fold can tell which kind could not be listed.
    expect(ra.spec.api.slice(1).map((step) => step.errorKey)).toEqual(['o0Err', 'o1Err', 'o2Err', 'o3Err', 'o4Err'])
    expect(ra.spec.api.every((step) => step.continueOnError)).toBe(true)
  })

  it('is byte-stable, and bundles as JSON — the one form the portal\'s jq can read back', () => {
    expect(compileProjection(archOf(edgeChart()))).toEqual(compileProjection(archOf(edgeChart())))
    expect(PROJECTION_BUNDLE_PATH).toBe('status-projection.json')
    const out = compiled(archOf(edgeChart()))
    const bundle = JSON.parse(out.bundle) as { apiRef: unknown; restaction: RestAction; statusDataTemplate: unknown }
    expect(bundle.apiRef).toEqual(out.apiRef)
    expect(bundle.statusDataTemplate).toEqual(out.statusDataTemplate)
    expect(bundle.restaction).toEqual(out.ra)
  })

  it('a held chart projects when its descriptor compiles, and not otherwise — never refusing a publish', () => {
    expect(projectionForFiles(edgeChart())?.apiRef.name).toBe('orders-status')
    expect(projectionForFiles({ 'Chart.yaml': 'name: x' })).toBeNull()
    const files = edgeChart()
    expect(projectionForFiles({ ...files, 'templates/architecture.yaml': files['templates/architecture.yaml'].replace(/\n\s*resource: repositories/, '') })).toBeNull()
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

describe('the CompositionDefinition a projecting chart publishes', () => {
  it('carries apiRef and statusDataTemplate under spec — and one without a projection is unchanged', () => {
    const projection = projectionForFiles(edgeChart())
    const withIt = load(blueprintCompositionDefinition('orders', 'krateo-blueprints', 'orders', '0.1.0', projection) ?? '') as { spec: Record<string, unknown> }
    expect(withIt.spec.chart).toEqual({ url: 'oci://ghcr.io/krateo-blueprints/charts/orders', version: '0.1.0' })
    expect(withIt.spec.apiRef).toEqual({ name: 'orders-status', namespace: 'krateo-system' })
    expect(withIt.spec.statusDataTemplate).toEqual([...ARCHITECTURE_ROWS])
    expect(blueprintCompositionDefinition('orders', 'krateo-blueprints', 'orders', '0.1.0')).toBe(blueprintCompositionDefinition('orders', 'krateo-blueprints', 'orders', '0.1.0', null))
    expect(blueprintCompositionDefinition('orders', 'krateo-blueprints', 'orders', '0.1.0')).not.toContain('apiRef')
  })
})

describe('provenance on the emitted RESTAction (#483)', () => {
  // This RESTAction is a COPY of the generator's jq, applied with no Helm release and no
  // ownerReferences, so no chart upgrade reaches it. These annotations do not fix that — they make
  // "which generator wrote this, and has its filter drifted?" a query rather than an investigation.
  // #482 is the case that proves it matters: the generator was fixed and released while event-site,
  // published 2026-10-06, kept reporting architectureLevel 0 for resources that were Ready.
  it('stamps the generator version and a digest OF THE FILTER THAT SHIPS', () => {
    const { ra } = compiled(archOf(edgeChart()))
    expect(ra.metadata.annotations['krateo.io/generated-from']).toBe('templates/architecture.yaml')
    expect(ra.metadata.annotations[GENERATED_BY_ANNOTATION]).toMatch(/^frontend-/)
    // The digest must be of the rendered filter, not of the template or the whole manifest —
    // otherwise it cannot answer the only question it exists to answer.
    expect(ra.metadata.annotations[FILTER_DIGEST_ANNOTATION]).toBe(filterDigest(ra.spec.filter))
  })

  it('changes the digest when the filter changes, and not when it does not', () => {
    const once = compiled(archOf(edgeChart()))
    const twice = compiled(archOf(edgeChart()))
    expect(twice.ra.metadata.annotations[FILTER_DIGEST_ANNOTATION]).toBe(once.ra.metadata.annotations[FILTER_DIGEST_ANNOTATION])
    // A drifted copy — one node's readyWhen switched to the condition form, exactly the #482 shape.
    expect(filterDigest(`${once.ra.spec.filter}\n# drift`)).not.toBe(once.ra.metadata.annotations[FILTER_DIGEST_ANNOTATION])
  })

  it('does not put the stamp inside the filter, so provenance cannot change what the filter computes', () => {
    const { ra } = compiled(archOf(edgeChart()))
    expect(ra.spec.filter).not.toContain(GENERATED_BY_ANNOTATION)
    expect(ra.spec.filter).not.toContain(FILTER_DIGEST_ANNOTATION)
    expect(ra.spec.filter).not.toContain('frontend-')
  })

  it('is carried in the committed bundle, so a published blueprint records its own provenance', () => {
    const out = projectionForFiles(edgeChart())
    const bundle = JSON.parse(out?.bundle ?? '{}') as { restaction: RestAction }
    expect(bundle.restaction.metadata.annotations[GENERATED_BY_ANNOTATION]).toMatch(/^frontend-/)
    expect(bundle.restaction.metadata.annotations[FILTER_DIGEST_ANNOTATION]).toBe(filterDigest(bundle.restaction.spec.filter))
  })
})

describe('regenerating a published projection from the live object (#483)', () => {
  // The repair half. snowplow's `spec.filter` is a literal string with no indirection, and a stage
  // with dependsOn makes core-provider's read-set unresolvable — so the copy cannot be removed. What
  // it can have is an upgrade path, and the object carries everything needed to recompile itself.
  it('round-trips: recompiling a freshly compiled RESTAction reproduces it exactly, and reports no change', () => {
    const { ra } = compiled(archOf(edgeChart()))
    const again = regenerateProjection(ra)
    if (!again.ok) { throw new Error(again.reason) }
    expect(again.restaction).toEqual(JSON.parse(JSON.stringify(ra)))
    expect(again.changed).toEqual([])
  })

  it('recovers the kinds and the node ids each LIST serves, from the object alone', () => {
    const { ra } = compiled(archOf(edgeChart()))
    const recovered = recoverArchitecture(ra)
    if (!recovered.ok) { throw new Error(recovered.reason) }
    const source = archOf(edgeChart()).resources.filter((node) => !node.lifecycle)
    expect(recovered.architecture.chart).toBe(archOf(edgeChart()).chart)
    expect(recovered.architecture.resources.map((node) => node.id).sort()).toEqual(source.map((node) => node.id).sort())
    for (const node of recovered.architecture.resources) {
      const original = source.find((candidate) => candidate.id === node.id)
      expect([node.apiVersion, node.resource]).toEqual([original?.apiVersion, original?.resource])
    }
  })

  it('repairs the real event-site-status that #483 was filed about', () => {
    // The object as it stood on krateo-057 on 2026-10-12: published 2026-10-06 from frontend 1.8.0,
    // unstamped, still running the pre-#482 filter that read only the FIELD form of readyWhen — so
    // both live EventSites reported architectureLevel 0 for resources that were Ready.
    const out = regenerateProjection(stale)
    if (!out.ok) { throw new Error(out.reason) }
    expect(out.changed).toContain('filter')
    expect(out.changed).toContain('provenance')
    const spec = out.restaction.spec as { api: Step[]; filter: string }
    // The computation is the current one...
    expect(spec.filter).toContain(S11_TOP_FILTER)
    expect(stale.spec.filter).not.toContain(S11_TOP_FILTER)
    // ...and the per-chart half it was wrapped in survives verbatim: same four kinds, same ids.
    expect(spec.api.map((step) => step.path)).toEqual(stale.spec.api.map((step) => step.path))
    expect(spec.filter).toContain('[{"ids":["deployment"],"step":"o0"},{"ids":["service"],"step":"o1"},{"ids":["form"],"step":"o2"},{"ids":["computeinstance"],"step":"o3"}] as $steps')
  })

  it('refuses rather than guesses when the object is not one of ours', () => {
    expect(recoverArchitecture({ metadata: { name: 'composition-events' }, spec: { filter: 'x' } }).ok).toBe(false)
    expect(recoverArchitecture({ metadata: { name: 'a-status' }, spec: { filter: 'no steps here' } }).ok).toBe(false)
    // A step the fold names but no stage provides: the kinds would be invented.
    const { ra } = compiled(archOf(edgeChart()))
    const missing = JSON.parse(JSON.stringify(ra)) as RestAction
    missing.spec.api = missing.spec.api.filter((step) => step.name !== 'o0')
    expect(recoverArchitecture(missing).ok).toBe(false)
    // Path and stage filter disagreeing about the apiVersion — not this generator's output.
    const forged = JSON.parse(JSON.stringify(ra)) as RestAction
    forged.spec.api[1].filter = forged.spec.api[1].filter.replace(/apiVersion: "[^"]*"/, 'apiVersion: "other/v1"')
    expect(recoverArchitecture(forged).ok).toBe(false)
  })

  it('will not move a stage path, because the composition\'s RBAC is derived from them', () => {
    const { ra } = compiled(archOf(edgeChart()))
    const moved = JSON.parse(JSON.stringify(ra)) as RestAction
    moved.spec.api.pop()
    const out = regenerateProjection(moved)
    // Dropping a stage drops its fold entry too, so this recompiles to a DIFFERENT shape — the
    // guard is the backstop for a live object whose stages were edited out of band.
    if (out.ok) { expect(out.restaction.spec).toEqual(moved.spec) }
  })
})

describe('comparing against what the apiserver returns, not against what we wrote', () => {
  it('does not report a change when only the key ORDER differs', () => {
    // The compiler emits a stage as name, path, verb, headers, continueOnError, errorKey, filter.
    // The apiserver hands it back alphabetically. A serialization-order comparison calls that a
    // change on every run, which would make the regenerator write unconditionally and never report
    // a fleet as current — observed live on krateo-057 against the real event-site-status.
    const { ra } = compiled(archOf(edgeChart()))
    const reordered = JSON.parse(JSON.stringify(ra)) as RestAction
    reordered.spec.api = reordered.spec.api.map((step) => Object.fromEntries(
      Object.keys(step).sort().map((key) => [key, (step as unknown as Record<string, unknown>)[key]]),
    ) as unknown as Step)
    expect(JSON.stringify(reordered.spec.api)).not.toBe(JSON.stringify(ra.spec.api))
    const out = regenerateProjection(reordered)
    if (!out.ok) { throw new Error(out.reason) }
    expect(out.changed).toEqual([])
  })
})
