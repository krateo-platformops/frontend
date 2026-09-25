// @vitest-environment jsdom
/**
 * The shared graph's contract, against a FlowGraph double (jsdom has no canvas — see
 * flowGraphDouble.tsx). Each FlowGraph render in the double stands for one full G6 re-layout +
 * autoFit in the real thing, so "rendered once" below means "the user's pan and zoom survived".
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDocumentThemeMode } from '../../theme/palette'
import { color, colorDark } from '../../theme/tokens'

import DependencyGraph from './DependencyGraph'
import { graphDouble } from './flowGraphDouble'
import type { GraphEdge, GraphNode } from './graphConfig'
import { NATURAL_PADDING } from './naturalViewport'

vi.mock('@ant-design/graphs', () => import('./flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

interface Card { title: string }

const NODES: GraphNode<Card>[] = [{ data: { title: 'Repository' }, id: 'repository' }, { data: { title: 'Repo' }, id: 'repo' }]
const EDGES: GraphEdge<{ ready: boolean }>[] = [{ data: { minlen: 2, ready: false }, id: 'repo:dependsOn[0]', source: 'repository', target: 'repo' }]
const SIZE: [number, number] = [156, 72]
const renderCard = ({ data, id }: GraphNode<Card>) => <span>{`${id}: ${data.title}`}</span>

type Style = Record<string, unknown>
const edgeStyle = (): Style => (graphDouble.last().edge as { style: Style }).style
const layout = (): Style => graphDouble.last().layout as Style
/** The edge mapping the live graph holds now — what G6 paints from. */
const liveEdge = (): { style: Style; type: string } => graphDouble.graph!.getOptions().edge as { style: Style; type: string }

// A sibling reading the same mode proves a flip was observed before "nothing happened" is asserted.
const Mode = () => <output>{`mode ${useDocumentThemeMode()}`}</output>

const flipTo = async (mode: 'dark' | 'light'): Promise<void> => {
  act(() => {
    document.documentElement.dataset.theme = mode
  })
  await screen.findByText(`mode ${mode}`)
}

beforeEach(() => {
  graphDouble.reset()
  document.documentElement.dataset.theme = 'light'
})

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.theme
})

