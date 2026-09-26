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
import type { EdgeAppearance, GraphEdge, GraphNode } from '../../components/DependencyGraph'

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
