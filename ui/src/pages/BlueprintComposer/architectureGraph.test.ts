import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ARCHITECTURE_API_VERSION, deriveStates, parseArchitecture, type ChartArchitecture } from './architecture'
import { dependencyEdgeId, toArchitectureGraph } from './architectureGraph'
import { extractArchitecture } from './gateExtract'

const FIXTURE = join(__dirname, '__fixtures__', 'builder-publish')

const builderPublish = (): ChartArchitecture => {
  const dir = join(FIXTURE, 'templates')
  const templates = Object.fromEntries(readdirSync(dir).map((file) => [`templates/${file}`, readFileSync(join(dir, file), 'utf8')]))
  return extractArchitecture('builder-publish', templates).architecture
}

const arch = (resources: ChartArchitecture['resources']): ChartArchitecture => ({ apiVersion: ARCHITECTURE_API_VERSION, chart: 'demo', kind: 'ChartArchitecture', resources })

const native = (id: string, dependsOn?: ChartArchitecture['resources'][number]['dependsOn']) =>
  ({ apiVersion: 'v1', class: 'native' as const, dependsOn, id, kind: 'ConfigMap', template: `templates/${id}.yaml` })

describe('toArchitectureGraph — builder-publish', () => {
  const architecture = builderPublish()
  const graph = toArchitectureGraph(architecture, deriveStates(architecture))

  it('one node per resource, the shim included and flagged orthogonal', () => {
    expect(graph.nodes.map((node) => [node.id, node.data.level, node.data.orthogonal])).toEqual([
      ['localresources', 2, false],
      ['pullrequest', 3, false],
      ['repo', 1, false],
      ['repository', 0, false],
      ['username-secret', null, true],
    ])
  })

  it('one edge per dependsOn, dependency → dependent, carrying ready/all/when and the level span', () => {
    expect(graph.edges).toEqual([
      { data: { all: false, minlen: 2, path: 'resources[0].dependsOn[0]', ready: true, when: '.Values.repository.create' }, id: 'localresources:dependsOn[0]', source: 'repository', target: 'localresources' },
      { data: { all: false, minlen: 1, path: 'resources[0].dependsOn[1]', ready: true, when: '.Values.source.url' }, id: 'localresources:dependsOn[1]', source: 'repo', target: 'localresources' },
      { data: { all: true, minlen: 1, path: 'resources[1].dependsOn[0]', ready: true }, id: 'pullrequest:dependsOn[0]', source: 'localresources', target: 'pullrequest' },
      { data: { all: false, minlen: 1, path: 'resources[2].dependsOn[0]', ready: true, when: '.Values.repository.create' }, id: 'repo:dependsOn[0]', source: 'repository', target: 'repo' },
    ])
    expect(graph.dropped).toEqual([])
  })

  it('the checked-in expected descriptor maps to the same graph as the extraction', () => {
    const parsed = parseArchitecture(readFileSync(join(FIXTURE, 'expected.architecture.yaml'), 'utf8'))
    if (!parsed.ok) { throw new Error('fixture does not parse') }
    expect(toArchitectureGraph(parsed.architecture, deriveStates(parsed.architecture))).toEqual(graph)
  })
})

describe('toArchitectureGraph — the inputs that would break the canvas', () => {
  it('a level-0 node feeding only a level-2 node spans two columns (minlen 2)', () => {
    const shape = arch([native('db'), native('cfg'), native('web', [{ ref: 'db' }, { ref: 'cfg' }]), native('svc', [{ ref: 'web' }, { ref: 'x' }]), native('x')])
    const derived = deriveStates(shape)
    expect(derived.ok && derived.levels).toEqual({ cfg: 0, db: 0, svc: 2, web: 1, x: 0 })
    const { edges } = toArchitectureGraph(shape, derived)
    expect(edges.map((edge) => [edge.source, edge.target, edge.data.minlen])).toEqual([
      ['db', 'web', 1], ['cfg', 'web', 1], ['web', 'svc', 1], ['x', 'svc', 2],
    ])
  })

  it('hyphenated ids that G6 would name identically get distinct explicit ids', () => {
    // G6's default id is `${source}-${target}`: x-y → z and x → y-z are both "x-y-z", and the
    // second insert throws "already exists".
    const shape = arch([native('x-y'), native('x'), native('z', [{ ref: 'x-y' }]), native('y-z', [{ ref: 'x' }])])
    const { edges } = toArchitectureGraph(shape, deriveStates(shape))
    expect(edges.map((edge) => `${edge.source}-${edge.target}`)).toEqual(['x-y-z', 'x-y-z'])
    expect(edges.map((edge) => edge.id)).toEqual([dependencyEdgeId('z', 0), dependencyEdgeId('y-z', 0)])
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(edges.length)
  })

  it('drops dangling refs, self edges, repeated pairs and duplicate node ids — and says where', () => {
    // Built directly: parseArchitecture refuses all of these, but an extracted or agent-made
    // descriptor reaches the canvas too, and G6 throws on every one of them.
    const shape = arch([
      native('db'),
      native('web', [{ ref: 'ghost' }, { ref: 'db' }, { ready: true, ref: 'db' }, { ref: 'web' }]),
      native('db'),
    ])
    const graph = toArchitectureGraph(shape, deriveStates(shape))
    expect(graph.nodes.map((node) => node.id)).toEqual(['db', 'web'])
    expect(graph.edges.map((edge) => edge.id)).toEqual(['web:dependsOn[1]'])
    expect(graph.dropped).toEqual([
      { path: 'resources[2]', reason: 'duplicate id "db" — only the first is drawn' },
      { path: 'resources[1].dependsOn[0]', reason: '"ghost" is not a resource of this chart' },
      { path: 'resources[1].dependsOn[2]', reason: '"web" already depends on "db"' },
      { path: 'resources[1].dependsOn[3]', reason: 'a resource cannot depend on itself' },
    ])
  })

  it('a node with no level named after an Object.prototype member has level null, not the member', () => {
    // A shim is outside the sequence, so it has no level: `id in levels` found Object's own.
    const shape = arch([native('db'), { ...native('constructor'), lifecycle: 'shim' as const }, native('web', [{ ref: 'db' }])])
    const graph = toArchitectureGraph(shape, deriveStates(shape))
    expect(graph.nodes.map((node) => [node.id, node.data.level])).toEqual([['db', 0], ['constructor', null], ['web', 1]])
    // …and so does every node while the graph has a cycle and `levels` is empty.
    const cyclic = arch([native('toString', [{ ref: 'valueOf' }]), native('valueOf', [{ ref: 'toString' }])])
    const { edges, nodes } = toArchitectureGraph(cyclic, deriveStates(cyclic))
    expect(nodes.map((node) => node.data.level)).toEqual([null, null])
    expect(edges.map((edge) => edge.data.minlen)).toEqual([1, 1])
  })

  it('a cycle has no levels: its members are flagged, and every edge falls back to minlen 1', () => {
    const shape = arch([native('a', [{ ref: 'c' }]), native('b', [{ ref: 'a' }]), native('c', [{ ref: 'b' }]), native('d')])
    const derived = deriveStates(shape)
    expect(derived.ok).toBe(false)
    const graph = toArchitectureGraph(shape, derived)
    expect(graph.nodes.map((node) => [node.id, node.data.inCycle, node.data.level])).toEqual([
      ['a', true, null], ['b', true, null], ['c', true, null], ['d', false, null],
    ])
    expect(graph.edges.every((edge) => edge.data.minlen === 1)).toBe(true)
  })
})
