// @vitest-environment jsdom
/**
 * `direction` and `density` on the architecture variant.
 *
 * THE SNAPSHOT IS MAIN'S. It was recorded from the tree before these fields existed, so a CR that
 * sets neither (every architecture FlowChart published so far: the composition page's diagram)
 * must hand G6 the same options and draw the same cards, and so must one that spells the defaults
 * out (`LR`, `regular`).
 *
 * One re-record since: the markup's `data-overflows` now comes BEFORE `data-testid`. The fade's flag
 * is decided in the first render (architectureFit, from the measured box) where it used to be set by
 * a state update after it, which put the attribute last. Same attributes, same values. jsdom's box
 * is 0 wide, which architectureFit reads as "not laid out yet" and so decides nothing: the options
 * are main's, unchanged.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'

import { V1B } from './__fixtures__/architecture'
import FlowChart, { type FlowChartData, type FlowChartWidgetData } from './FlowChart'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

const REFS = { items: [] }

/** The options as data: a function is written as the values it gives for every edge drawn. */
const serialise = (options: Record<string, unknown>): string => {
  const edges = ((options.data as { edges?: unknown[] } | undefined)?.edges ?? [])
  return JSON.stringify(options, (key, value: unknown) => {
    if (typeof value !== 'function') { return value }
    if (key === 'component' || key === 'onInit' || key === 'onReady') { return `ƒ ${key}` }
    // Key order is the snapshot's, which main wrote: sorting it would mean re-recording it here.
    // eslint-disable-next-line sort-keys/sort-keys-fix
    return { ƒ: key, perEdge: edges.map((edge) => (value as (datum: unknown) => unknown)(edge)) }
  }, 2)
}

/** What the page draws: the options G6 is handed, and the markup of the box with its cards. */
const drawn = (widgetData: FlowChartWidgetData) => {
  render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={widgetData} />)
  return {
    markup: screen.getByTestId('architecture-graph-box').outerHTML,
    options: serialise(graphDouble.last() as Record<string, unknown>),
  }
}

const architecture = (data: FlowChartData, extra: Record<string, unknown> = {}): FlowChartWidgetData =>
  ({ data, variant: 'architecture', ...extra })

/** One service of a service path: what a page drawing a trace's services would send. */
const service = (uid: string, detail: string, parents: string[] = []): FlowChartData[number] => ({
  detail,
  kind: 'Service',
  name: uid,
  names: [uid],
  parentRefs: parents.map((parent) => ({ uid: parent })),
  state: 'done',
  uid,
})

// krateo-057, a portal trace: three services, three ranks.
const THREE: FlowChartData = [
  service('krateo-frontend', '1 span'),
  service('krateo-agent-gateway-platform', '2 spans', ['krateo-frontend']),
  service('snowplow', '1 span', ['krateo-agent-gateway-platform']),
]
// An agent trace: four ranks.
const FOUR: FlowChartData = [
  service('krateo-frontend', '1 span'),
  service('krateo-agent-gateway-platform', '2 spans', ['krateo-frontend']),
  service('agentiko', '6 spans', ['krateo-agent-gateway-platform']),
  service('k8s-agent', '3 spans', ['agentiko']),
]
// …fanning out from the orchestrator to the model and a sub-agent.
const FAN_OUT_TWO: FlowChartData = [...FOUR, service('model', '2 spans', ['agentiko'])]
const FAN_OUT_THREE: FlowChartData = [...FAN_OUT_TWO, service('clickhouse-mcp', '1 span', ['agentiko'])]

const TB_COMPACT = { density: 'compact', direction: 'TB' }

/** jsdom lays nothing out, so the box reports the size the trace page gives it: ~415 × 360. */
const sizeTheBox = (width: number, height: number) => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height)
}

const box = () => screen.getByTestId('architecture-graph-box')

