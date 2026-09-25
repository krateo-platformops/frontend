// @vitest-environment jsdom
/**
 * FlowChart after the extraction of its graph into components/DependencyGraph: it must hand G6
 * EXACTLY what it handed it before — the C19 literals, the same data, G6's own colours — so the
 * widget does not change by a pixel. The expected objects below are the pre-extraction props of
 * `<FlowGraph>` in FlowChart.tsx, written out rather than imported, so a drift in the shared
 * module fails here instead of silently restyling every FlowChart CR.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'

import { DEMO_FILES_DENIED, V1B, V1B_REPO_DENIED } from './__fixtures__/architecture'
import FlowChart, { type FlowChartData, type FlowChartWidgetData } from './FlowChart'
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

describe('FlowChart — the resource card without the fields the architecture variant made optional', () => {
  const card = (fields: Record<string, unknown>) => ({ data: [{ kind: 'Agent', name: 'triage', uid: 'x', ...fields }] }) as unknown as FlowChartWidgetData

  it('omits the age tag when there is no date, rather than rendering "NaN days"', () => {
    const { container } = render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={card({})} />)
    expect(screen.getByText('triage')).toBeTruthy()
    expect(container.textContent).not.toMatch(/NaN|days?\b/)
  })

  it('omits it for a date it cannot read, too', () => {
    const { container } = render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={card({ date: 'yesterday' })} />)
    expect(container.textContent).not.toMatch(/NaN/)
  })

  it('omits the version tag when there is no version', () => {
    const { container } = render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={card({})} />)
    expect(container.querySelectorAll('[class*="tagFlow"]')).toHaveLength(0)
  })

  it('still shows both tags when both are there', () => {
    const { container } = render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={card({ date: '2026-09-20T00:00:00Z', version: 'apps/v1' })} />)
    const tags = [...container.querySelectorAll('[class*="tagFlow"]')].map((tag) => tag.textContent)
    expect(tags).toHaveLength(2)
    expect(tags[0]).toMatch(/^\d+ days?$/)
    expect(tags[1]).toBe('apps/v1')
  })
})

const architecture = (data: FlowChartData): FlowChartWidgetData => ({ data, variant: 'architecture' })

/** The card for one node, found by its accessible name — "kind name, state, …". */
const nodeCard = (kind: string, name: string): HTMLElement => screen.getByRole('group', { name: new RegExp(`^${kind} ${name},`) })

