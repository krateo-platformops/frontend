// @vitest-environment jsdom
/**
 * G6 leaves every canvas layer focusable with a POSITIVE tabIndex, so a graph put four invisible,
 * unnamed Tab stops at the very front of the page — ahead of the navigation — on the agents
 * topology and, with the composition topology, on every composition detail page. The canvases are
 * paint: what the keyboard reaches is the node cards. They must leave the Tab order, and stay out
 * each time G6 reconfigures them.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ant-design/graphs', () => import('./flowGraphDouble'))

import DependencyGraph, { untabCanvases } from './DependencyGraph'
import { graphDouble } from './flowGraphDouble'

const nodes = [{ data: { label: 'a' }, id: 'a' }, { data: { label: 'b' }, id: 'b' }]
const edges = [{ source: 'a', target: 'b' }]

beforeEach(() => { graphDouble.reset() })
afterEach(cleanup)

describe('the graph canvases are not Tab stops', () => {
  it('takes every layer out of the Tab order and the accessibility tree once G6 creates the graph', () => {
    render(<DependencyGraph edges={edges} nodeSize={[156, 72]} nodes={nodes} renderNode={(node) => <span>{String(node.id)}</span>} />)

    expect(graphDouble.canvases).toHaveLength(4)
    for (const canvas of graphDouble.canvases) {
      expect(canvas.tabIndex).toBe(-1)
      expect(canvas.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('does it again whenever G6 configures the canvases afresh — a render, a renderer change', () => {
    render(<DependencyGraph edges={edges} nodeSize={[156, 72]} nodes={nodes} renderNode={(node) => <span>{String(node.id)}</span>} />)
    for (const event of ['aftercanvasinit', 'afterrender', 'afterrendererchange']) {
      for (const canvas of graphDouble.canvases) { canvas.tabIndex = 1 }
      graphDouble.emit(event)
      expect(graphDouble.canvases.map((canvas) => canvas.tabIndex), event).toEqual([-1, -1, -1, -1])
    }
  })

  it('tolerates a graph whose canvas has no layers yet', () => {
    expect(() => untabCanvases({ getCanvas: () => ({}) } as never)).not.toThrow()
    expect(() => untabCanvases({ getCanvas: () => undefined } as never)).not.toThrow()
  })
})
