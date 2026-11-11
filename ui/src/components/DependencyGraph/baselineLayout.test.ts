/**
 * "ONE BASELINE, ARCS ABOVE" — the layout's rules, each on the smallest graph that shows it, and the
 * graphs the portal draws: builder-publish's chain, a fan-out of twelve, a single node.
 *
 * The geometry is the architecture card's (220×84) with C19's gaps (160 between ranks, 32 between
 * rows). Edge paths are SAMPLED — every Bézier at 64 points — and each point checked against every
 * card the edge does not connect: "never through a card" is a statement about every point drawn.
 */
import { describe, expect, it } from 'vitest'

import {
  BASELINE_ARC_STEP,
  BASELINE_ARC_STROKE,
  baselineLayout,
  baselineRoute,
  baselineStructure,
  type BaselineEdgeInput,
  type BaselinePathCommand,
  type BaselinePlacement,
} from './baselineLayout'
import { buildGraphOptions, type GraphEdge, type GraphNode } from './graphConfig'

const CARD: [number, number] = [220, 84]
const GEOMETRY = { nodeSize: CARD, rankGap: 160, rowGap: 32 }
const TOP = -CARD[1] / 2

const nodes = (...ids: string[]) => ids.map((id) => ({ id }))
const edge = (source: string, target: string): BaselineEdgeInput => ({ id: `${source}→${target}`, source, target })
const lay = (ids: string[], edges: BaselineEdgeInput[]) => baselineLayout(nodes(...ids), edges, GEOMETRY)

/** Every point a path draws, 64 per segment. */
const sample = (path: BaselinePathCommand[]): [number, number][] => {
  const points: [number, number][] = []
  let at: [number, number] = [0, 0]
  for (const command of path) {
    if (command[0] === 'M') {
      at = [command[1], command[2]]
      points.push(at)
    } else if (command[0] === 'L') {
      const [, x, y] = command
      for (let step = 1; step <= 64; step += 1) {
        const along = step / 64
        points.push([at[0] + (x - at[0]) * along, at[1] + (y - at[1]) * along])
      }
      at = [x, y]
    } else {
      const [, x1, y1, x2, y2, x, y] = command
      for (let step = 1; step <= 64; step += 1) {
        const along = step / 64
        const rest = 1 - along
        points.push([
          rest ** 3 * at[0] + 3 * rest ** 2 * along * x1 + 3 * rest * along ** 2 * x2 + along ** 3 * x,
          rest ** 3 * at[1] + 3 * rest ** 2 * along * y1 + 3 * rest * along ** 2 * y2 + along ** 3 * y,
        ])
      }
      at = [x, y]
    }
  }
  return points
}

/** A point inside a card's box (its border included, by `margin`). */
const insideCard = ([px, py]: [number, number], [cx, cy]: [number, number], margin = 1): boolean =>
  Math.abs(px - cx) < CARD[0] / 2 + margin && Math.abs(py - cy) < CARD[1] / 2 + margin

/** Each edge, and every card it passes through that is neither of its ends. */
const crossings = (placement: BaselinePlacement, edges: BaselineEdgeInput[]): string[] =>
  edges.flatMap((each) => {
    const key = each.id ?? `${each.source}-${each.target}`
    const points = sample(placement.paths[key])
    return Object.entries(placement.positions)
      .filter(([id]) => id !== each.source && id !== each.target)
      .filter(([, centre]) => points.some((point) => insideCard(point, centre)))
      .map(([id]) => `${key} through ${id}`)
  })

// builder-publish (V1B): Repository → Repo → LocalResource ×10 → PullRequest, and Repository →
// LocalResource, the skip edge that drew through the Repo.
const BUILDER_PUBLISH = {
  edges: [edge('repository', 'repo'), edge('repository', 'localresources'), edge('repo', 'localresources'), edge('localresources', 'pullrequest')],
  ids: ['repository', 'repo', 'localresources', 'pullrequest'],
}

