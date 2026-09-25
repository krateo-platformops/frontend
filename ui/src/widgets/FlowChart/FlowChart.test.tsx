// @vitest-environment jsdom
/**
 * FlowChart after the extraction of its graph into components/DependencyGraph: it must hand G6
 * EXACTLY what it handed it before — the C19 literals, the same data, G6's own colours — so the
 * widget does not change by a pixel. The expected objects below are the pre-extraction props of
 * `<FlowGraph>` in FlowChart.tsx, written out rather than imported, so a drift in the shared
 * module fails here instead of silently restyling every FlowChart CR.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'

import FlowChart, { type FlowChartWidgetData } from './FlowChart'
import { toGraphData } from './utils'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

const node = (uid: string, name: string, parents: string[] = []) => ({
  date: '2026-09-20T00:00:00Z',
  kind: 'Deployment',
  name,
  namespace: 'demo',
  parentRefs: parents.map((parent) => ({ uid: parent })),
  resourceVersion: '1',
  uid,
  version: 'apps/v1',
})

const REFS = { items: [] }

const WIDGET_DATA = { data: [node('a', 'web'), node('b', 'svc', ['a'])] } as unknown as FlowChartWidgetData

beforeEach(() => {
  graphDouble.reset()
  // The card's antd Avatar reads breakpoints on mount; jsdom has no matchMedia.
  vi.stubGlobal('matchMedia', (media: string) => ({
    addEventListener: vi.fn(), addListener: vi.fn(), matches: false, media, removeEventListener: vi.fn(), removeListener: vi.fn(),
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

describe('FlowChart — unchanged by the DependencyGraph extraction', () => {
  it('hands FlowGraph the pre-extraction options, byte for byte', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={WIDGET_DATA} />)
    const options = graphDouble.last()
    expect(options.autoFit).toBe('view')
    expect(options.behaviors).toEqual(['drag-canvas', 'zoom-canvas'])
    expect(options.data).toEqual(toGraphData(WIDGET_DATA.data))
    expect(options.edge).toEqual({ style: { router: false }, type: 'cubic-horizontal' })
    expect(options.layout).toEqual({ nodesep: 32, rankdir: 'LR', ranksep: 160, type: 'dagre' })
    expect(options.node).toEqual({
      style: { component: expect.any(Function) as unknown, ports: [{ placement: 'left' }, { placement: 'right' }], size: [400, 150] },
      type: 'react',
    })
    // The one addition: onInit binds node:click, a no-op for FlowChart, which passes no handler.
    expect(Object.keys(options).sort()).toEqual(['autoFit', 'behaviors', 'data', 'edge', 'layout', 'node', 'onInit'])
  })

  it('each node is still the FlowChartNodeElement card', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={WIDGET_DATA} />)
    expect(screen.getByText('web')).toBeTruthy()
    expect(screen.getByText('svc')).toBeTruthy()
    expect(screen.getAllByText('Deployment')).toHaveLength(2)
  })

  it('no data is still the shared empty state', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={{ data: [] }} />)
    expect(screen.getByText('Nothing to graph')).toBeTruthy()
    expect(graphDouble.renders).toHaveLength(0)
  })

  it('a host re-render with the same CR data no longer re-lays the graph out; a theme flip does not either', async () => {
    const { rerender } = render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={WIDGET_DATA} />)
    rerender(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={{ ...WIDGET_DATA }} />)
    await act(async () => {
      document.documentElement.dataset.theme = 'dark'
      await Promise.resolve()
    })
    expect(graphDouble.renders).toHaveLength(1)
  })
})