describe('DependencyGraph — C19, from the one definition', () => {
  it('hands FlowGraph the landed geometry: curved edges, dagre LR 160/32, left/right ports, the caller size', () => {
    render(<DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    const options = graphDouble.last()
    expect(options.autoFit).toBe('view')
    expect(options.behaviors).toEqual(['drag-canvas', 'zoom-canvas'])
    expect(options.edge).toMatchObject({ style: { router: false }, type: 'cubic-horizontal' })
    expect(layout()).toMatchObject({ nodesep: 32, rankdir: 'LR', ranksep: 160, type: 'dagre' })
    expect(options.node).toMatchObject({ style: { ports: [{ placement: 'left' }, { placement: 'right' }], size: SIZE }, type: 'react' })
    expect(options.data).toEqual({ edges: EDGES, nodes: NODES })
  })

  it('renders each card through renderNode with its id and data', () => {
    render(<DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(screen.getByText('repository: Repository')).toBeTruthy()
    expect(screen.getByText('repo: Repo')).toBeTruthy()
  })
})

describe('DependencyGraph — a parent re-render is not a re-layout', () => {
  it('stable inputs render FlowGraph once, however often the host re-renders — even with an inline onNodeClick', () => {
    const Host = () => {
      const [count, setCount] = useState(0)
      return (
        <>
          <button onClick={() => setCount(count + 1)} type='button'>{`step ${count}`}</button>
          <DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} onNodeClick={() => undefined} renderNode={renderCard} />
        </>
      )
    }
    render(<Host />)
    fireEvent.click(screen.getByText('step 0'))
    fireEvent.click(screen.getByText('step 1'))
    expect(screen.getByText('step 2')).toBeTruthy()
    expect(graphDouble.renders).toHaveLength(1)
  })

  it('new data IS a new layout', () => {
    const { rerender } = render(<DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    rerender(<DependencyGraph edges={[]} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(graphDouble.renders).toHaveLength(2)
  })
})

describe('DependencyGraph — colours come from the tokens and follow the theme', () => {
  it('paints edges and labels from the active mode; the mount itself repaints nothing', () => {
    render(<DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(edgeStyle()).toMatchObject({ labelBackgroundFill: color.panelbg, labelFill: color.gray, stroke: color.faint })
    expect(graphDouble.edgeUpdates).toEqual([])
  })

  it('a data-theme flip REPAINTS the live graph (setEdge + draw) and is not a re-layout — pan and zoom survive', async () => {
    const appearance = (edge: GraphEdge<{ ready: boolean }>) => ({ dashed: !edge.data?.ready })
    render(
      <>
        <Mode />
        <DependencyGraph edgeAppearance={appearance} edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />
      </>,
    )
    await flipTo('dark')
    expect(graphDouble.renders).toHaveLength(1)
    expect(graphDouble.edgeUpdates).toHaveLength(1)
    expect(graphDouble.draws).toBe(1)
    expect(liveEdge().style).toMatchObject({ labelBackgroundFill: colorDark.panelbg, labelFill: colorDark.gray, router: false, stroke: colorDark.faint })
    // The colours are laid over the mapping, not rebuilt: the per-edge dash is still there.
    expect((liveEdge().style.lineDash as (datum: unknown) => unknown)(EDGES[0])).toEqual([6, 4])
    expect(liveEdge().type).toBe('cubic-horizontal')

    await flipTo('light')
    expect(graphDouble.renders).toHaveLength(1)
    expect(liveEdge().style).toMatchObject({ labelBackgroundFill: color.panelbg, labelFill: color.gray, stroke: color.faint })
  })

  it('the repaint keeps what the library merged into the live mapping (the arrowheads), since setEdge replaces it whole', async () => {
    render(
      <>
        <Mode />
        <DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />
      </>,
    )
    // FlowGraph hands G6 its defaults merged with ours; stand that merge up on the live graph.
    const merged = liveEdge()
    act(() => graphDouble.graph!.setEdge({ ...merged, style: { ...merged.style, endArrow: true, lineWidth: 2 } }))
    await flipTo('dark')
    expect(liveEdge().style).toMatchObject({ endArrow: true, lineWidth: 2, stroke: colorDark.faint })
  })

  it('new data after a flip is laid out in the colours of the mode active then', async () => {
    const { rerender } = render(
      <>
        <Mode />
        <DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />
      </>,
    )
    await flipTo('dark')
    rerender(
      <>
        <Mode />
        <DependencyGraph edges={[]} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />
      </>,
    )
    expect(graphDouble.renders).toHaveLength(2)
    expect(edgeStyle()).toMatchObject({ labelBackgroundFill: colorDark.panelbg, labelFill: colorDark.gray, stroke: colorDark.faint })
  })

  it('themed={false} keeps G6\'s own colours: the edge options are exactly C19\'s, and a theme flip repaints nothing', async () => {
    render(
      <>
        <Mode />
        <DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} themed={false} />
      </>,
    )
    expect(graphDouble.last().edge).toEqual({ style: { router: false }, type: 'cubic-horizontal' })
    await flipTo('dark')
    expect(graphDouble.renders).toHaveLength(1)
    expect(graphDouble.edgeUpdates).toEqual([])
  })

  it('edgeAppearance sets a label and a dash per edge; nothing else about colour', () => {
    const appearance = (edge: GraphEdge<{ ready: boolean }>) => ({ dashed: !edge.data?.ready, label: edge.data?.ready ? undefined : 'exists' })
    render(<DependencyGraph edgeAppearance={appearance} edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    const style = edgeStyle() as { labelText: (datum: unknown) => string; lineDash: (datum: unknown) => unknown }
    expect(style.labelText(EDGES[0])).toBe('exists')
    expect(style.lineDash(EDGES[0])).toEqual([6, 4])
    const ready = { ...EDGES[0], data: { ready: true } }
    expect(style.labelText(ready)).toBe('')
    expect(style.lineDash(ready)).toBe(0)
  })

  it('edgeAppearance still applies with themed={false} — a dash and a label are not colours', () => {
    const appearance = (edge: GraphEdge<{ ready: boolean }>) => ({ dashed: !edge.data?.ready, label: edge.data?.ready ? undefined : 'exists' })
    render(<DependencyGraph edgeAppearance={appearance} edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} themed={false} />)
    const style = edgeStyle() as { labelText: (datum: unknown) => string; lineDash: (datum: unknown) => unknown }
    expect(style.labelText(EDGES[0])).toBe('exists')
    expect(style.lineDash(EDGES[0])).toEqual([6, 4])
    // …and still no colour: G6's own stand.
    expect(Object.keys(style).sort()).toEqual(['labelText', 'lineDash', 'router'])
  })
})

describe('DependencyGraph — per-edge minlen reaches dagre', () => {
  it('adds edgeMinLen reading data.minlen when an edge carries one', () => {
    render(<DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    const edgeMinLen = layout().edgeMinLen as (edge: unknown) => number
    expect(edgeMinLen(EDGES[0])).toBe(2)
    expect(edgeMinLen({ source: 'a', target: 'b' })).toBe(1)
  })

  it('leaves the layout exactly C19 when no edge asks for a span', () => {
    render(<DependencyGraph edges={[{ id: 'e', source: 'repository', target: 'repo' }]} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(layout()).toEqual({ nodesep: 32, rankdir: 'LR', ranksep: 160, type: 'dagre' })
  })
})

describe('DependencyGraph — node click and the graph handle', () => {
  it('node:click reports the node id to the LATEST onNodeClick, without re-laying out for a new callback', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} onNodeClick={first} renderNode={renderCard} />)
    act(() => graphDouble.click('repo'))
    expect(first).toHaveBeenCalledWith('repo')

    rerender(<DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} onNodeClick={second} renderNode={renderCard} />)
    act(() => graphDouble.click('repository'))
    expect(second).toHaveBeenCalledWith('repository')
    expect(first).toHaveBeenCalledTimes(1)
    expect(graphDouble.renders).toHaveLength(1)
  })

  it('a click with no onNodeClick is a no-op, not a throw', () => {
    render(<DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(() => graphDouble.click('repo')).not.toThrow()
  })

  // The library fills FlowGraph's forwarded ref at commit, before the graph exists, and never
  // again while FlowGraph does not re-render (the double does the same): only onInit sees the graph.
  it('graphRef receives the G6 graph once G6 creates it — with no re-render needed — and loses it on unmount', () => {
    const ref = createRef<unknown>()
    const { unmount } = render(<DependencyGraph edges={EDGES} graphRef={ref as never} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(graphDouble.renders).toHaveLength(1)
    expect(ref.current).not.toBeNull()
    expect(ref.current).toBe(graphDouble.graph)
    unmount()
    expect(ref.current).toBeNull()
  })

  it('a callback ref is called with the graph, then with null when the graph is destroyed', () => {
    const calls: unknown[] = []
    const callback = (graph: unknown) => {
      calls.push(graph)
    }
    const { unmount } = render(<DependencyGraph edges={EDGES} graphRef={callback as never} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    const { graph } = graphDouble
    expect(graph).not.toBeNull()
    expect(calls).toEqual([graph])
    unmount()
    expect(calls).toEqual([graph, null])
  })

  it('a swapped ref: the old one lets go, the new one gets the live graph, and nothing is re-laid out', () => {
    const first = createRef<unknown>()
    const second = createRef<unknown>()
    const { rerender } = render(<DependencyGraph edges={EDGES} graphRef={first as never} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    rerender(<DependencyGraph edges={EDGES} graphRef={second as never} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(first.current).toBeNull()
    expect(second.current).toBe(graphDouble.graph)
    expect(graphDouble.renders).toHaveLength(1)
  })
})

describe('DependencyGraph — element states: a step drawn without a layout', () => {
  const STATES = { lit: { lineWidth: 2 }, withheld: { opacity: 0.35 } }
  const renderStated = ({ id, states }: GraphNode<Card>) => <span>{`${id}: ${(states ?? []).join(',') || 'none'}`}</span>

  it('edgeStates reaches G6 as the edge `state` mapping — and only for a caller that passes it', () => {
    render(<DependencyGraph edgeStates={STATES} edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} themed={false} />)
    expect(graphDouble.last().edge).toEqual({ state: STATES, style: { router: false }, type: 'cubic-horizontal' })
  })

  it('a card is rendered with the states in its data, and with no `states` key when it has none', () => {
    const seen: GraphNode<Card>[] = []
    const record = (node: GraphNode<Card>) => {
      seen.push(node)
      return renderStated(node)
    }
    render(<DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={[{ ...NODES[0], states: ['lit'] }, NODES[1]]} renderNode={record} />)
    expect(screen.getByText('repository: lit')).toBeTruthy()
    expect(seen.find((node) => node.id === 'repo')).toEqual({ data: { title: 'Repo' }, id: 'repo' })
  })

  it('setElementState on the live graph redraws the cards in their new states and is NOT a re-layout', () => {
    const ref = createRef<{ setElementState: (config: Record<string, string[]>) => Promise<void> }>()
    render(<DependencyGraph edgeStates={STATES} edges={EDGES} graphRef={ref as never} nodeSize={SIZE} nodes={NODES} renderNode={renderStated} />)
    expect(screen.getByText('repo: none')).toBeTruthy()
    act(() => { void ref.current?.setElementState({ repo: ['withheld'], 'repo:dependsOn[0]': ['withheld'], repository: ['lit'] }) })
    expect(screen.getByText('repo: withheld')).toBeTruthy()
    expect(screen.getByText('repository: lit')).toBeTruthy()
    expect(graphDouble.renders).toHaveLength(1)
    expect(graphDouble.stateUpdates).toHaveLength(1)
  })
})

describe('DependencyGraph — fit="natural": cards at their true size, in a box that can change', () => {
  /** A ResizeObserver that reports only when told to — jsdom has none, and lays nothing out. */
  const installResizeObserver = () => {
    const observed: { callback: ResizeObserverCallback; element: Element }[] = []
    globalThis.ResizeObserver = class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      disconnect = (): void => undefined
      observe = (element: Element): void => { observed.push({ callback: this.callback, element }) }
      unobserve = (): void => undefined
    }
    return {
      observed,
      /** Give the observed box a new size and report it, as a layout change would. */
      resize: (width: number, height: number): void => {
        for (const { callback, element } of observed) {
          Object.defineProperty(element, 'clientWidth', { configurable: true, value: width })
          Object.defineProperty(element, 'clientHeight', { configurable: true, value: height })
          act(() => { callback([], {} as ResizeObserver) })
        }
      },
    }
  }

  afterEach(() => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  })

  it('FlowChart\'s default is untouched: fit to the view, nothing placed after the layout, nothing observed', () => {
    const observer = installResizeObserver()
    render(<DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(graphDouble.last().autoFit).toBe('view')
    expect(graphDouble.viewport).toEqual([])
    expect(observer.observed).toHaveLength(0)
  })

  it('never fits to the view: G6 centres at 1:1, and every layout is placed at zoom 1', async () => {
    installResizeObserver()
    render(<DependencyGraph edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(graphDouble.last().autoFit).toBe('center')
    await waitFor(() => expect(graphDouble.viewport).toEqual(['zoomTo 1', 'fitCenter']))
  })

  it('follows ITS BOX, not the window: a resize resizes the canvas and places the graph again — once per size', async () => {
    const observer = installResizeObserver()
    render(<DependencyGraph edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(observer.observed).toHaveLength(1)
    await waitFor(() => expect(graphDouble.viewport).toEqual(['zoomTo 1', 'fitCenter']))
    graphDouble.viewport.length = 0
    observer.resize(826, 360)
    await waitFor(() => expect(graphDouble.viewport).toEqual(['resize', 'zoomTo 1', 'fitCenter']))
    observer.resize(826, 360)
    expect(graphDouble.viewport).toEqual(['resize', 'zoomTo 1', 'fitCenter'])
    // Resizing is not a re-layout.
    expect(graphDouble.renders).toHaveLength(1)
  })

  it('turns the browser\'s focus-scroll into a pan: a card focused off the canvas moves WITH its edges', async () => {
    // A card is a DOM button in G6's HTML layer, over the edges' <canvas>. Tabbing to one past the
    // box's edge makes the browser scroll that layer's overflow:hidden container to reveal it — the
    // cards moved and the edges did not. Measured: 206px on builder-publish's fourth column.
    installResizeObserver()
    render(<DependencyGraph edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    await waitFor(() => expect(graphDouble.viewport).toEqual(['zoomTo 1', 'fitCenter']))
    graphDouble.viewport.length = 0
    const layer = screen.getByTestId('flow-graph')
    let scrollLeft = 206
    Object.defineProperty(layer, 'scrollLeft', { configurable: true, get: () => scrollLeft, set: (value: number) => { scrollLeft = value } })
    act(() => { layer.dispatchEvent(new Event('scroll')) })
    expect(scrollLeft).toBe(0)
    expect(graphDouble.viewport).toEqual(['translateBy -206,0'])
  })

  it('pans a focused card into view on EITHER side — the browser cannot scroll left of zero', async () => {
    // After a pan to the right-hand column, Shift+Tab back to the first one focuses a card left of
    // the box, where no scroll can reach: it would take focus unseen.
    installResizeObserver()
    render(<DependencyGraph edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    await waitFor(() => expect(graphDouble.viewport).toEqual(['zoomTo 1', 'fitCenter']))
    graphDouble.viewport.length = 0
    const layer = screen.getByTestId('flow-graph')
    const box = layer.parentElement as HTMLElement
    const rect = (left: number, top: number, width: number, height: number) => () => ({ bottom: top + height, height, left, right: left + width, top, width, x: left, y: top }) as DOMRect
    box.getBoundingClientRect = rect(0, 0, 800, 360)
    const card = document.createElement('button')
    layer.appendChild(card)
    // Where the card is drawn: off the LEFT edge first, then in view.
    const drawnAt = { left: -190 }
    card.getBoundingClientRect = () => rect(drawnAt.left, 100, 156, 72)()
    act(() => { card.focus() })
    await waitFor(() => expect(graphDouble.viewport).toEqual([`translateBy ${190 + NATURAL_PADDING},0`]))
    // Already in view, nothing moves.
    graphDouble.viewport.length = 0
    drawnAt.left = 300
    act(() => { card.blur() })
    act(() => { card.focus() })
    await new Promise((resolve) => { requestAnimationFrame(resolve) })
    expect(graphDouble.viewport).toEqual([])
  })
})
