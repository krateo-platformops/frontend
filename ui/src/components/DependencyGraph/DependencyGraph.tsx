/**
 * A left-to-right graph of things and what they depend on — the presentational half of `FlowChart`,
 * extracted so a second surface (the Blueprint Composer's architecture canvas) draws with the SAME
 * machinery rather than a copy of it (C24). The geometry and colours are in `graphConfig.ts`.
 *
 * WHAT IT ADDS OVER RENDERING `FlowGraph` DIRECTLY — each fixes a measured defect of the inline use:
 *
 *   - NO RE-LAYOUT ON A PARENT RE-RENDER. FlowGraph memoises on its whole `props` object, which is
 *     new on every render, and Graphin answers every new options object with `setOptions()` +
 *     `render()` — a full dagre pass and an `autoFit`. So any re-render of the host (a stepper
 *     click, a draft broadcast) reset the user's pan and zoom. Here the options are memoised on
 *     their real inputs and FlowGraph sits behind `memo`, so it re-renders only when those change.
 *     The caller's part of the bargain: `nodes`, `edges`, `nodeSize`, `renderNode` and
 *     `edgeAppearance` must be stable (module constants, `useMemo`, `useCallback`). A `graphRef`
 *     should be too: it does not re-lay out, but a new one is detached and re-attached.
 *   - TOKEN COLOURS THAT FOLLOW THE THEME. G6 defaults to its own light theme whatever the portal
 *     mode is. `themed` (the default) paints edges and labels from the design tokens and, when
 *     `data-theme` flips, REPAINTS the graph already on screen — new colours, same positions, same
 *     pan and zoom (see `restyleEdges`). `themed={false}` keeps G6's colours, which is what
 *     FlowChart has always drawn (its canvas never followed the portal theme; changing that is a
 *     visual change).
 *   - PER-EDGE minlen, so a caller can pin columns to levels (`graphLayout`).
 *   - NODE CLICK. `onNodeClick(id)` fires for G6's `node:click`. It is read through a ref, so an
 *     inline arrow does not count as a changed input. A node card that must be keyboard-operable
 *     should also render a real button wired through `renderNode`'s own closure: G6 hit-tests a
 *     forwarded DOM click at its pointer coordinates, and a key-activated click has none.
 *   - THE GRAPH HANDLE. `graphRef` receives the G6 Graph the moment G6 creates it (`onInit`) and
 *     is cleared when it is destroyed. NOT through FlowGraph's own forwarded ref: @ant-design/graphs
 *     2.1.1's BaseGraph fills that at its commit, before @antv/graphin's mount effect has created
 *     the graph, so it is set to null — and with FlowGraph behind `memo` nothing re-renders
 *     BaseGraph to fill it later. It stayed null for the life of the canvas.
 *
 * Empty data is the caller's to handle (FlowChart shows WidgetEmpty): this draws what it is given.
 */
import { FlowGraph, G6, type FlowGraphOptions } from '@ant-design/graphs'
import { ReactNode as G6ReactNode } from '@antv/g6-extension-react'
import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode, type Ref } from 'react'

import { activeThemeMode, useDocumentThemeMode } from '../../theme/palette'

import {
  buildGraphOptions,
  edgePaletteStyle,
  graphPalette,
  type EdgeAppearance,
  type GraphEdge,
  type GraphNode,
  type GraphPalette,
} from './graphConfig'

// Register the React custom-node type once so React components render as G6 nodes. Idempotent:
// the registry throws on a second registration, which is the "already registered" case.
try {
  G6.register(G6.ExtensionCategory.NODE, 'react', G6ReactNode)
} catch {
  /* already registered */
}

/** G6's `node:click` (NodeEvent.CLICK), spelled out so this module does not depend on the enum. */
const NODE_CLICK = 'node:click'

/**
 * G6's GraphEvent.BEFORE_DESTROY, spelled out likewise. Not AFTER_DESTROY: `graph.destroy()`
 * removes every listener before it emits that one, so a handler for it never runs.
 */
const BEFORE_DESTROY = 'beforedestroy'

/**
 * Give a caller's ref — object or callback — the graph, and return what takes it back: the
 * callback's own cleanup when it returned one (React 19 refs may), else `ref(null)`; for an
 * object, null, unless something else has been put there since.
 */
const attachRef = (ref: Ref<G6.Graph> | undefined, graph: G6.Graph): (() => void) => {
  if (typeof ref === 'function') {
    const cleanup = ref(graph)
    return typeof cleanup === 'function' ? cleanup : () => { ref(null) }
  }
  if (!ref) {
    return () => undefined
  }
  ref.current = graph
  return () => {
    if (ref.current === graph) { ref.current = null }
  }
}

