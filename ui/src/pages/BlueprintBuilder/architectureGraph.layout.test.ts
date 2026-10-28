/**
 * THE REAL LAYOUT, IN NODE. jsdom has no canvas, so no component test can watch G6 place a node.
 * The placement is not G6's, though: G6's `dagre` layout is @antv/layout's DagreLayout, which
 * builds a dagre@0.8.5 graph and reads each node's position back. That class needs no canvas, so
 * this runs it — the very class G6 registers as `dagre`, with the very options DependencyGraph
 * passes (`graphLayout`, including the per-edge `edgeMinLen`) — and checks which column each node
 * lands in.
 *
 * What it proves: the columns ARE the derived levels once edges carry `minlen`, and are NOT without
 * it — the measured reason the mapper computes a span at all. What it cannot prove: pixels on a
 * screen (G6 adds the viewport, autoFit and the React node roots on top of these positions).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { G6 } from '@ant-design/graphs'
import { describe, expect, it } from 'vitest'

import { graphLayout, type GraphEdge, type GraphNode } from '../../components/DependencyGraph'

import { ARCHITECTURE_API_VERSION, deriveStates, type ChartArchitecture } from './architecture'
import { toArchitectureGraph } from './architectureGraph'
import { extractArchitecture } from './gateExtract'

/** The composer's compact card (mockup screens 05/08). Any equal size shows the same columns. */
const NODE_SIZE: [number, number] = [156, 72]

/** Run the layout G6 would run and return each node's column (0 = leftmost). */
const columns = async (nodes: GraphNode<unknown>[], edges: GraphEdge<unknown>[]): Promise<Record<string, number>> => {
  // G6 strips `type` and hands the rest to the layout class, adding the node size it measured.
  const { type: _type, ...options } = graphLayout(edges) as Record<string, unknown>
  const layout = new G6.DagreLayout({ ...options, nodeSize: NODE_SIZE })
  await layout.execute({ edges, nodes })
  const xs: Record<string, number> = {}
  layout.forEachNode((node) => {
    xs[String(node.id)] = Number(node.x)
  })
  const distinct = [...new Set(Object.values(xs))].sort((left, right) => left - right)
  return Object.fromEntries(Object.entries(xs).map(([id, x]) => [id, distinct.indexOf(x)]))
}

const native = (id: string, refs: string[] = []) =>
  ({ apiVersion: 'v1', class: 'native' as const, dependsOn: refs.map((ref) => ({ ref })), id, kind: 'ConfigMap', template: `templates/${id}.yaml` })

describe('dagre columns under the DependencyGraph layout config', () => {
  it('a level-0 node feeding only a level-2 node sits in column 0 — with minlen', async () => {
    const shape: ChartArchitecture = {
      apiVersion: ARCHITECTURE_API_VERSION,
      chart: 'demo',
      kind: 'ChartArchitecture',
      resources: [native('db'), native('cfg'), native('web', ['db', 'cfg']), native('svc', ['web', 'x']), native('x')],
    }
    const derived = deriveStates(shape)
    if (!derived.ok) { throw new Error('unexpected cycle') }
    const graph = toArchitectureGraph(shape, derived)

    expect(await columns(graph.nodes, graph.edges)).toEqual(derived.levels)

    // The same graph with the spans stripped: dagre pulls x next to its dependent. This is the
    // defect the minlen exists for, kept visible so a dagre upgrade that changes it is noticed.
    const plain = graph.edges.map(({ id, source, target }) => ({ id, source, target }))
    expect((await columns(graph.nodes, plain)).x).toBe(1)
  })

  it('builder-publish lands S1..S4 left to right, the edge-less shim in column 0', async () => {
    const dir = join(__dirname, '__fixtures__', 'builder-publish', 'templates')
    const templates = Object.fromEntries(readdirSync(dir).map((file) => [`templates/${file}`, readFileSync(join(dir, file), 'utf8')]))
    const { architecture } = extractArchitecture('builder-publish', templates)
    const derived = deriveStates(architecture)
    if (!derived.ok) { throw new Error('unexpected cycle') }
    const graph = toArchitectureGraph(architecture, derived)

    expect(await columns(graph.nodes, graph.edges)).toEqual({ ...derived.levels, 'username-secret': 0 })
  })

  it('two independent chains of different depth both start in column 0', async () => {
    const shape: ChartArchitecture = {
      apiVersion: ARCHITECTURE_API_VERSION,
      chart: 'demo',
      kind: 'ChartArchitecture',
      resources: [native('a'), native('b', ['a']), native('c', ['b']), native('d'), native('e', ['d'])],
    }
    const derived = deriveStates(shape)
    if (!derived.ok) { throw new Error('unexpected cycle') }
    const graph = toArchitectureGraph(shape, derived)
    expect(await columns(graph.nodes, graph.edges)).toEqual(derived.levels)
  })
})
