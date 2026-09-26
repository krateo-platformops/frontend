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
 *   - TRUE SIZE, IN A BOX THAT CHANGES (`fit="natural"`). FlowChart's fit scales the graph to fill
 *     its box; a caller whose cards are designed at a pixel size draws at zoom 1 instead, placed by
 *     `placeAtNaturalSize` after each layout. And G6 sizes its canvas from its container once — its
 *     own `autoResize` hears only the WINDOW — so a box resized by the page around it (the Autopilot
 *     rail opening) left the canvas at its old width: clipped when narrower, stranded in a corner when
 *     wider. With `natural`, the box is observed, and a new size resizes the canvas and places the
 *     graph again. A graph at true size can also be wider than its box, so a card focused past the
 *     edge is PANNED into view — never scrolled, which moved the cards off their edges. FlowChart's
 *     behaviour is unchanged.
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
  type EdgeStateStyles,
  type GraphEdge,
  type GraphFit,
  type GraphNode,
  type GraphPalette,
} from './graphConfig'
import { placeAtNaturalSize, revealOffset } from './naturalViewport'

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
 * The events after which G6 has (re)configured its canvas layers: created, rendered, or given a new
 * renderer. Spelled out, like the two above.
 */
const CANVAS_CONFIGURED = ['aftercanvasinit', 'afterrender', 'afterrendererchange'] as const

interface CanvasLayers {
  getLayers?: () => Record<string, { getContextService?: () => { getDomElement?: () => unknown } } | undefined>
}

/**
 * G6 makes every canvas layer FOCUSABLE — `tabIndex = 1`, outline removed (runtime/canvas.ts,
 * configCanvasDom) — and a positive tabIndex outranks document order. So every graph put its four
 * layers first in the whole page's Tab order, ahead of the navigation: invisible, unnamed stops
 * before anything a person can use. The canvases are paint; what a keyboard reaches is the node
 * cards. Taken out of the Tab order and the accessibility tree each time G6 configures them.
 */
export const untabCanvases = (graph: Pick<G6.Graph, 'getCanvas'>): void => {
  const layers = (graph.getCanvas() as unknown as CanvasLayers | undefined)?.getLayers?.() ?? {}
  for (const layer of Object.values(layers)) {
    const element = layer?.getContextService?.().getDomElement?.()
    if (element instanceof HTMLElement) {
      element.tabIndex = -1
      element.setAttribute('aria-hidden', 'true')
    }
  }
}

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
  /**
   * How an edge looks in each element state the caller sets through `graphRef` — width and
   * opacity only. Absent, edges have no state styles (FlowChart: C19's edge object, key for key).
   */
  edgeStates?: EdgeStateStyles
  /** How the graph meets its box — `view` (default: fill it) or `natural` (zoom 1). See the header. */
  fit?: GraphFit
}

interface CanvasProps {
  options: FlowGraphOptions
  onInit: (graph: G6.Graph) => void
  onReady?: (graph: G6.Graph) => void
}

/**
 * FlowGraph behind `memo`: with stable props it does not re-render, so G6 does not re-lay out.
 * No `ref`: the graph handle comes from `onInit` (see the header).
 */
const GraphCanvas = memo(({ onInit, onReady, options }: CanvasProps) => (
  // `onReady` only when given: FlowChart's props stay exactly what they were (FlowChart.test).
  <FlowGraph {...options} onInit={onInit} {...(onReady ? { onReady } : {})} />
))
GraphCanvas.displayName = 'GraphCanvas'

/** Place a live graph at its true size; a graph torn down mid-placement has nothing left to place. */
const placeNatural = (graph: G6.Graph): void => {
  if (!graph.destroyed) {
    placeAtNaturalSize(graph).catch(() => undefined)
  }
}

