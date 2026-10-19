/**
 * FlowChart's `architecture` variant, the pure half: a chart's topology (one node per resource the
 * chart declares, edges from its `dependsOn`) turned into the graph DependencyGraph draws, with each
 * node in the state the composition is in.
 *
 * THE DATA IS THE RESTACTION'S. `composition-architecture` (portal) evaluates the chart's
 * descriptor against the live objects under the caller's own identity, and the widget's
 * `widgetDataTemplate` maps each node to `{uid, kind, name, state, detail, exception, parentRefs}`.
 * Nothing here reads the cluster or decides a state: a node is drawn in the state it arrives in.
 *
 * EXCEPTION-ONLY (P14). A `done` node is neutral and carries no marker; the one red on the canvas
 * is the `exception` dot, which the RESTAction sets only for NotSynced or NotReady (P13). Edges
 * take the theme's neutral tokens, dashed where they point into a node that is still withheld.
 */
import { GRAPH_LAYOUT, type EdgeAppearance, type GraphEdge, type GraphNode } from '../../components/DependencyGraph'

import type { FlowChartData, FlowChartNodeData } from './FlowChart'

export type ArchitectureState = NonNullable<FlowChartNodeData['state']>

export type ArchitectureException = NonNullable<FlowChartNodeData['exception']>

/** What an edge needs to know about the node it points into. */
export interface ArchitectureEdgeData {
  withheld: boolean
}

/**
 * [width, height]: ArchitectureStateNode's CSS box, and so what dagre reserves per node (C19). Wider
 * than the composer's 156×72 because this card shows resolved names, and a forEach range such as
 * `publish-pod-sizing-v1b-000 … 009` does not fit in 156px.
 */
export const ARCHITECTURE_NODE_SIZE: [number, number] = [220, 84]

/**
 * The drawn width of an architecture graph, in px, at the cards' true size.
 *
 * dagre lays the graph out LR, so one RANK is one column and the drawn width is
 * `ranks × cardWidth + (ranks − 1) × ranksep`. A rank is a step in the longest chain of active
 * dependencies, which is what `level` means in the descriptor — computed here from the edges rather
 * than read from the data, because the widget is given `parentRefs` and not levels.
 *
 * Used to tell the card whether the graph runs past its box (portal#310). Before this, a graph wider
 * than the box was simply clipped at the right edge with nothing on screen saying so: the last
 * column was cut mid-card and read as a rendering fault rather than as "there is more, drag it".
 * `fit="natural"` pins the LEFT edge, so overflow is always on the right on first paint.
 *
 * A cycle cannot happen (the descriptor is a DAG and `toArchitectureGraphData` drops an edge whose
 * source is not drawn) but the walk is depth-capped anyway: a malformed payload must not hang the
 * page, and a wrong width only costs a fade that should not be there.
 */
export const architectureGraphWidth = (
  nodes: readonly { id: string }[],
  edges: readonly { source: string; target: string }[],
  cardWidth = ARCHITECTURE_NODE_SIZE[0],
  ranksep = GRAPH_LAYOUT.ranksep,
): number => {
  if (nodes.length === 0) { return 0 }
  const parents = new Map<string, string[]>()
  for (const { source, target } of edges) {
    parents.set(target, [...(parents.get(target) ?? []), source])
  }
  const depth = new Map<string, number>()
  const rankOf = (id: string, seen: ReadonlySet<string>): number => {
    const known = depth.get(id)
    if (known !== undefined) { return known }
    // Depth cap: a self-reference or a cycle in a malformed payload stops here rather than recursing.
    if (seen.has(id) || seen.size > nodes.length) { return 0 }
    const next = new Set(seen).add(id)
    const own = (parents.get(id) ?? []).reduce((deepest, parent) => Math.max(deepest, rankOf(parent, next) + 1), 0)
    depth.set(id, own)
    return own
  }
  const ranks = nodes.reduce((most, { id }) => Math.max(most, rankOf(id, new Set())), 0) + 1
  return ranks * cardWidth + (ranks - 1) * ranksep
}

const STATES: readonly ArchitectureState[] = ['done', 'waiting', 'withheld', 'unreadable', 'unavailable', 'unknown']

/**
 * The state a node is drawn in. A missing state, or one this build does not know, is drawn as
 * `unknown`. That is muted, and it claims nothing: a newer RESTAction's state must not be shown as
 * done.
 */
export const architectureState = (state: unknown): ArchitectureState =>
  STATES.find((known) => known === state) ?? 'unknown'

/** `label: reason — message`, the words behind the exception dot. */
export const exceptionText = ({ label, message, reason }: ArchitectureException): string =>
  `${label}${reason ? `: ${reason}` : ''}${message ? ` — ${message}` : ''}`

/** The card's accessible name: "kind name, state", then the exception when there is one. */
export const architectureNodeLabel = (node: FlowChartNodeData): string =>
  [`${node.kind} ${node.name}`, architectureState(node.state), ...(node.exception ? [exceptionText(node.exception)] : [])].join(', ')

/**
 * The graph. Unlike the resource variant's `toGraphData`, it guards the three shapes that make G6
 * throw, because a throw replaces the whole graph with the widget's error card:
 *   - two nodes with one uid ("already exists"): the first is kept;
 *   - an edge from a node that is not drawn: a dependency on a resource whose `when` is false for
 *     this composition is dropped, not drawn to nowhere;
 *   - a parent listed twice: one edge.
 * Every edge carries an id (`GraphEdge` explains why) and whether its target is withheld.
 */
export const toArchitectureGraphData = (data: FlowChartData): {
  edges: GraphEdge<ArchitectureEdgeData>[]
  nodes: GraphNode<FlowChartNodeData>[]
} => {
  if (!Array.isArray(data)) {
    return { edges: [], nodes: [] }
  }
  const byId = new Map<string, FlowChartNodeData>()
  for (const node of data) {
    if (typeof node?.uid === 'string' && node.uid !== '' && !byId.has(node.uid)) {
      byId.set(node.uid, node)
    }
  }
  const nodes = [...byId.entries()].map(([id, node]) => ({ data: node, id }))
  const edges = new Map<string, GraphEdge<ArchitectureEdgeData>>()
  for (const { data: node, id: target } of nodes) {
    const withheld = architectureState(node.state) === 'withheld'
    for (const { uid: source } of node.parentRefs ?? []) {
      if (typeof source === 'string' && source !== target && byId.has(source)) {
        const id = `${source}→${target}`
        edges.set(id, edges.get(id) ?? { data: { withheld }, id, source, target })
      }
    }
  }
  return { edges: [...edges.values()], nodes }
}

/** Dashed into a withheld node, solid otherwise. No label, and no colour: those are the tokens'. */
export const architectureEdgeAppearance = (edge: GraphEdge<ArchitectureEdgeData>): EdgeAppearance =>
  ({ dashed: edge.data?.withheld === true })