describe('FlowChart variant: architecture — a chart\'s topology in the state the composition is in', () => {
  it('draws every node in the state the RESTAction gives it', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(V1B)} />)
    expect(nodeCard('Repository', 'publish-pod-sizing-v1b-repo').dataset.state).toBe('done')
    expect(nodeCard('Repo', 'publish-pod-sizing-v1b-source').dataset.state).toBe('waiting')
    expect(nodeCard('LocalResource ×10', 'publish-pod-sizing-v1b-000 … 009').dataset.state).toBe('withheld')
    expect(nodeCard('PullRequest', 'publish-pod-sizing-v1b-pr').dataset.state).toBe('withheld')
  })

  it('shows each node\'s kind, name and detail line', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(V1B)} />)
    const files = within(nodeCard('LocalResource ×10', 'publish-pod-sizing-v1b-000 … 009'))
    expect(files.getByText('LocalResource ×10')).toBeTruthy()
    expect(files.getByText('publish-pod-sizing-v1b-000 … 009')).toBeTruthy()
    expect(files.getByText('waits for Repository, Repo')).toBeTruthy()
    expect(within(nodeCard('Repository', 'publish-pod-sizing-v1b-repo')).getByText('default_branch · main')).toBeTruthy()
  })

  it('a done node is neutral: no marker, even when it is done only because a dependent proves it', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(DEMO_FILES_DENIED)} />)
    const cards = screen.getAllByRole('group')
    expect(cards.map((card) => card.dataset.state)).toEqual(['done', 'done', 'done', 'done'])
    expect(screen.queryByTestId('architecture-exception')).toBeNull()
    const proven = nodeCard('LocalResource ×10', 'publish-pod-sizing-demo-000 … 009')
    expect(within(proven).getByText('not readable with your access')).toBeTruthy()
    // An empty detail is no line at all, not an empty one.
    expect(nodeCard('PullRequest', 'publish-pod-sizing-demo-pr').children).toHaveLength(2)
  })

  it('carries the one exception as a dot and the condition\'s name, on that node only', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(V1B)} />)
    const markers = screen.getAllByTestId('architecture-exception')
    expect(markers).toHaveLength(1)
    expect(within(nodeCard('Repo', 'publish-pod-sizing-v1b-source')).getByTestId('architecture-exception')).toBe(markers[0])
    expect(markers[0].textContent).toBe('NotSynced')
    expect(markers[0].querySelector('[class*="dot"]')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('says the exception in full in its tooltip: "label: reason — message"', async () => {
    // antd's Tooltip measures its popup; jsdom has no ResizeObserver.
    vi.stubGlobal('ResizeObserver', class { disconnect = vi.fn(); observe = vi.fn(); unobserve = vi.fn() })
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(V1B)} />)
    fireEvent.mouseEnter(screen.getByTestId('architecture-exception'))
    expect(await screen.findByText(/^NotSynced: ReconcileError — cannot determine creation result/)).toBeTruthy()
  })

  it('names each card "kind name, state, exception" for a screen reader', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(V1B)} />)
    expect(nodeCard('Repo', 'publish-pod-sizing-v1b-source').getAttribute('aria-label')).toBe(
      'Repo publish-pod-sizing-v1b-source, waiting, NotSynced: ReconcileError — cannot determine creation result - remove the krateo.io/external-create-pending annotation if it is safe to proceed',
    )
    expect(nodeCard('Repository', 'publish-pod-sizing-v1b-repo').getAttribute('aria-label')).toBe('Repository publish-pod-sizing-v1b-repo, done')
  })

  it('draws a node the caller cannot read as unreadable, with its detail and no marker', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(V1B_REPO_DENIED)} />)
    const repo = nodeCard('Repo', 'publish-pod-sizing-v1b-source')
    expect(repo.dataset.state).toBe('unreadable')
    expect(within(repo).getByText('not readable with your access')).toBeTruthy()
    expect(within(repo).queryByTestId('architecture-exception')).toBeNull()
  })

  it('draws unavailable and unknown muted, and a state it does not know as unknown', () => {
    const data: FlowChartData = [
      { detail: 'could not be read', kind: 'Deployment', name: 'app', state: 'unavailable', uid: 'arch:app' },
      { kind: 'ConfigMap', name: 'settings', state: 'unknown', uid: 'arch:settings' },
      { kind: 'Secret', name: 'shim', state: 'orthogonal', uid: 'arch:shim' } as unknown as FlowChartData[number],
    ]
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(data)} />)
    expect(nodeCard('Deployment', 'app').dataset.state).toBe('unavailable')
    expect(within(nodeCard('Deployment', 'app')).getByText('could not be read')).toBeTruthy()
    expect(nodeCard('ConfigMap', 'settings').dataset.state).toBe('unknown')
    expect(nodeCard('Secret', 'shim').dataset.state).toBe('unknown')
  })

  it('dashes the edges that point into a withheld node, and only those', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(V1B)} />)
    const { data, edge } = graphDouble.last() as { data: { edges: { id: string }[] }; edge: { style: { lineDash: (datum: unknown) => unknown } } }
    expect(data.edges.map((each) => [each.id, edge.style.lineDash(each)])).toEqual([
      ['arch:repository→arch:repo', 0],
      ['arch:repository→arch:localresources', [6, 4]],
      ['arch:repo→arch:localresources', [6, 4]],
      ['arch:localresources→arch:pullrequest', [6, 4]],
    ])
  })

  it('is themed and drawn at the cards\' true size, 220×84', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(V1B)} />)
    const options = graphDouble.last() as { autoFit: unknown; behaviors: unknown; edge: { style: Record<string, unknown> }; node: { style: { size: unknown } } }
    expect(options.node.style.size).toEqual([220, 84])
    expect(options.autoFit).toEqual({ animation: false, type: 'center' })
    expect(options.behaviors).toEqual(['drag-canvas'])
    // The palette's keys are on the edge style: its colours come from the tokens, not from G6.
    expect(Object.keys(options.edge.style)).toEqual(expect.arrayContaining(['labelFill', 'stroke']))
  })

  it('no nodes is the shared empty state', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture([])} />)
    expect(screen.getByText('Nothing to graph')).toBeTruthy()
    expect(graphDouble.renders).toHaveLength(0)
  })
})

describe('the architecture card\'s stylesheet — exception-only, and nothing green', () => {
  const css = readFileSync(join(__dirname, 'ArchitectureStateNode', 'ArchitectureStateNode.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  it('gives a done node no rule of its own: it is the card as it is', () => {
    expect(css).not.toMatch(/data-state='done'/)
  })

  it('uses no green or success colour anywhere', () => {
    expect(css).not.toMatch(/green|success/)
  })

  it('draws the exception dot, and only the dot, in the error token', () => {
    expect(css.match(/status-error/g)).toHaveLength(1)
    expect(css).toMatch(/\.dot\s*\{[^}]*--krateo-color-status-error\)/)
  })

  it('draws a withheld node dashed', () => {
    expect(css).toMatch(/\.card\[data-state='withheld'\]\s*\{[^}]*border-style: dashed/)
  })
})
