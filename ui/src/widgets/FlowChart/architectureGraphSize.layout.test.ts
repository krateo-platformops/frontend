/**
 * THE MEASUREMENT AGAINST THE REAL LAYOUT. `architectureGraphSize` decides whether the overflow fade
 * is painted; it is arithmetic over ranks. Here the same graphs go through the class G6 registers as
 * `dagre` (@antv/layout's DagreLayout, dagre@0.8.5 underneath), with the options DependencyGraph
 * passes (`graphLayout` with the variant's direction and gaps), and the cards' real bounding box is
 * compared with the arithmetic. No canvas is needed: the class computes positions only (see
 * pages/BlueprintBuilder/architectureGraph.layout.test.ts for the same technique).
 *
 * What this cannot prove: pixels on a screen. G6 adds the viewport and the React node roots on top.
 */
import { G6 } from '@ant-design/graphs'
import { describe, expect, it } from 'vitest'

import { graphLayout, type GraphDirection, type GraphEdge } from '../../components/DependencyGraph'

import { ARCHITECTURE_DENSITY, architectureGraphSize, architectureGraphWidth, type ArchitectureDensity } from './architectureVariant'

/** The box the trace page gives its services diagram: the right column, ~415px wide, 360px tall. */
const BOX: [number, number] = [415, 360]

/** dagre's real [width, height] for the cards' bounding box. */
const dagreSize = async (ids: string[], edges: GraphEdge<unknown>[], direction: GraphDirection, density: ArchitectureDensity): Promise<[number, number]> => {
  const { nodeSize, spacing } = ARCHITECTURE_DENSITY[density]
  const { type: _type, ...options } = graphLayout(edges, { direction, spacing }) as Record<string, unknown>
  const layout = new G6.DagreLayout({ ...options, nodeSize })
  await layout.execute({ edges, nodes: ids.map((id) => ({ id })) })
  const xs: number[] = []
  const ys: number[] = []
  layout.forEachNode((node) => {
    xs.push(Number(node.x))
    ys.push(Number(node.y))
  })
  return [Math.max(...xs) - Math.min(...xs) + nodeSize[0], Math.max(...ys) - Math.min(...ys) + nodeSize[1]]
}

const measured = (ids: string[], edges: GraphEdge<unknown>[], direction: GraphDirection, density: ArchitectureDensity): [number, number] => {
  const { nodeSize, spacing } = ARCHITECTURE_DENSITY[density]
  return architectureGraphSize(ids.map((id) => ({ id })), edges, {
    direction,
    nodeSize,
    // regular is C19's gaps, which graphLayout fills in when spacing is absent.
    spacing: spacing ?? { nodesep: 32, ranksep: 160 },
  })
}

const edge = (source: string, target: string): GraphEdge<unknown> => ({ id: `${source}→${target}`, source, target })

// Service paths as the trace page draws them: one node per service, an edge per caller → callee.
const THREE = {
  edges: [edge('krateo-frontend', 'krateo-agent-gateway-platform'), edge('krateo-agent-gateway-platform', 'snowplow')],
  ids: ['krateo-frontend', 'krateo-agent-gateway-platform', 'snowplow'],
}
const FOUR = {
  edges: [edge('krateo-frontend', 'krateo-agent-gateway-platform'), edge('krateo-agent-gateway-platform', 'agentiko'), edge('agentiko', 'k8s-agent')],
  ids: ['krateo-frontend', 'krateo-agent-gateway-platform', 'agentiko', 'k8s-agent'],
}
const FAN_OUT_TWO = {
  edges: [...FOUR.edges, edge('agentiko', 'model')],
  ids: [...FOUR.ids, 'model'],
}
const FAN_OUT_THREE = {
  edges: [...FAN_OUT_TWO.edges, edge('agentiko', 'clickhouse-mcp')],
  ids: [...FAN_OUT_TWO.ids, 'clickhouse-mcp'],
}