describe('builder-publish: one baseline, the skip edge arcs above', () => {
  const placed = lay(BUILDER_PUBLISH.ids, BUILDER_PUBLISH.edges)

  it('the main chain is all four, and every one of them is on y = 0', () => {
    expect(placed.structure.chain).toEqual(['repository', 'repo', 'localresources', 'pullrequest'])
    expect(Object.values(placed.positions).map(([, y]) => y)).toEqual([0, 0, 0, 0])
    expect(Object.values(placed.positions).map(([x]) => x)).toEqual([0, 380, 760, 1140])
  })

  it('neighbouring ranks are straight; the skip edge is an arc, flagged and drawn above the row', () => {
    const route = Object.fromEntries(placed.structure.edges.map(({ key, route }) => [key, route]))
    expect(route).toEqual({
      'localresources→pullrequest': 'straight',
      'repository→localresources': 'arc',
      'repository→repo': 'straight',
      'repo→localresources': 'straight',
    })
    for (const key of ['repository→repo', 'repo→localresources', 'localresources→pullrequest']) {
      // Port to port: the right side of one card to the left side of the next, at the row's centre.
      expect(sample(placed.paths[key]).every(([, y]) => y === 0)).toBe(true)
    }
    const arc = sample(placed.paths['repository→localresources'])
    expect(arc.every(([, y]) => y <= TOP)).toBe(true)
    expect(Math.min(...arc.map(([, y]) => y))).toBeCloseTo(TOP - BASELINE_ARC_STEP, 0)
  })

  it('no edge passes through a card it does not connect — the arc clears the Repo by its whole rise', () => {
    expect(crossings(placed, BUILDER_PUBLISH.edges)).toEqual([])
    const overRepo = sample(placed.paths['repository→localresources']).filter(([x]) => Math.abs(x - 380) <= 110)
    expect(Math.max(...overRepo.map(([, y]) => y))).toBeLessThan(TOP - 16)
  })

  it('is as tall as the row plus one arc of headroom: 4 × 220 + 3 × 160 wide', () => {
    expect(placed.size).toEqual([1360, BASELINE_ARC_STEP + BASELINE_ARC_STROKE + 84])
    expect(placed.origin).toEqual([-110, TOP - BASELINE_ARC_STEP - BASELINE_ARC_STROKE])
  })

  it('is deterministic, whatever order the edges arrive in', () => {
    const reversed = lay(BUILDER_PUBLISH.ids, [...BUILDER_PUBLISH.edges].reverse())
    expect(reversed.positions).toEqual(placed.positions)
    expect(reversed.paths).toEqual(placed.paths)
    expect(lay(BUILDER_PUBLISH.ids, BUILDER_PUBLISH.edges)).toEqual(placed)
  })

  it('CONTROL: the sampler sees a crossing — the same skip edge drawn port to port runs through the Repo', () => {
    const straight = { ...placed, paths: { ...placed.paths, 'repository→localresources': [['M', 110, 0], ['L', 650, 0]] as BaselinePathCommand[] } }
    expect(crossings(straight, BUILDER_PUBLISH.edges)).toEqual(['repository→localresources through repo'])
  })
})

describe('the main chain', () => {
  it('is the LONGEST path, not the first one in the data', () => {
    // a → b is a dead end; a → c → d is the chain.
    const { structure } = lay(['a', 'b', 'c', 'd'], [edge('a', 'b'), edge('a', 'c'), edge('c', 'd')])
    expect(structure.chain).toEqual(['a', 'c', 'd'])
    expect(structure.rows).toEqual({ a: 0, b: 1, c: 0, d: 0 })
  })

  it('a tie goes to the data order: the earliest deepest node, then the earliest parent', () => {
    const ties = [edge('a', 'b'), edge('b', 'c'), edge('a', 'x'), edge('x', 'y')]
    expect(lay(['a', 'b', 'c', 'x', 'y'], ties).structure.chain).toEqual(['a', 'b', 'c'])
    expect(lay(['a', 'x', 'y', 'b', 'c'], ties).structure.chain).toEqual(['a', 'x', 'y'])
    // Two parents one rank up: the earlier in the data.
    const join = [edge('p', 'z'), edge('q', 'z')]
    expect(lay(['q', 'p', 'z'], join).structure.chain).toEqual(['q', 'z'])
  })

  it('a cycle in malformed data does not hang, and is broken in data order: the closing edge is drawn back', () => {
    const cycle = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]
    const { paths, positions, structure } = lay(['a', 'b', 'c'], cycle)
    expect(structure.ranks).toEqual({ a: 0, b: 1, c: 2 })
    expect(structure.chain).toEqual(['a', 'b', 'c'])
    const closing = structure.edges.find(({ key }) => key === 'c→a')!
    expect([closing.back, closing.route]).toEqual([true, 'arc'])
    expect(sample(paths['c→a']).every(([, y]) => y <= TOP)).toBe(true)
    expect(Object.values(positions).map(([, y]) => y)).toEqual([0, 0, 0])
  })

  it('…and a two-node cycle, a self-reference and an edge to nowhere are each drawn or dropped, never thrown on', () => {
    const odd = [edge('a', 'b'), edge('b', 'a'), edge('b', 'b'), edge('b', 'ghost')]
    const { structure } = lay(['a', 'b'], odd)
    expect(structure.chain).toEqual(['a', 'b'])
    expect(structure.edges.map(({ back, key, route }) => [key, route, back])).toEqual([['a→b', 'straight', false], ['b→a', 'arc', true]])
  })

  it('an empty graph is nothing, 0 × 0', () => {
    const empty = lay([], [])
    expect([empty.structure.chain, empty.size, empty.structure.shape]).toEqual([[], [0, 0], { arcLevels: 0, ranks: 0, rows: 0 }])
  })
})

