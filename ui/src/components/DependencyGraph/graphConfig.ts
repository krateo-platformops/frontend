/**
 * The dependency graph's geometry and colours — design rule C19, defined ONCE (C24).
 *
 * WHY A MODULE OF ITS OWN. These settings lived inline in `widgets/FlowChart/FlowChart.tsx`, which
 * was the only graph. The Blueprint Composer draws a second one (a chart's resources and their
 * `dependsOn` edges), and C24 forbids a copy that agrees today and drifts tomorrow. Everything a
 * graph needs that is NOT about its node card lives here: the edge shape, the layered layout, the
 * ports, the viewport, per-edge `minlen`, and the token colours. The card and its box size stay
 * with each caller, because the box is the card's geometry (C19: the layout `size` must match the
 * node's CSS box, so it is declared beside the card that paints it).
 *
 * Pure (no React, no DOM): the options are data, so a node-env test can feed the SAME layout
 * config to the real dagre layout G6 runs and check where the columns land.
 */
import type { FlowGraphOptions, G6 } from '@ant-design/graphs'
import type { ReactNode } from 'react'

import { themeColors } from '../../theme/palette'
import type { ThemeMode } from '../../theme/tokens'

/** A node as the graph draws it: its id and whatever the node card renders from. */
export interface GraphNode<N = Record<string, unknown>> {
  id: string
  data: N
  /**
   * G6 element states. On the data: the states the node STARTS in. In `renderNode`: the states it
   * is in NOW — a caller changes them on the live graph with `graph.setElementState` (via
   * `graphRef`), and G6 redraws the element with its new states and no layout pass, so the card
   * re-renders and nothing moves. A React card has no G6 shape style to change, so it draws its
   * own states from this list.
   */
  states?: string[]
}

/**
 * A directed edge, drawn from `source` to `target`.
 *
 * `id` SHOULD be set. Without one G6 names the edge `${source}-${target}`, so two edges between the
 * same pair — or `x-y → z` and `x → y-z` — collide, and G6's data store throws "already exists";
 * the library's error boundary then shows an error where the graph was.
 *
 * `data.minlen` is the fewest layout columns the edge must span (dagre's `minlen`, default 1).
 */
export interface GraphEdge<E = Record<string, unknown>> {
  id?: string
  source: string
  target: string
  data?: E & { minlen?: number }
  /** G6 element states the edge starts in — drawn with `EdgeStateStyles`, changed like a node's. */
  states?: string[]
}

/** What a caller may vary per edge. Colours are deliberately NOT here: they come from tokens. */
export interface EdgeAppearance {
  dashed?: boolean
  label?: string
}

/**
 * How an edge looks in each G6 element state a caller sets on the live graph — width and opacity,
 * never a colour. Colours are the palette's: a theme flip repaints the base style (`restyleEdges`)
 * and would leave a state colour in the old mode. Must be stable (a module constant), like every
 * other option input, or each render is a re-layout.
 */
export type EdgeStateStyles = Record<string, { lineWidth?: number; opacity?: number }>

/** The canvas colours, resolved to concrete values because G6 paints a canvas, not CSS. */
export interface GraphPalette {
  edge: string
  label: string
  labelBackground: string
}

/**
 * C19. Edges: ONE curve per parent, not an orthogonal bundle.
 *
 * @ant-design/graphs defaults edges to polyline + router:{type:'orth'}. An orthogonal router routes
 * every edge through a mid-x corridor — fine for a chain, ruinous for a fan-in: on /agents twelve
 * agents share one rank and one target, so all twelve vertical segments landed on the SAME line
 * inside a 60px gap and drew over each other. `cubic-horizontal` gives each parent its own curve,
 * so a fan-in reads as a fan.
 *
 * `router: false` is load-bearing: the library deep-merges its options, so omitting the key would
 * keep the inherited router:{type:'orth'} and the curve would still be squared off.
 */
export const GRAPH_EDGE_TYPE = 'cubic-horizontal'

