/**
 * A chart architecture → the nodes and edges the dependency graph draws. Pure.
 *
 * DIRECTION. An edge runs from the DEPENDENCY to the DEPENDENT (`dependsOn: [{ ref: repo }]` on
 * `localresources` draws repo → localresources). With the graph's left-to-right layout the machine
 * then reads the way it runs: S1 on the left, each later state one column to the right. It is
 * FlowChart's parent → child convention, so the two graphs agree about what an arrow means.
 *
 * COLUMNS ARE LEVELS, BY CONSTRUCTION. dagre does not rank a node by its distance from the roots:
 * a root whose only dependent is two levels deep lands in column 1. So every edge carries
 * `minlen = level(dependent) − level(dependency)`, which makes the derived levels the one ranking
 * with every edge at its minimum length — the ranking dagre's network-simplex settles on. Pinned
 * against the real layout in architectureGraph.layout.test.ts.
 *
 * WHAT G6 WOULD THROW ON, REFUSED HERE. G6's data store throws on a duplicate node id, a duplicate
 * edge id and an edge to a missing node; its error boundary then replaces the whole canvas. So:
 * one node per id (first wins), every edge has an explicit id — `<dependent>:dependsOn[<i>]` —
 * because G6's default `${source}-${target}` collides for hyphenated ids, and edges to unknown ids,
 * self-edges and repeats of a pair are dropped. Each drop is reported with the descriptor path it
 * came from, so the canvas can say what it did not draw instead of silently drawing less.
 */
import type { GraphEdge, GraphNode } from '../../components/DependencyGraph'

import type { ChartArchitecture, DeriveResult, ResourceNode } from './architecture'

export interface ArchitectureNodeData {
  resource: ResourceNode
  /** The derived level, or null for an orthogonal node or while the graph has a cycle. */
  level: number | null
  /** A `lifecycle` node (shim, descriptor): outside the sequence, in no state. */
  orthogonal: boolean
  /** A member of the cycle `deriveStates` refused. */
  inCycle: boolean
}

export interface ArchitectureEdgeData {
  /** true: the dependent waits for the dependency's readiness; false: only for it to exist. */
  ready: boolean
  /** Over a `forEach` dependency: every instance must satisfy the edge. */
  all: boolean
  /** The edge applies only when this Values path is truthy. */
  when?: string
  /** The columns the edge spans: the level difference, never below 1. */
  minlen: number
  /** Where the edge was declared, e.g. `resources[2].dependsOn[0]`. */
  path: string
}

export type ArchitectureGraphNode = GraphNode<ArchitectureNodeData>
export type ArchitectureGraphEdge = GraphEdge<ArchitectureEdgeData> & { id: string; data: ArchitectureEdgeData }

export interface DroppedElement {
  path: string
  reason: string
}

export interface ArchitectureGraph {
  nodes: ArchitectureGraphNode[]
  edges: ArchitectureGraphEdge[]
  dropped: DroppedElement[]
}

/** The explicit, unique id of the `index`-th dependsOn entry of `dependent`. */
export const dependencyEdgeId = (dependent: string, index: number): string => `${dependent}:dependsOn[${index}]`

export const toArchitectureGraph = (arch: ChartArchitecture, derived: DeriveResult): ArchitectureGraph => {
  const levels: Record<string, number> = derived.ok ? derived.levels : {}
  const cycle = new Set(derived.ok ? [] : derived.cycle)
  const levelOf = (id: string): number | null => (id in levels ? levels[id] : null)

  const nodes: ArchitectureGraphNode[] = []
  const dropped: DroppedElement[] = []
  const seen = new Set<string>()
  const drawn: { resource: ResourceNode; index: number }[] = []
  arch.resources.forEach((resource, index) => {
    if (seen.has(resource.id)) {
      dropped.push({ path: `resources[${index}]`, reason: `duplicate id "${resource.id}" — only the first is drawn` })
      return
    }
    seen.add(resource.id)
    drawn.push({ index, resource })
    nodes.push({
      data: { inCycle: cycle.has(resource.id), level: levelOf(resource.id), orthogonal: !!resource.lifecycle, resource },
      id: resource.id,
    })
  })

  const edges: ArchitectureGraphEdge[] = []
  // Keyed by the PAIR as a tuple, not a joined string: `a-b` + `c` and `a` + `b-c` are different pairs.
  const pairs = new Set<string>()
  for (const { index, resource } of drawn) {
    for (const [depIndex, dep] of (resource.dependsOn ?? []).entries()) {
      const path = `resources[${index}].dependsOn[${depIndex}]`
      const pair = JSON.stringify([dep.ref, resource.id])
      if (!seen.has(dep.ref)) {
        dropped.push({ path, reason: `"${dep.ref}" is not a resource of this chart` })
      } else if (dep.ref === resource.id) {
        dropped.push({ path, reason: 'a resource cannot depend on itself' })
      } else if (pairs.has(pair)) {
        dropped.push({ path, reason: `"${resource.id}" already depends on "${dep.ref}"` })
      } else {
        pairs.add(pair)
        const from = levelOf(dep.ref)
        const to = levelOf(resource.id)
        const data: ArchitectureEdgeData = {
          all: !!dep.all,
          minlen: from !== null && to !== null ? Math.max(1, to - from) : 1,
          path,
          ready: !!dep.ready,
        }
        if (dep.when) { data.when = dep.when }
        edges.push({ data, id: dependencyEdgeId(resource.id, depIndex), source: dep.ref, target: resource.id })
      }
    }
  }
  return { dropped, edges, nodes }
}