describe('branches stack below the baseline', () => {
  it('a diamond: the second child sits under the first, and both its edges stay in the gaps', () => {
    const diamond = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')]
    const placed = lay(['a', 'b', 'c', 'd'], diamond)
    expect(placed.structure.chain).toEqual(['a', 'b', 'd'])
    expect(placed.positions).toEqual({ a: [0, 0], b: [380, 0], c: [380, 116], d: [760, 0] })
    expect(placed.structure.edges.map(({ route }) => route)).toEqual(['straight', 'curve', 'straight', 'curve'])
    expect(crossings(placed, diamond)).toEqual([])
    expect(placed.size).toEqual([3 * 220 + 2 * 160, 2 * 84 + 32])
  })

  it('a fan-out of twelve (/agents): the first child continues the line, the other eleven stack under it in data order', () => {
    const children = Array.from({ length: 12 }, (_, index) => `agent-${String(index + 1).padStart(2, '0')}`)
    const fan = children.map((child) => edge('portal', child))
    const placed = lay(['portal', ...children], fan)
    expect(placed.structure.chain).toEqual(['portal', 'agent-01'])
    expect(children.map((child) => placed.structure.rows[child])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(children.every((child) => placed.positions[child][0] === 380)).toBe(true)
    expect(placed.structure.edges.every(({ route }, index) => route === (index === 0 ? 'straight' : 'curve'))).toBe(true)
    expect(crossings(placed, fan)).toEqual([])
    expect(placed.size).toEqual([600, 12 * 84 + 11 * 32])
  })

  it('branches in one rank are ordered by their parents\' rows, then by the data', () => {
    // x hangs off the second branch row, y off the baseline: y's row comes first under the next rank.
    const graph = [edge('a', 'b'), edge('b', 'c'), edge('a', 'p'), edge('a', 'q'), edge('q', 'x'), edge('b', 'y')]
    const { rows } = lay(['a', 'b', 'c', 'p', 'q', 'x', 'y'], graph).structure
    expect(rows).toEqual({ a: 0, b: 0, c: 0, p: 1, q: 2, x: 2, y: 1 })
  })

  it('a single node is one card at the origin', () => {
    const placed = lay(['only'], [])
    expect([placed.positions, placed.size, placed.paths]).toEqual([{ only: [0, 0] }, CARD, {}])
  })
})

describe('arcs nest by span', () => {
  // A five-rank chain with three skip edges: a → c inside a → e, and b → d interleaved with a → c.
  const chain = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('d', 'e')]
  const skips = [edge('a', 'e'), edge('a', 'c'), edge('b', 'd')]
  const placed = lay(['a', 'b', 'c', 'd', 'e'], [...chain, ...skips])
  const level = (key: string) => placed.structure.edges.find((each) => each.key === key)!.level

  it('each arc one level above every shorter arc it overlaps', () => {
    expect([level('a→c'), level('b→d'), level('a→e')]).toEqual([1, 2, 3])
    expect(placed.structure.shape).toEqual({ arcLevels: 3, ranks: 5, rows: 1 })
    expect(placed.size[1]).toBe(3 * BASELINE_ARC_STEP + BASELINE_ARC_STROKE + 84)
  })

  it('an arc that shares only an end rank with another takes the same level', () => {
    const touching = lay(['a', 'b', 'c', 'd', 'e'], [...chain, edge('a', 'c'), edge('c', 'e')])
    expect(touching.structure.edges.filter(({ route }) => route === 'arc').map(({ level: at }) => at)).toEqual([1, 1])
    expect(crossings(touching, [...chain, edge('a', 'c'), edge('c', 'e')])).toEqual([])
  })

  it('the outer arc is above the inner one everywhere the inner one runs — nested arcs never meet', () => {
    const inner = sample(placed.paths['a→c'])
    const outer = sample(placed.paths['a→e'])
    const outerAt = (x: number): number => {
      const nearest = outer.reduce((best, point) => (Math.abs(point[0] - x) < Math.abs(best[0] - x) ? point : best))
      return nearest[1]
    }
    for (const [x, y] of inner.slice(1, -1)) {
      expect(outerAt(x)).toBeLessThan(y)
    }
    // At their shared card the outer one leaves left of the inner one.
    expect(placed.paths['a→e'][0][1]).toBeLessThan(placed.paths['a→c'][0][1])
  })

  it('every arc stays above the row and out of every card it does not connect', () => {
    for (const key of ['a→c', 'b→d', 'a→e']) {
      expect(sample(placed.paths[key]).every(([, y]) => y <= TOP)).toBe(true)
    }
    expect(crossings(placed, [...chain, ...skips])).toEqual([])
  })
})