/**
 * C19. dagre (layered, left-to-right). ranksep/nodesep were once the library's small-node values
 * while the cards were 400px wide, so columns sat closer together than the cards themselves.
 */
export const GRAPH_LAYOUT = { nodesep: 32, rankdir: 'LR', ranksep: 160, type: 'dagre' } as const

/** Edges enter on the left and leave on the right — the reading direction of an LR layout. */
export const GRAPH_PORTS: { placement: 'left' | 'right' }[] = [{ placement: 'left' }, { placement: 'right' }]

/** Pan and zoom only. Selection is a click handler, not G6's `click-select` state. */
export const GRAPH_BEHAVIORS = ['drag-canvas', 'zoom-canvas']

/** A graph drawn at its true size pans and never zooms: the wheel is the page's (GraphFit). */
export const NATURAL_BEHAVIORS = ['drag-canvas']

/** …and G6's own centring at each render is instant, so `placeAtNaturalSize` follows no glide. */
export const NATURAL_AUTO_FIT = { animation: false, type: 'center' } as const

/** The dash an existence-only edge is drawn with, in px (on, off). */
export const DASHED_EDGE = [6, 4]

/**
 * Canvas colours from the design tokens for a mode — a map over `themeColors`, which owns the
 * mode → table choice. Edges use `faint` (AA-pinned and per-mode, so a line reads on both grounds
 * without competing with the cards); labels use `gray` on the surface colour. G6 needs concrete
 * values — a `var(--…)` means nothing on a canvas.
 */
export const graphPalette = (mode: ThemeMode): GraphPalette => {
  const tokens = themeColors(mode)
  return { edge: tokens.faint, label: tokens.gray, labelBackground: tokens.panelbg }
}

/**
 * The edge-style keys a palette sets — and ONLY those, so a theme flip can lay them over a live
 * graph's edge options without touching anything else (DependencyGraph's restyle).
 */
export const edgePaletteStyle = (palette: GraphPalette): Record<'labelBackgroundFill' | 'labelFill' | 'stroke', string> => ({
  labelBackgroundFill: palette.labelBackground,
  labelFill: palette.label,
  stroke: palette.edge,
})

/** An edge's `minlen`, or 1 — dagre's own default — for anything that is not a positive integer. */
export const edgeMinLen = (edge: { data?: Record<string, unknown> }): number => {
  const minlen = edge.data?.minlen
  return typeof minlen === 'number' && Number.isInteger(minlen) && minlen > 1 ? minlen : 1
}

const carriesMinLen = (edge: GraphEdge<unknown>): boolean => typeof edge.data?.minlen === 'number'

/**
 * The layout. `edgeMinLen` is added only when some edge asks for it, so a graph without per-edge
 * spans gets exactly the C19 object — and dagre's behaviour — it always had.
 *
 * WHY minlen AT ALL. dagre does not place a node by its distance from the roots: network-simplex
 * shortens edges, so a root whose only dependent sits two levels deep is pulled into column 1.
 * A caller that knows each node's level passes `minlen = level(target) − level(source)` and the
 * columns become the levels (measured against dagre 0.8.5 in `architectureGraph.layout.test.ts`).
 * @antv/layout's DagreLayout reads it per edge from the G6 edge datum (`edgeMinLen`).
 */
export const graphLayout = (edges: GraphEdge<unknown>[]): FlowGraphOptions['layout'] =>
  (edges.some(carriesMinLen) ? { ...GRAPH_LAYOUT, edgeMinLen } : { ...GRAPH_LAYOUT })

/**
 * The edge options. Two independent layers over C19's `{ style: { router: false }, type }`:
 *
 *   - `appearance` (per-edge dash and label) is applied whenever it is given, palette or not.
 *     It is not a colour, so `themed={false}` is no reason to drop it — it once was, silently.
 *   - `palette`: the stroke (which the arrowhead inherits) and the label take token colours.
 *     Without one G6's own light-theme colours stand — what FlowChart has always drawn, in both
 *     portal modes.
 *
 *   - `states`: the per-state styles (`EdgeStateStyles`), only for a caller that sets states.
 *
 * With none of them — FlowChart — the options are exactly C19's object, key for key.
 */
