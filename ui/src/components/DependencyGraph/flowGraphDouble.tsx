/**
 * A test double for `@ant-design/graphs`, for component suites that mount a DependencyGraph.
 *
 * WHY. jsdom has no canvas and this repo installs no canvas shim, so a real G6 graph cannot render
 * in a component test. What those tests need to see is not pixels but the CONTRACT: the options
 * handed to FlowGraph, how often they were handed over (every render is a re-layout in the real
 * thing), what each node card renders, and that `node:click` reaches the caller. This double
 * records all four. Where nodes land is tested against the real layout class, in node, by
 * `pages/BlueprintComposer/architectureGraph.layout.test.ts`.
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

const handlers = new Map<string, Handler>()

/** What G6 would have been: an event registry, nothing else. */
const fakeGraph = {
  on: (event: string, handler: Handler) => {
    handlers.set(event, handler)
  },
}

export const graphDouble = {
  /** Fire G6's `node:click` for a node id, as a pointer click on its card would. */
  click: (id: string): void => {
    handlers.get('node:click')?.({ target: { id } })
  },
  graph: fakeGraph,
  handlers,
  last: (): Options => {
    const last = graphDouble.renders[graphDouble.renders.length - 1]
    if (!last) { throw new Error('FlowGraph was never rendered') }
    return last
  },
  /** The props of every FlowGraph render, oldest first. One entry is one (re-)layout. */
  renders: [] as Options[],
  reset: (): void => {
    graphDouble.renders.length = 0
    handlers.clear()
  },
}

/** Renders each node card through the options' own `component`, so the card's DOM is queryable. */
export const FlowGraph = forwardRef<unknown, Options>((props, ref) => {
  graphDouble.renders.push(props)
  useImperativeHandle(ref, () => fakeGraph)
  // Graphin calls onInit once, when it creates the graph: so does the double.
  const onInit = useRef(props.onInit)
  useEffect(() => {
    onInit.current?.(fakeGraph)
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