const DependencyGraph = <N, E = Record<string, unknown>>({
  edgeAppearance,
  edgeStates,
  edges,
  fit = 'view',
  graphRef,
  nodeSize,
  nodes,
  onNodeClick,
  renderNode,
  themed = true,
}: DependencyGraphProps<N, E>) => {
  const mode = useDocumentThemeMode()
  const natural = fit === 'natural'
  const box = useRef<HTMLDivElement | null>(null)

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
    untabCanvases(graph)
    for (const event of CANVAS_CONFIGURED) {
      graph.on(event, () => { untabCanvases(graph) })
    }
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
    () => buildGraphOptions({ edgeAppearance, edgeStates, edges, fit, nodeSize, nodes, palette: themed ? graphPalette(activeThemeMode()) : null, renderNode }),
    [edgeAppearance, edgeStates, edges, fit, nodeSize, nodes, renderNode, themed],
  )

  // NATURAL: the box, observed. A new size is a canvas resize (no layout) and a new placement; the
  // first report — the size the graph was created at — resizes nothing and places what is drawn.
  useEffect(() => {
    const element = box.current
    if (!natural || !element || typeof ResizeObserver === 'undefined') {
      return undefined
    }
    let seen = ''
    const observer = new ResizeObserver(() => {
      const graph = liveGraph.current
      const size = `${element.clientWidth}×${element.clientHeight}`
      if (!graph || graph.destroyed || size === seen) {
        return
      }
      seen = size
      graph.resize()
      placeNatural(graph)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [natural])

  // NATURAL: a graph at true size can be wider than its box, and its cards are DOM (G6's HTML layer,
  // over the <canvas> the edges are painted on). Focusing a card past the edge — Tab — makes the
  // browser SCROLL that layer's overflow:hidden container to reveal it: the cards moved, the edges
  // did not. So a scroll inside the box is taken back and made a pan, which moves both together and
  // leaves the focused card exactly where the browser put it.
  useEffect(() => {
    const element = box.current
    if (!natural || !element) {
      return undefined
    }
    const onScroll = (event: Event): void => {
      const layer = event.target
      if (!(layer instanceof HTMLElement) || layer === element || (!layer.scrollLeft && !layer.scrollTop)) {
        return
      }
      const offset: [number, number] = [-layer.scrollLeft, -layer.scrollTop]
      layer.scrollLeft = 0
      layer.scrollTop = 0
      const graph = liveGraph.current
      if (graph && !graph.destroyed) {
        graph.translateBy(offset, false).catch(() => undefined)
      }
    }
    // …and a card that takes focus is panned fully into view, on whichever side it sits — next frame,
    // once any scroll the focus caused has been taken back above.
    let frame = 0
    const onFocus = (event: FocusEvent): void => {
      const card = event.target
      if (!(card instanceof HTMLElement)) {
        return
      }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const graph = liveGraph.current
        const offset = revealOffset(card.getBoundingClientRect(), element.getBoundingClientRect())
        if (graph && !graph.destroyed && (offset[0] || offset[1])) {
          graph.translateBy(offset, false).catch(() => undefined)
        }
      })
    }
    // Capture: a scroll event does not bubble.
    element.addEventListener('scroll', onScroll, true)
    element.addEventListener('focusin', onFocus)
    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener('scroll', onScroll, true)
      element.removeEventListener('focusin', onFocus)
    }
  }, [natural])

  useEffect(() => {
    const graph = liveGraph.current
    if (themed && graph && !graph.destroyed) {
      restyleEdges(graph, graphPalette(mode))
    }
  }, [mode, themed])

  if (!natural) {
    return <GraphCanvas onInit={onInit} options={options} />
  }
  // The box the canvas fills, observed for size (above). `height: inherit` passes the caller's height
  // on to Graphin's own container, which inherits its height the same way.
  return (
    <div ref={box} style={{ height: 'inherit', position: 'relative' }}>
      <GraphCanvas onInit={onInit} onReady={placeNatural} options={options} />
    </div>
  )
}

export default DependencyGraph