export const graphEdgeOptions = <E, >(
  palette: GraphPalette | null,
  appearance?: (edge: GraphEdge<E>) => EdgeAppearance,
  states?: EdgeStateStyles,
): FlowGraphOptions['edge'] => {
  const style: Record<string, unknown> = { router: false }
  if (appearance) {
    const look = (datum: G6.EdgeData): EdgeAppearance => appearance(datum as unknown as GraphEdge<E>)
    style.labelText = (datum: G6.EdgeData) => look(datum).label ?? ''
    style.lineDash = (datum: G6.EdgeData) => (look(datum).dashed ? DASHED_EDGE : 0)
  }
  if (palette) {
    Object.assign(style, { labelBackground: true, ...edgePaletteStyle(palette) })
  }
  return states ? { state: states, style, type: GRAPH_EDGE_TYPE } : { style, type: GRAPH_EDGE_TYPE }
}

/**
 * How the graph meets its box. `view` (FlowChart's, the default) scales it to fill the box. `natural`
 * draws it at zoom 1 — centred by G6 at each layout, then placed by `placeAtNaturalSize` — for cards
 * designed at a pixel size, which `view` magnifies or shrinks past the type floor.
 *
 * `natural` also means NO WHEEL ZOOM and NO GLIDE. zoom-canvas takes the page's scroll gesture:
 * over the Blueprint Composer's pane, one ordinary scroll toward Chart files shrank the 156×72 cards
 * to a smudge (up to ×0.5 per event) and did not scroll the page, and nothing on the page brings
 * zoom 1 back. And G6 ends every re-render with its autoFit, animated by default — an edit that kept
 * the node set slid an overflowing graph to centre, cutting off the first column, before
 * `placeAtNaturalSize` snapped it back. Drag to pan stays.
 */
export type GraphFit = 'natural' | 'view'

export interface GraphOptionsInput<N, E> {
  /** Default `view`. */
  fit?: GraphFit
  nodes: GraphNode<N>[]
  edges: GraphEdge<E>[]
  renderNode: (node: GraphNode<N>) => ReactNode
  /** The box dagre reserves per node, [width, height]. It MUST equal the card's CSS box (C19). */
  nodeSize: [number, number]
  palette: GraphPalette | null
  edgeAppearance?: (edge: GraphEdge<E>) => EdgeAppearance
  edgeStates?: EdgeStateStyles
}

/** Everything FlowGraph is given, from one place. */
export const buildGraphOptions = <N, E>(input: GraphOptionsInput<N, E>): FlowGraphOptions => {
  const { edgeAppearance, edgeStates, edges, fit = 'view', nodeSize, nodes, palette, renderNode } = input
  return {
    autoFit: fit === 'natural' ? NATURAL_AUTO_FIT : 'view',
    behaviors: fit === 'natural' ? NATURAL_BEHAVIORS : GRAPH_BEHAVIORS,
    data: { edges: edges as G6.EdgeData[], nodes: nodes as unknown as G6.NodeData[] },
    edge: graphEdgeOptions(palette, edgeAppearance, edgeStates),
    layout: graphLayout(edges),
    node: {
      style: {
        // Each node is its OWN React root (g6-extension-react), so no context reaches the card —
        // only this closure does. Anything the card needs must travel in `data` or the closure.
        // G6 calls this again when `setElementState` changes the node's states (its default style
        // is recomputed per draw, with the datum as it is now), so the card re-renders in its new
        // states without a layout pass. `states` is passed only when set, so a caller that never
        // uses states sees the card input it always did.
        component: (datum: G6.NodeData) => renderNode({
          data: datum.data as N,
          id: String(datum.id),
          ...(datum.states?.length ? { states: [...datum.states] } : {}),
        }),
        ports: GRAPH_PORTS,
        size: nodeSize,
      },
      type: 'react',
    },
  }
}
