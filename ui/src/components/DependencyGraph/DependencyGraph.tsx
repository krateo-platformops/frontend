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
 *     The caller's part of the bargain: `nodes`, `edges`, `nodeSize`, `renderNode`,
 *     `edgeAppearance` and `graphRef` must be stable (module constants, `useMemo`, `useCallback`).
 *   - TOKEN COLOURS THAT FOLLOW THE THEME. G6 defaults to its own light theme whatever the portal
 *     mode is. `themed` (the default) paints edges and labels from the design tokens and redraws
 *     when `data-theme` flips. `themed={false}` keeps G6's colours, which is what FlowChart has
 *     always drawn (its canvas never followed the portal theme; changing that is a visual change).
 *   - PER-EDGE minlen, so a caller can pin columns to levels (`graphLayout`).
 *   - NODE CLICK. `onNodeClick(id)` fires for G6's `node:click`. It is read through a ref, so an
 *     inline arrow does not count as a changed input. A node card that must be keyboard-operable
 *     should also render a real button wired through `renderNode`'s own closure: G6 hit-tests a
 *     forwarded DOM click at its pointer coordinates, and a key-activated click has none.
 *
 * Empty data is the caller's to handle (FlowChart shows WidgetEmpty): this draws what it is given.
 */
import { FlowGraph, G6, type FlowGraphOptions } from '@ant-design/graphs'
import { ReactNode as G6ReactNode } from '@antv/g6-extension-react'
import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode, type Ref } from 'react'

import type { ThemeMode } from '../../theme/tokens'

import { buildGraphOptions, graphPalette, type EdgeAppearance, type GraphEdge, type GraphNode } from './graphConfig'

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
 * The mode `getColorCode` reads — `data-theme` on <html>, which ThemeModeProvider sets — as a
 * subscribable value. Read from the attribute rather than the context so the graph needs no
 * provider (a widget mounted in a test, a node's own React root) and cannot disagree with the
 * palette helpers about which mode is active.
 */
const readMode = (): ThemeMode => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

const subscribeMode = (onChange: () => void): (() => void) => {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => undefined
  }
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributeFilter: ['data-theme'], attributes: true })
  return () => observer.disconnect()
}

export const useDocumentThemeMode = (): ThemeMode => useSyncExternalStore(subscribeMode, readMode, () => 'light')

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
  graphRef?: Ref<G6.Graph>
}

/** FlowGraph behind `memo`: with stable props it does not re-render, so G6 does not re-lay out. */
const GraphCanvas = memo(({ graphRef, onInit, options }: CanvasProps) => <FlowGraph {...options} onInit={onInit} ref={graphRef} />)
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
  const palette = useMemo(() => (themed ? graphPalette(mode) : null), [mode, themed])

  const clickRef = useRef(onNodeClick)
  useEffect(() => {
    clickRef.current = onNodeClick
  }, [onNodeClick])

  // Bound once, when G6 creates the graph; the ref makes a later callback the one that fires.
  const onInit = useCallback((graph: G6.Graph) => {
    graph.on(NODE_CLICK, (event: G6.IElementEvent) => {
      const id = event.target?.id
      if (id !== undefined) {
        clickRef.current?.(String(id))
      }
    })
  }, [])

  const options = useMemo(
    () => buildGraphOptions({ edgeAppearance, edges, nodeSize, nodes, palette, renderNode }),
    [edgeAppearance, edges, nodeSize, nodes, palette, renderNode],
  )

  return <GraphCanvas graphRef={graphRef} onInit={onInit} options={options} />
}

export default DependencyGraph