/**
 * Repaint a live graph's edges in `palette` WITHOUT a re-layout. `setEdge` + `draw()` redraws the
 * elements where they stand; handing Graphin new options would `setOptions()` + `render()` — dagre
 * and `autoFit` again, i.e. the user's pan and zoom thrown away by a theme toggle.
 *
 * The colour keys are laid over the graph's OWN edge options, not rebuilt from graphConfig:
 * `setEdge` replaces the whole mapping, and the live one is FlowGraph's merge of its defaults
 * (arrowhead, line width, corner radius) with ours — rebuilding would drop the arrowheads.
 * A graph already in these colours (every mount: it was created with them) is left alone.
 */
const restyleEdges = (graph: G6.Graph, palette: GraphPalette): void => {
  const current = graph.getOptions().edge ?? {}
  const style = (current.style && typeof current.style === 'object' ? current.style : {}) as Record<string, unknown>
  const colours = edgePaletteStyle(palette)
  if (Object.entries(colours).every(([key, value]) => style[key] === value)) {
    return
  }
  graph.setEdge({ ...current, style: { ...style, ...colours } })
  void graph.draw()
}

export interface DependencyGraphProps<N, E> {
  nodes: GraphNode<N>[]
  edges: GraphEdge<E>[]
  /** The node card. Rendered in the node's own React root: pass what it needs through the closure. */
  renderNode: (node: GraphNode<N>) => ReactNode
  /** [width, height] dagre reserves per node — MUST equal the card's CSS box (C19). */
  nodeSize: [number, number]
  onNodeClick?: (id: string) => void
  /** The G6 Graph, for element state changes that must not re-run the layout (`setElementState`). */
  graphRef?: Ref<G6.Graph>
  /** Paint edges and labels from the design tokens (default). false keeps G6's own colours. */
  themed?: boolean
  /** Per-edge dash and label. Colours are not overridable: they come from the tokens. */
  edgeAppearance?: (edge: GraphEdge<E>) => EdgeAppearance
}

interface CanvasProps {
  options: FlowGraphOptions
  onInit: (graph: G6.Graph) => void
}

/**
 * FlowGraph behind `memo`: with stable props it does not re-render, so G6 does not re-lay out.
 * No `ref`: the graph handle comes from `onInit` (see the header).
 */
const GraphCanvas = memo(({ onInit, options }: CanvasProps) => <FlowGraph {...options} onInit={onInit} />)
GraphCanvas.displayName = 'GraphCanvas'

const DependencyGraph = <N, E = Record<string, unknown>>({
  edgeAppearance,
  edges,
  graphRef,
  nodeSize,
  nodes,
  onNodeClick,
  renderNode,
  themed = true,
}: DependencyGraphProps<N, E>) => {
  const mode = useDocumentThemeMode()

  const clickRef = useRef(onNodeClick)
  useEffect(() => {
    clickRef.current = onNodeClick
  }, [onNodeClick])

  // The graph G6 created (null before onInit and after destroy), the caller's handle as of the
  // last commit, and what detaches the graph from that handle.
  const liveGraph = useRef<G6.Graph | null>(null)
  const handleRef = useRef(graphRef)
  const detachRef = useRef<(() => void) | null>(null)

  const bindHandle = useCallback(() => {
    detachRef.current?.()
    detachRef.current = liveGraph.current ? attachRef(handleRef.current, liveGraph.current) : null
  }, [])

  // Bound once, when G6 creates the graph (Graphin calls onInit from its mount effect, once); the
  // refs make a later callback or handle the one that is used.
  const onInit = useCallback((graph: G6.Graph) => {
    liveGraph.current = graph
    bindHandle()
    graph.on(BEFORE_DESTROY, () => {
      if (liveGraph.current === graph) {
        liveGraph.current = null
        bindHandle()
      }
    })
    graph.on(NODE_CLICK, (event: G6.IElementEvent) => {
      const id = event.target?.id
      if (id !== undefined) {
        clickRef.current?.(String(id))
      }
    })
  }, [bindHandle])

  // A caller that swaps its ref: the old one lets go, the new one gets the graph that exists.
  useEffect(() => {
    if (handleRef.current === graphRef) { return }
    handleRef.current = graphRef
    bindHandle()
  }, [bindHandle, graphRef])

  // The palette is READ when the options are built, not depended on: a theme flip must not be new
  // options, because Graphin answers new options with a full re-layout. New data still picks up
  // the mode active then. The flip itself repaints the live graph, below.
  const options = useMemo(
    () => buildGraphOptions({ edgeAppearance, edges, nodeSize, nodes, palette: themed ? graphPalette(activeThemeMode()) : null, renderNode }),
    [edgeAppearance, edges, nodeSize, nodes, renderNode, themed],
  )

  useEffect(() => {
    const graph = liveGraph.current
    if (themed && graph && !graph.destroyed) {
      restyleEdges(graph, graphPalette(mode))
    }
  }, [mode, themed])

  return <GraphCanvas onInit={onInit} options={options} />
}

export default DependencyGraph