describe('a skip edge from a branch takes a lane', () => {
  it('through the first row free in every rank it passes, and so through no card', () => {
    // x is a branch at rank 1; x → d skips rank 2, where row 1 is free.
    const graph = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('a', 'x'), edge('x', 'd')]
    const placed = lay(['a', 'b', 'c', 'd', 'x'], graph)
    const lane = placed.structure.edges.find(({ key }) => key === 'x→d')!
    expect([lane.route, lane.lane]).toEqual(['lane', 1])
    expect(crossings(placed, graph)).toEqual([])
  })

  it('…and past a row a card already holds', () => {
    // y takes row 1 at rank 2, so x → d runs along row 2 there.
    const graph = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('a', 'x'), edge('x', 'd'), edge('b', 'y')]
    const placed = lay(['a', 'b', 'c', 'd', 'x', 'y'], graph)
    expect(placed.structure.rows.y).toBe(1)
    expect(placed.structure.edges.find(({ key }) => key === 'x→d')!.lane).toBe(2)
    expect(placed.structure.shape.rows).toBe(3)
    expect(crossings(placed, graph)).toEqual([])
  })

  it('CONTROL: the same edge drawn straight to its target passes through the card in its way', () => {
    const graph = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('a', 'x'), edge('x', 'd'), edge('b', 'y')]
    const placed = lay(['a', 'b', 'c', 'd', 'x', 'y'], graph)
    const [xx, xy] = placed.positions.x
    const [dx, dy] = placed.positions.d
    const direct = { ...placed, paths: { ...placed.paths, 'x→d': [['M', xx + 110, xy], ['C', (xx + dx) / 2, xy, (xx + dx) / 2, dy, dx - 110, dy]] as BaselinePathCommand[] } }
    expect(crossings(direct, graph)).not.toEqual([])
  })
})

describe('DependencyGraph\'s options for it', () => {
  const NODES: GraphNode<object>[] = BUILDER_PUBLISH.ids.map((id) => ({ data: {}, id }))
  const EDGES = BUILDER_PUBLISH.edges as GraphEdge<object>[]
  const options = (arrangement?: 'baseline' | 'layered', direction?: 'LR' | 'TB') =>
    buildGraphOptions({ arrangement, direction, edges: EDGES, nodeSize: CARD, nodes: NODES, palette: null, renderNode: () => null })

  it('`baseline`: the baseline layout with every centre, and the edge that draws each computed path', () => {
    const { edge: edges, layout } = options('baseline') as unknown as { edge: { style: { route: (datum: unknown) => unknown }; type: string }; layout: Record<string, unknown> }
    expect(layout).toEqual({ nodesep: 32, positions: lay(BUILDER_PUBLISH.ids, BUILDER_PUBLISH.edges).positions, ranksep: 160, type: 'baseline' })
    expect(edges.type).toBe('baseline-route')
    expect(edges.style.route(EDGES[1])).toEqual(lay(BUILDER_PUBLISH.ids, BUILDER_PUBLISH.edges).paths['repository→localresources'])
  })

  it('absent, or with TB, it is dagre exactly as before', () => {
    // The layout and the edge mapping; the node's `component` is a new closure on every call.
    const drawn = (...args: Parameters<typeof options>) => {
      const { edge: edges, layout } = options(...args)
      return { edges, layout }
    }
    expect(drawn()).toEqual(drawn('layered'))
    expect(drawn().layout).toEqual({ nodesep: 32, rankdir: 'LR', ranksep: 160, type: 'dagre' })
    expect(drawn().edges).toEqual({ style: { router: false }, type: 'cubic-horizontal' })
    expect(drawn('baseline', 'TB')).toEqual(drawn('layered', 'TB'))
  })

  it('an edge G6 holds without an id is found by the name G6 gives it', () => {
    const route = baselineRoute({ 'p-q': [['M', 0, 0]] })
    expect(route({ source: 'p', target: 'q' })).toEqual([['M', 0, 0]])
    expect(route({ id: 7, source: 'p', target: 'q' })).toBeUndefined()
  })

  it('the structure alone (no geometry) is what the fit reads', () => {
    expect(baselineStructure(nodes(...BUILDER_PUBLISH.ids), BUILDER_PUBLISH.edges).shape).toEqual({ arcLevels: 1, ranks: 4, rows: 1 })
  })
})
