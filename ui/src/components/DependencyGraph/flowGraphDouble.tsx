/**
 * A test double for `@ant-design/graphs`, for component suites that mount a DependencyGraph.
 *
 * WHY. jsdom has no canvas and this repo installs no canvas shim, so a real G6 graph cannot render
 * in a component test. What those tests need to see is not pixels but the CONTRACT: the options
 * handed to FlowGraph, how often they were handed over (every render is a re-layout in the real
 * thing), what each node card renders, that `node:click` reaches the caller, and what was done to
 * the live graph without a re-layout (`setEdge` + `draw`). This double records all of it. Where
 * nodes land is tested against the real layout class, in node, by
 * `pages/BlueprintComposer/architectureGraph.layout.test.ts`.
 *
 * THE GRAPH'S LIFECYCLE IS THE LIBRARY'S, on purpose — a double that is kinder than the library
 * hides the library's defects. @antv/graphin creates the G6 graph in a MOUNT EFFECT, calls
 * `onInit(graph)` there, and destroys it in that effect's cleanup; @ant-design/graphs' BaseGraph
 * fills its forwarded ref at COMMIT, from a slot that effect has not filled yet — so the forwarded
 * ref is null after mount, and gets the graph only if FlowGraph renders again. All mirrored here.
 *
 * USE, in a `// @vitest-environment jsdom` suite:
 *   vi.mock('@ant-design/graphs', () => import('<relative>/components/DependencyGraph/flowGraphDouble'))
 *   vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))
 * and read `graphDouble` from this module (the mock and the test share one instance).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react'

/** The FlowGraph props a suite reads back. No index signature: forwardRef's Omit would erase the named keys. */
interface Options {
  autoFit?: unknown
  behaviors?: unknown
  data?: { nodes?: { id: string }[]; edges?: unknown[] }
  edge?: unknown
  layout?: unknown
  node?: { style?: { component?: (datum: unknown) => ReactNode }; type?: string }
  onInit?: (graph: unknown) => void
}

type Handler = (event: unknown) => void

/** What G6 would have been: its options, an event registry, and the no-re-layout repaint calls. */
export interface FakeGraph {
  destroyed: boolean
  destroy: () => void
  draw: () => Promise<void>
  getOptions: () => Options
  on: (event: string, handler: Handler) => void
  setEdge: (edge: unknown) => void
}

const handlers = new Map<string, Handler[]>()

export const graphDouble = {
  /** Fire G6's `node:click` for a node id, as a pointer click on its card would. */
  click: (id: string): void => {
    for (const handler of handlers.get('node:click') ?? []) { handler({ target: { id } }) }
  },
  /** How many times `draw()` — a repaint without a layout — was called. */
  draws: 0,
  /** Every `setEdge()` argument, oldest first. */
  edgeUpdates: [] as unknown[],
  /** The live graph: created by the mount effect, null again once destroyed. */
  graph: null as FakeGraph | null,
  last: (): Options => {
    const last = graphDouble.renders[graphDouble.renders.length - 1]
    if (!last) { throw new Error('FlowGraph was never rendered') }
    return last
  },
  /** The props of every FlowGraph render, oldest first. One entry is one (re-)layout. */
  renders: [] as Options[],
  reset: (): void => {
    graphDouble.renders.length = 0
    graphDouble.edgeUpdates.length = 0
    graphDouble.draws = 0
    graphDouble.graph = null
    handlers.clear()
  },
}

const createGraph = (options: () => Options): FakeGraph => {
  // A setEdge holds until the next options replace it — as Graphin's setOptions would.
  let override: { edge: unknown; over: Options } | null = null
  const graph: FakeGraph = {
    destroy: () => {
      // G6 emits BEFORE_DESTROY while listeners are still attached, then removes them all.
      for (const handler of handlers.get('beforedestroy') ?? []) { handler({}) }
      handlers.clear()
      graph.destroyed = true
    },
    destroyed: false,
    draw: () => {
      graphDouble.draws += 1
      return Promise.resolve()
    },
    getOptions: () => {
      const current = options()
      return override?.over === current ? { ...current, edge: override.edge } : current
    },
    on: (event, handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    setEdge: (edge) => {
      override = { edge, over: options() }
      graphDouble.edgeUpdates.push(edge)
    },
  }
  return graph
}

/** Renders each node card through the options' own `component`, so the card's DOM is queryable. */
export const FlowGraph = forwardRef<unknown, Options>((props, ref) => {
  graphDouble.renders.push(props)
  // As Graphin: new options (a re-render) replace the graph's options — setOptions + render.
  const latest = useRef(props)
  latest.current = props
  // As BaseGraph: the forwarded ref is filled at commit from a slot the mount effect fills later.
  const slot = useRef<FakeGraph | null>(null)
  useImperativeHandle(ref, () => slot.current)
  // As Graphin's useGraph: create the graph and call onInit once, in a mount effect; destroy it
  // in the cleanup.
  const onInit = useRef(props.onInit)
  useEffect(() => {
    const graph = createGraph(() => latest.current)
    slot.current = graph
    graphDouble.graph = graph
    onInit.current?.(graph)
    return () => {
      graph.destroy()
      slot.current = null
      if (graphDouble.graph === graph) { graphDouble.graph = null }
    }
  }, [])
  const component = props.node?.style?.component
  return (
    <div data-testid='flow-graph'>
      {(props.data?.nodes ?? []).map((node) => <div data-node-id={node.id} key={node.id}>{component?.(node)}</div>)}
    </div>
  )
})
FlowGraph.displayName = 'FlowGraphDouble'

export const G6 = { ExtensionCategory: { NODE: 'node' }, register: (): void => undefined }
