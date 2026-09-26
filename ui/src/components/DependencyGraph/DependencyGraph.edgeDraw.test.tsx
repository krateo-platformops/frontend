// @vitest-environment jsdom
/**
 * Drawing an edge by drag (S4b, 5.3): G6's create-edge behaviour, added only when a caller asks,
 * whose callbacks never become new options — so drawing is never a re-layout — and which adds no data
 * of its own at the drop. Against the FlowGraph double, which calls the behaviour as G6 does.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DependencyGraph, { type EdgeDraw } from './DependencyGraph'
import { graphDouble } from './flowGraphDouble'
import { DASHED_EDGE, DRAW_DEPENDENCY, type GraphEdge, type GraphNode } from './graphConfig'

vi.mock('@ant-design/graphs', () => import('./flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

const NODES: GraphNode<{ title: string }>[] = [{ data: { title: 'a' }, id: 'a' }, { data: { title: 'b' }, id: 'b' }, { data: { title: 'c' }, id: 'c' }]
const EDGES: GraphEdge[] = []
const SIZE: [number, number] = [156, 72]
const renderCard = ({ id }: GraphNode<{ title: string }>) => <span>{id}</span>

const spies = () => {
  const draw = { canStart: vi.fn((id: string) => id !== 'c'), onCancel: vi.fn(), onDrop: vi.fn(), onStart: vi.fn() }
  return draw
}

/** Let the pointerup listener's microtask run. */
const flush = () => act(async () => { await Promise.resolve() })

beforeEach(() => { graphDouble.reset() })
afterEach(() => { cleanup() })

describe('DependencyGraph — edgeDraw', () => {
  it('the behaviour is there only with edgeDraw: dashed, by drag, under its own key', () => {
    render(<DependencyGraph edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(graphDouble.last().behaviors).toEqual(['drag-canvas'])
    cleanup()
    graphDouble.reset()
    render(<DependencyGraph edgeDraw={spies()} edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    const behaviors = graphDouble.last().behaviors as unknown[]
    expect(behaviors[0]).toBe('drag-canvas')
    expect(behaviors[1]).toMatchObject({ key: DRAW_DEPENDENCY, style: { lineDash: DASHED_EDGE }, trigger: 'drag', type: 'create-edge' })
  })

  it('new callbacks every render are NOT new options — drawing never re-lays the graph out', () => {
    const Host = () => {
      const [count, setCount] = useState(0)
      // Fresh callbacks on every render, as an inline object would be.
      const draw: EdgeDraw = { canStart: () => true, onCancel: () => undefined, onDrop: () => undefined, onStart: () => undefined }
      return (
        <>
          <button onClick={() => setCount(count + 1)} type='button'>{`render ${count}`}</button>
          <DependencyGraph edgeDraw={draw} edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />
        </>
      )
    }
    render(<Host />)
    fireEvent.click(screen.getByText('render 0'))
    fireEvent.click(screen.getByText('render 1'))
    expect(graphDouble.renders).toHaveLength(1)
  })

  it('a drag from one node onto another: canStart, onStart, then onDrop(source, target) — and no edge data added', async () => {
    const draw = spies()
    render(<DependencyGraph edgeDraw={draw} edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    graphDouble.drawEdge('a', 'b')
    await flush()
    expect(draw.canStart).toHaveBeenCalledWith('a')
    expect(draw.onStart).toHaveBeenCalledWith('a')
    expect(draw.onDrop).toHaveBeenCalledWith('a', 'b')
    expect(draw.onCancel).not.toHaveBeenCalled()
    expect(graphDouble.renders).toHaveLength(1)
  })

  it('the latest callbacks are the ones called', async () => {
    const first = spies()
    const second = spies()
    const { rerender } = render(<DependencyGraph edgeDraw={first} edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    rerender(<DependencyGraph edgeDraw={second} edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    graphDouble.drawEdge('b', 'a')
    await flush()
    expect(first.onDrop).not.toHaveBeenCalled()
    expect(second.onDrop).toHaveBeenCalledWith('b', 'a')
  })

  it('a drop on the canvas cancels', async () => {
    const draw = spies()
    render(<DependencyGraph edgeDraw={draw} edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    graphDouble.drawEdgeToCanvas('a')
    await flush()
    expect(draw.onStart).toHaveBeenCalledWith('a')
    expect(draw.onCancel).toHaveBeenCalledTimes(1)
    expect(draw.onDrop).not.toHaveBeenCalled()
  })

  it('a drop back on the source cancels — it is not a refusal', async () => {
    const draw = spies()
    render(<DependencyGraph edgeDraw={draw} edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    graphDouble.drawEdge('a', 'a')
    await flush()
    expect(draw.onCancel).toHaveBeenCalledTimes(1)
    expect(draw.onDrop).not.toHaveBeenCalled()
  })

  it('a drag released OUTSIDE the canvas (no graph pointerup): the graph is sent one on its canvas — G6\'s cancel, and ours', async () => {
    const draw = spies()
    render(<DependencyGraph edgeDraw={draw} edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    act(() => { graphDouble.startEdge('a') })
    // The page hears the release; G, whose canvas the pointer left, does not.
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'))
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    })
    await flush()
    expect(graphDouble.emitted).toEqual(['pointerup'])
    expect(draw.onCancel).toHaveBeenCalledTimes(1)
    // …so the next drag starts afresh, rather than being taken for a drop.
    graphDouble.drawEdge('a', 'b')
    await flush()
    expect(draw.onDrop).toHaveBeenCalledWith('a', 'b')
  })

  it('a release INSIDE the canvas sends nothing more — the drop, or the cancel, already ended it', async () => {
    const draw = spies()
    render(<DependencyGraph edgeDraw={draw} edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    await act(async () => {
      graphDouble.drawEdge('a', 'b')
      window.dispatchEvent(new Event('pointerup'))
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    })
    expect(graphDouble.emitted).toEqual([])
    expect(draw.onCancel).not.toHaveBeenCalled()
  })

  it('a second drag START while one stands is G\'s stale press, never a drop', () => {
    const draw = spies()
    render(<DependencyGraph edgeDraw={draw} edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(graphDouble.startEdge('a')).toBe(true)
    expect(graphDouble.startEdge('a')).toBe(false)
    expect(draw.onStart).toHaveBeenCalledTimes(1)
    expect(draw.onCancel).not.toHaveBeenCalled()
  })

  it('a node that may not start draws nothing — and a later ordinary click is not a cancel', async () => {
    const draw = spies()
    render(<DependencyGraph edgeDraw={draw} edges={EDGES} fit='natural' nodeSize={SIZE} nodes={NODES} renderNode={renderCard} />)
    expect(graphDouble.startEdge('c')).toBe(false)
    expect(draw.onStart).not.toHaveBeenCalled()
    graphDouble.dropEdge('c', null)
    await flush()
    expect(draw.onCancel).not.toHaveBeenCalled()
  })
})