beforeEach(() => {
  graphDouble.reset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('FlowChart architecture — LR and regular are main, byte for byte', () => {
  it('draws what main drew when neither field is set', () => {
    const { markup, options } = drawn(architecture(V1B))
    expect(options).toMatchSnapshot('options')
    expect(markup).toMatchSnapshot('markup')
  })

  it('draws the same when the defaults are spelled out: direction LR, density regular', () => {
    const before = drawn(architecture(V1B))
    cleanup()
    graphDouble.reset()
    expect(drawn(architecture(V1B, { density: 'regular', direction: 'LR' }))).toEqual(before)
  })

  it('draws the same for a value this build does not know', () => {
    const before = drawn(architecture(V1B))
    cleanup()
    graphDouble.reset()
    expect(drawn(architecture(V1B, { density: 'tiny', direction: 'RL' }))).toEqual(before)
  })

  it('CONTROL: the snapshot tells TB compact apart — the same data draws differently', () => {
    const before = drawn(architecture(V1B))
    cleanup()
    graphDouble.reset()
    const after = drawn(architecture(V1B, TB_COMPACT))
    expect(after.options).not.toBe(before.options)
    expect(after.markup).not.toBe(before.markup)
  })
})

describe('FlowChart architecture — TB compact', () => {
  it('lays out top to bottom with the compact card and gaps: ports top and bottom, a vertical curve', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(THREE, TB_COMPACT)} />)
    const options = graphDouble.last() as { edge: { type: string }; layout: unknown; node: { style: { ports: unknown; size: unknown } } }
    expect(options.layout).toEqual({ nodesep: 16, rankdir: 'TB', ranksep: 32, type: 'dagre' })
    expect(options.node.style.size).toEqual([180, 56])
    expect(options.node.style.ports).toEqual([{ placement: 'top' }, { placement: 'bottom' }])
    expect(options.edge.type).toBe('cubic-vertical')
  })

  it('direction and density are independent: TB alone keeps the regular card, compact alone stays LR', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(THREE, { direction: 'TB' })} />)
    const tb = graphDouble.last() as { layout: unknown; node: { style: { size: unknown } } }
    expect(tb.layout).toEqual({ nodesep: 32, rankdir: 'TB', ranksep: 160, type: 'dagre' })
    expect(tb.node.style.size).toEqual([240, 84])
    cleanup()
    graphDouble.reset()
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(THREE, { density: 'compact' })} />)
    const compact = graphDouble.last() as { edge: { type: string }; layout: unknown; node: { style: { size: unknown } } }
    expect(compact.layout).toEqual({ nodesep: 16, rankdir: 'LR', ranksep: 32, type: 'dagre' })
    expect(compact.node.style.size).toEqual([180, 56])
    expect(compact.edge.type).toBe('cubic-horizontal')
  })

  it.each([
    ['three ranks', THREE],
    ['four ranks', FOUR],
    ['four ranks fanning out to two', FAN_OUT_TWO],
  ])('%s fit a 415px box: no fade on either edge', (_name, data) => {
    sizeTheBox(415, 360)
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(data, TB_COMPACT)} />)
    expect(box().dataset.overflows).toBeUndefined()
    expect(box().dataset.overflowsBelow).toBeUndefined()
  })

  it('a fan-out of three is wider than the box: the right fade is the fallback, as in LR', () => {
    sizeTheBox(415, 360)
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(FAN_OUT_THREE, TB_COMPACT)} />)
    expect(box().dataset.overflows).toBe('true')
    expect(box().dataset.overflowsBelow).toBeUndefined()
  })

  it('a chain deeper than the box runs off the bottom, and says so', () => {
    // Six ranks: 6 × 56 + 5 × 32 = 496px in a 360px box.
    const deep = ['a', 'b', 'c', 'd', 'e', 'f'].map((uid, index, all) => service(uid, '1 span', index ? [all[index - 1]] : []))
    sizeTheBox(415, 360)
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(deep, TB_COMPACT)} />)
    expect(box().dataset.overflows).toBeUndefined()
    expect(box().dataset.overflowsBelow).toBe('true')
  })

  it('CONTROL: the same three services LR regular overflow the same box, exactly as today', () => {
    sizeTheBox(415, 360)
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(THREE, { density: 'regular', direction: 'LR' })} />)
    expect(box().dataset.overflows).toBe('true')
    // LR never measured its height, and still does not.
    expect(box().dataset.overflowsBelow).toBeUndefined()
  })

  it('LR measures no height even when its broadest column is taller than the box', () => {
    // Five siblings in one column: 5 × 84 + 4 × 32 = 548px, in a box wide enough for the two ranks.
    const tall = [service('root', '1 span'), ...['a', 'b', 'c', 'd', 'e'].map((uid) => service(uid, '1 span', ['root']))]
    sizeTheBox(1200, 360)
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(tall)} />)
    expect(box().dataset.overflows).toBeUndefined()
    expect(box().dataset.overflowsBelow).toBeUndefined()
  })
})

