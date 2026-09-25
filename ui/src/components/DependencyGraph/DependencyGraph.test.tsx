// @vitest-environment jsdom
/**
 * The shared graph's contract, against a FlowGraph double (jsdom has no canvas — see
 * flowGraphDouble.tsx). Each FlowGraph render in the double stands for one full G6 re-layout +
 * autoFit in the real thing, so "rendered once" below means "the user's pan and zoom survived".
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { color, colorDark } from '../../theme/tokens'

import DependencyGraph, { useDocumentThemeMode } from './DependencyGraph'
import { graphDouble } from './flowGraphDouble'
import type { GraphEdge, GraphNode } from './graphConfig'

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
  it('paints edges and labels from the active mode, and redraws when data-theme flips', async () => {
    render(<DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(edgeStyle()).toMatchObject({ labelBackgroundFill: color.panelbg, labelFill: color.gray, stroke: color.faint })

    act(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await waitFor(() => expect(edgeStyle().stroke).toBe(colorDark.faint))
    expect(edgeStyle()).toMatchObject({ labelBackgroundFill: colorDark.panelbg, labelFill: colorDark.gray })
    expect(graphDouble.renders).toHaveLength(2)
  })

  it('themed={false} keeps G6\'s own colours: the edge options are exactly C19\'s, and a theme flip redraws nothing', async () => {
    // A sibling reading the same mode proves the flip was observed before "nothing happened" is asserted.
    const Mode = () => <output>{`mode ${useDocumentThemeMode()}`}</output>
    render(
      <>
        <Mode />
        <DependencyGraph edges={EDGES} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} themed={false} />
      </>,
    )
    expect(graphDouble.last().edge).toEqual({ style: { router: false }, type: 'cubic-horizontal' })
    act(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await screen.findByText('mode dark')
    expect(graphDouble.renders).toHaveLength(1)
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

  it('graphRef receives the G6 graph, for state changes that must not re-run the layout', () => {
    const ref = createRef<unknown>()
    render(<DependencyGraph edges={EDGES} graphRef={ref as never} nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(ref.current).toBe(graphDouble.graph)
  })
})