describe('architectureGraphSize is where dagre puts the cards', () => {
  it.each([
    ['three ranks', THREE],
    ['four ranks', FOUR],
    ['four ranks fanning out to two', FAN_OUT_TWO],
    ['four ranks fanning out to three', FAN_OUT_THREE],
  ])('TB compact, %s', async (_name, { edges, ids }) => {
    expect(measured(ids, edges, 'TB', 'compact')).toEqual(await dagreSize(ids, edges, 'TB', 'compact'))
  })

  it.each([
    ['a diamond', { edges: [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')], ids: ['a', 'b', 'c', 'd'] }],
    ['two roots into one', { edges: [edge('r1', 'c'), edge('r2', 'c')], ids: ['r1', 'r2', 'c'] }],
    ['no edges at all', { edges: [], ids: ['a', 'b', 'c'] }],
  ])('TB compact, %s', async (_name, { edges, ids }) => {
    expect(measured(ids, edges, 'TB', 'compact')).toEqual(await dagreSize(ids, edges, 'TB', 'compact'))
  })

  it('KNOWN GAP: an edge that skips a rank takes a lane there, so dagre is wider than the estimate', async () => {
    // frontend calls snowplow directly and through the gateway. dagre routes the direct edge through
    // the gateway's row and widens it by 51.5px; the estimate counts cards only. Pinned so the gap is
    // seen, not discovered: here it is still far inside the 415px box.
    const ids = ['krateo-frontend', 'krateo-agent-gateway-platform', 'snowplow']
    const edges = [...THREE.edges, edge('krateo-frontend', 'snowplow')]
    expect(measured(ids, edges, 'TB', 'compact')).toEqual([180, 232])
    expect(await dagreSize(ids, edges, 'TB', 'compact')).toEqual([231.5, 232])
  })

  it.each([
    ['three ranks', THREE],
    ['four ranks fanning out to two', FAN_OUT_TWO],
  ])('LR regular (the composition page), %s — width as main measured it', async (_name, { edges, ids }) => {
    const [width] = await dagreSize(ids, edges, 'LR', 'regular')
    expect(architectureGraphWidth(ids.map((id) => ({ id })), edges)).toBe(width)
    expect(measured(ids, edges, 'LR', 'regular')[0]).toBe(width)
  })
})

describe('the trace page\'s services diagram in its 415×360 box', () => {
  const fits = ([width, height]: [number, number]) => width <= BOX[0] && height <= BOX[1]

  it('three ranks fit, TB compact: one card wide', () => {
    expect(measured(THREE.ids, THREE.edges, 'TB', 'compact')).toEqual([180, 3 * 56 + 2 * 32])
    expect(fits(measured(THREE.ids, THREE.edges, 'TB', 'compact'))).toBe(true)
  })

  it('four ranks fit, TB compact', () => {
    expect(measured(FOUR.ids, FOUR.edges, 'TB', 'compact')).toEqual([180, 4 * 56 + 3 * 32])
    expect(fits(measured(FOUR.ids, FOUR.edges, 'TB', 'compact'))).toBe(true)
  })

  it('a fan-out of two fits, TB compact: two cards and one gap wide', () => {
    expect(measured(FAN_OUT_TWO.ids, FAN_OUT_TWO.edges, 'TB', 'compact')).toEqual([2 * 180 + 16, 320])
    expect(fits(measured(FAN_OUT_TWO.ids, FAN_OUT_TWO.edges, 'TB', 'compact'))).toBe(true)
  })

  it('a fan-out of three does not, and the fallback (fade, drag, Tab) is what is left', () => {
    expect(measured(FAN_OUT_THREE.ids, FAN_OUT_THREE.edges, 'TB', 'compact')[0]).toBe(3 * 180 + 2 * 16)
    expect(fits(measured(FAN_OUT_THREE.ids, FAN_OUT_THREE.edges, 'TB', 'compact'))).toBe(false)
  })

  it('CONTROL: the same three services LR regular overflow, as on the page today', () => {
    // 3 × 220 + 2 × 160: only the first card is in view.
    expect(architectureGraphWidth(THREE.ids.map((id) => ({ id })), THREE.edges)).toBe(980)
    expect(fits(measured(THREE.ids, THREE.edges, 'LR', 'regular'))).toBe(false)
  })
})