describe('the compact card', () => {
  /** The card for one node, found by its accessible name — "kind name, state, …". */
  const card = (kind: string, name: string): HTMLElement => screen.getByRole('group', { name: new RegExp(`^${kind} ${name},`) })

  it('shows the name and the detail line, no kind line, and keeps the kind in the accessible name', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(THREE, TB_COMPACT)} />)
    const gateway = card('Service', 'krateo-agent-gateway-platform')
    expect(gateway.dataset.density).toBe('compact')
    expect(gateway.getAttribute('aria-label')).toBe('Service krateo-agent-gateway-platform, done')
    expect(within(gateway).getByText('krateo-agent-gateway-platform')).toBeTruthy()
    expect(within(gateway).getByText('2 spans')).toBeTruthy()
    expect(within(gateway).queryByText('Service')).toBeNull()
    expect(gateway.children).toHaveLength(2)
  })

  it('puts the kind and the full names in the name\'s tooltip', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(THREE, TB_COMPACT)} />)
    const name = within(card('Service', 'snowplow')).getByText('snowplow')
    expect(name.getAttribute('title')).toBe('Service\nsnowplow')
  })

  it('draws an exception as the dot alone, and keeps the condition in the accessible name', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(V1B, TB_COMPACT)} />)
    const markers = screen.getAllByTestId('architecture-exception')
    expect(markers).toHaveLength(1)
    const repo = card('Repo', 'publish-pod-sizing-v1b-source')
    expect(within(repo).getByTestId('architecture-exception')).toBe(markers[0])
    expect(markers[0].textContent).toBe('')
    expect(markers[0].querySelector('[class*="dot"]')?.getAttribute('aria-hidden')).toBe('true')
    expect(repo.getAttribute('aria-label')).toMatch(/^Repo publish-pod-sizing-v1b-source, waiting, NotSynced: ReconcileError — /)
  })

  it('keeps every state the regular card has', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={architecture(V1B, TB_COMPACT)} />)
    expect(screen.getAllByRole('group').map((each) => each.dataset.state)).toEqual(['done', 'waiting', 'withheld', 'withheld'])
  })
})

describe('the resource variant ignores both fields', () => {
  // The resource card's antd Avatar reads breakpoints on mount; jsdom has no matchMedia.
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      addEventListener: vi.fn(), addListener: vi.fn(), matches: false, media, removeEventListener: vi.fn(), removeListener: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const RESOURCE = {
    data: [
      { kind: 'Deployment', name: 'web', parentRefs: [], uid: 'a' },
      { kind: 'Service', name: 'svc', parentRefs: [{ uid: 'a' }], uid: 'b' },
    ],
  }

  it('hands G6 the same options with or without them', () => {
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={RESOURCE as unknown as FlowChartWidgetData} />)
    const before = serialise(graphDouble.last() as Record<string, unknown>)
    cleanup()
    graphDouble.reset()
    render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={{ ...RESOURCE, ...TB_COMPACT } as unknown as FlowChartWidgetData} />)
    expect(serialise(graphDouble.last() as Record<string, unknown>)).toBe(before)
  })
})
