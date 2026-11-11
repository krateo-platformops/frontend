/**
 * "ONE BASELINE, ARCS ABOVE" — a left-to-right layout in which the graph's main chain is one straight
 * row, computed here, deterministically, instead of by dagre.
 *
 * WHAT IT DRAWS:
 *   - The MAIN CHAIN — the longest path in dependency order — on one horizontal line (row 0).
 *   - An edge between neighbouring ranks of that line is a straight segment, port to port.
 *   - An edge between two chain nodes that SKIPS one or more ranks is an arc ABOVE the row, from the
 *     top of one card to the top of the other. Arcs nest by span: one that overlaps another is drawn
 *     higher, so no two overlapping arcs share a height, and each lands on its card's top at its own
 *     slot, ordered so nested arcs do not cross where they meet a card.
 *   - Every other node (a second child of the same parent, a fan-out, a second root) is a BRANCH:
 *     stacked BELOW the line in its rank, rows 1, 2, … in a stable order.
 *   - An edge between neighbouring ranks with a branch at either end is a horizontal S-curve inside
 *     the gap between the two columns, where there is never a card.
 *   - An edge that skips ranks with a branch at either end takes a LANE: a row that is free in every
 *     rank it passes, reserved for it the way dagre reserves a dummy node, so it runs between cards
 *     and never through one.
 *
 * WHY NOT DAGRE. Measured against the dagre G6 runs (dagre 0.8.5 via @antv/layout), on the LR
 * options DependencyGraph passes, for each `align` (none, UL, UR, DL, DR) × each ranker
 * (network-simplex, tight-tree, longest-path) × edge weights 10 on the chain and 1 elsewhere:
 *   - builder-publish (Repository → Repo → LocalResource → PullRequest, and Repository →
 *     LocalResource): with no align, Repo sits 32px under the others, as the page shows; only UR and
 *     DR put the four on one line. Weights change nothing: Brandes-Köpf, dagre's x-coordinate step,
 *     does not read them.
 *   - a chain with two skip edges and a branch: only UL keeps the chain on one line.
 *   - a parent with three children, the last of which continues the chain: none of the four does.
 * No single setting guarantees the baseline, so the positions are computed here. And none of them
 * draws a skip edge as an arc: G6's edge is drawn port to port, so on a straight line the skip edge
 * Repository → LocalResource ran through the Repo card. The edge paths are computed here too.
 *
 * Pure (no G6, no DOM), so every rule is a unit test; DependencyGraph hands the positions to G6 as a
 * layout of its own (`baselineG6.ts`) and the paths to an edge that draws exactly them.
 */

/** A node and an edge as the layout reads them: ids only. An edge's key is its id, as G6 names it. */
export interface BaselineNodeInput { id: string }
export interface BaselineEdgeInput { id?: string; source: string; target: string }

/** How an edge is drawn (see the header). */
export type BaselineRoute = 'arc' | 'curve' | 'lane' | 'straight'

/** Where an arc meets a card's top: its slot among the `count` arcs that meet that card. */
export interface BaselineSlot { count: number; index: number }

export interface BaselineEdge {
  key: string
  source: string
  target: string
  route: BaselineRoute
  /** An edge against the dependency order (a cycle in malformed data): drawn right to left. */
  back: boolean
  /** `arc`: its nesting level, 1 the lowest. */
  level?: number
  /** `arc`: its slot on the source's top and on the target's. */
  slots?: { source: BaselineSlot; target: BaselineSlot }
  /** `lane`: the row it runs along through the ranks it passes, if it passes any. */
  lane?: number
}

/** All the size depends on besides the geometry: ranks along, rows across, and arc levels above. */
export interface BaselineShape {
  arcLevels: number
  ranks: number
  rows: number
}

export interface BaselineStructure {
  /** The main chain, first rank to last. */
  chain: string[]
  edges: BaselineEdge[]
  ranks: Record<string, number>
  rows: Record<string, number>
  shape: BaselineShape
}

/** An edge's key: its id, or the name G6 gives an edge without one. */
export const baselineEdgeKey = ({ id, source, target }: BaselineEdgeInput): string => id ?? `${source}-${target}`

/** The G6 layout the positions are handed to, and the G6 edge that draws the paths (baselineG6.ts). */
export const BASELINE_LAYOUT = 'baseline'
export const BASELINE_EDGE = 'baseline-route'

/**
 * The topology: ranks, the main chain, rows, and each edge's route. Geometry-free, so the drawn size
 * can be computed for any card and gap without laying the graph out again.
 */
export const baselineStructure = (
  nodeList: readonly BaselineNodeInput[],
  edgeList: readonly BaselineEdgeInput[],
): BaselineStructure => {
  const order = new Map<string, number>()
  for (const { id } of nodeList) {
    if (!order.has(id)) { order.set(id, order.size) }
  }
  const ids = [...order.keys()]
  const byOrder = (first: string, second: string): number => order.get(first)! - order.get(second)!

  // The edges that can be drawn: both ends known, not a self-reference, the first of each key.
  const keyed = new Map<string, { key: string; source: string; target: string }>()
  for (const edge of edgeList) {
    const key = baselineEdgeKey(edge)
    if (edge.source !== edge.target && order.has(edge.source) && order.has(edge.target) && !keyed.has(key)) {
      keyed.set(key, { key, source: edge.source, target: edge.target })
    }
  }
  const edges = [...keyed.values()]

  // CYCLES (malformed data only: a chart's descriptor is a DAG). A depth-first walk in data order,
  // children in edge order; an edge into a node still on the walk's stack is a back edge, kept out of
  // the ranking and drawn against the order. Iterative, so a long chain cannot overflow the stack.
  const out = new Map<string, typeof edges>(ids.map((id) => [id, []]))
  for (const edge of edges) { out.get(edge.source)!.push(edge) }
  const back = new Set<string>()
  const state = new Map<string, 'done' | 'open'>()
  for (const root of ids) {
    if (state.has(root)) { continue }
    const stack: { id: string; next: number }[] = [{ id: root, next: 0 }]
    state.set(root, 'open')
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const edge = out.get(frame.id)![frame.next]
      frame.next += 1
      if (!edge) {
        state.set(frame.id, 'done')
        stack.pop()
      } else if (state.get(edge.target) === 'open') {
        back.add(edge.key)
      } else if (!state.has(edge.target)) {
        state.set(edge.target, 'open')
        stack.push({ id: edge.target, next: 0 })
      }
    }
  }
  const forward = edges.filter(({ key }) => !back.has(key))

  // RANKS: the longest path from a root (what `level` means in a chart's descriptor), in topological
  // order — Kahn's, taking the earliest node in data order whenever several are ready.
  const parents = new Map<string, string[]>(ids.map((id) => [id, []]))
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]))
  for (const { source, target } of forward) {
    parents.get(target)!.push(source)
    indegree.set(target, indegree.get(target)! + 1)
  }
  const ranks: Record<string, number> = {}
  const ready = ids.filter((id) => indegree.get(id) === 0)
  while (ready.length > 0) {
    ready.sort(byOrder)
    const id = ready.shift()!
    ranks[id] = parents.get(id)!.reduce((deepest, parent) => Math.max(deepest, ranks[parent] + 1), 0)
    for (const { target } of out.get(id)!.filter(({ key }) => !back.has(key))) {
      indegree.set(target, indegree.get(target)! - 1)
      if (indegree.get(target) === 0) { ready.push(target) }
    }
  }

  // THE MAIN CHAIN: back from the earliest node of the deepest rank, each step to the earliest parent
  // one rank up — which exists, because that parent is what gave the node its rank.
  const chain: string[] = []
  if (ids.length > 0) {
    const deepest = Math.max(...ids.map((id) => ranks[id]))
    let at: string | undefined = ids.find((id) => ranks[id] === deepest)
    while (at !== undefined) {
      chain.unshift(at)
      const rank = ranks[at]
      at = rank === 0 ? undefined : [...parents.get(at)!].sort(byOrder).find((parent) => ranks[parent] === rank - 1)
    }
  }
  const onChain = new Set(chain)

  // ROWS: the chain is row 0. Each rank's branches stack under it, ordered by the highest row among
  // their parents (placed already: parents are in earlier ranks), then by data order.
  const rows: Record<string, number> = {}
  for (const id of chain) { rows[id] = 0 }
  const rankCount = chain.length
  const occupied: Set<number>[] = Array.from({ length: rankCount }, () => new Set([0]))
  for (let rank = 0; rank < rankCount; rank += 1) {
    const parentRow = (id: string): number => Math.min(Infinity, ...parents.get(id)!.map((parent) => rows[parent]))
    const branches = ids.filter((id) => ranks[id] === rank && !onChain.has(id))
      .sort((first, second) => parentRow(first) - parentRow(second) || byOrder(first, second))
    branches.forEach((id, index) => {
      rows[id] = index + 1
      occupied[rank].add(index + 1)
    })
  }

  // ROUTES. Spans count ranks, negative for a back edge.
  const span = ({ source, target }: { source: string; target: string }): number => ranks[target] - ranks[source]
  const routeOf = (edge: { key: string; source: string; target: string }): BaselineRoute => {
    const neighbours = Math.abs(span(edge)) === 1
    if (onChain.has(edge.source) && onChain.has(edge.target)) {
      return neighbours && !back.has(edge.key) ? 'straight' : 'arc'
    }
    return neighbours ? 'curve' : 'lane'
  }
  const routed: BaselineEdge[] = edges.map((edge) => {
    const route = routeOf(edge)
    return { back: back.has(edge.key), key: edge.key, route, source: edge.source, target: edge.target }
  })
  const lowHigh = (edge: BaselineEdge): [number, number] => {
    const [from, to] = [ranks[edge.source], ranks[edge.target]]
    return from < to ? [from, to] : [to, from]
  }
  const shortestFirst = (first: BaselineEdge, second: BaselineEdge): number => {
    const [firstLow, firstHigh] = lowHigh(first)
    const [secondLow, secondHigh] = lowHigh(second)
    return (firstHigh - firstLow) - (secondHigh - secondLow) || firstLow - secondLow || routed.indexOf(first) - routed.indexOf(second)
  }

  // LANES: the first row from 1 down that is free in every rank the edge passes; reserved, so the
  // next lane through those ranks takes another. Shortest spans first, so they keep the higher rows.
  for (const edge of routed.filter(({ route }) => route === 'lane').sort(shortestFirst)) {
    const [low, high] = lowHigh(edge)
    const passes = Array.from({ length: high - low - 1 }, (_, index) => low + 1 + index)
    const taken = new Set(passes.flatMap((rank) => [...occupied[rank]]))
    let lane = 1
    while (taken.has(lane)) { lane += 1 }
    for (const rank of passes) { occupied[rank].add(lane) }
    edge.lane = lane
  }

  // ARC LEVELS: shortest spans first; each one level above the highest arc already placed whose span
  // overlaps its own (sharing only an end rank is no overlap: they meet that card at different slots).
  const arcs = routed.filter(({ route }) => route === 'arc').sort(shortestFirst)
  for (const [index, edge] of arcs.entries()) {
    const [low, high] = lowHigh(edge)
    edge.level = 1 + arcs.slice(0, index).reduce((top, other) => {
      const [otherLow, otherHigh] = lowHigh(other)
      return low < otherHigh && otherLow < high ? Math.max(top, other.level!) : top
    }, 0)
  }

  // ARC SLOTS on each chain card's top, left to right: first the arcs whose other end is to the LEFT,
  // lowest first, then those to the RIGHT, highest first. So an arc always lands outside the arcs it
  // spans, and the arcs that leave a card start right of those that arrive at it: none cross there.
  const ends = new Map<string, { edge: BaselineEdge; end: 'source' | 'target'; left: boolean }[]>()
  for (const edge of arcs) {
    for (const end of ['source', 'target'] as const) {
      const here = edge[end]
      const other = end === 'source' ? edge.target : edge.source
      ends.set(here, [...(ends.get(here) ?? []), { edge, end, left: ranks[other] < ranks[here] }])
    }
  }
  for (const list of ends.values()) {
    const sorted = [
      ...list.filter(({ left }) => left).sort((first, second) => first.edge.level! - second.edge.level! || arcs.indexOf(first.edge) - arcs.indexOf(second.edge)),
      ...list.filter(({ left }) => !left).sort((first, second) => second.edge.level! - first.edge.level! || arcs.indexOf(first.edge) - arcs.indexOf(second.edge)),
    ]
    sorted.forEach(({ edge, end }, index) => {
      const slot = { count: sorted.length, index }
      edge.slots = { ...(edge.slots ?? { source: slot, target: slot }), [end]: slot }
    })
  }

  const rowCount = 1 + Math.max(0, ...occupied.flatMap((set) => [...set]), ...routed.map(({ lane }) => lane ?? 0))
  return {
    chain,
    edges: routed,
    ranks,
    rows,
    shape: {
      arcLevels: Math.max(0, ...arcs.map(({ level }) => level!)),
      ranks: rankCount,
      rows: ids.length === 0 ? 0 : rowCount,
    },
  }
}

/** The card's box and the gaps: between ranks (columns) and between rows. */
export interface BaselineGeometry {
  nodeSize: [number, number]
  rankGap: number
  rowGap: number
}

/** How far each arc level rises above the cards' top, px: the lowest arc's peak is this far above it. */
export const BASELINE_ARC_STEP = 24

/** Room kept above the highest arc's peak for the stroke, px — so G6's bounds equal the computed size. */
export const BASELINE_ARC_STROKE = 2

/** The furthest apart two arc slots on one card's top are, px. */
export const BASELINE_SLOT_GAP = 16

/**
 * The drawn [width, height] for a shape, px — the same arithmetic `baselinePlacement` lays out:
 * `ranks × card + (ranks − 1) × rankGap` wide, and as tall as its rows plus the arcs' headroom.
 */
export const baselineSize = (
  { arcLevels, ranks, rows }: BaselineShape,
  { nodeSize: [width, height], rankGap, rowGap }: BaselineGeometry,
): [number, number] => {
  if (ranks === 0) { return [0, 0] }
  const headroom = arcLevels > 0 ? arcLevels * BASELINE_ARC_STEP + BASELINE_ARC_STROKE : 0
  return [ranks * width + (ranks - 1) * rankGap, headroom + rows * height + (rows - 1) * rowGap]
}

/** A path command: move, line, or cubic Bézier, in absolute canvas coordinates. */
export type BaselinePathCommand = ['C', number, number, number, number, number, number] | ['L', number, number] | ['M', number, number]

export interface BaselinePlacement {
  /** Each node's centre. The chain's first card is at [0, 0]. */
  positions: Record<string, [number, number]>
  /** Each edge's path, by its key. */
  paths: Record<string, BaselinePathCommand[]>
  /** The drawn [width, height] — `baselineSize`. */
  size: [number, number]
  /** The drawn box's top-left corner, in the same coordinates as `positions`. */
  origin: [number, number]
}

/** A cubic Bézier's control points for a peak `rise` above its two (level) ends: the peak is ¾ of the controls' offset. */
const CUBIC_PEAK = 0.75

/** The positions and paths for a structure, at one geometry. */
export const baselinePlacement = (structure: BaselineStructure, geometry: BaselineGeometry): BaselinePlacement => {
  const { nodeSize: [width, height], rankGap, rowGap } = geometry
  const x = (rank: number): number => rank * (width + rankGap)
  const y = (row: number): number => row * (height + rowGap)
  const positions: Record<string, [number, number]> = {}
  for (const [id, rank] of Object.entries(structure.ranks)) {
    positions[id] = [x(rank), y(structure.rows[id])]
  }
  const top = -height / 2
  const slotX = (centre: number, { count, index }: BaselineSlot): number => {
    const gap = count > 1 ? Math.min(BASELINE_SLOT_GAP, (width / 2) / (count - 1)) : 0
    return centre + (index - (count - 1) / 2) * gap
  }

  const paths: Record<string, BaselinePathCommand[]> = {}
  for (const edge of structure.edges) {
    const [sx, sy] = positions[edge.source]
    const [tx, ty] = positions[edge.target]
    // Which way the edge runs, and so which side of each card it leaves and enters by.
    const way = tx >= sx ? 1 : -1
    const start: [number, number] = [sx + way * width / 2, sy]
    const end: [number, number] = [tx - way * width / 2, ty]
    if (edge.route === 'straight') {
      paths[edge.key] = [['M', ...start], ['L', ...end]]
    } else if (edge.route === 'curve') {
      const middle = (start[0] + end[0]) / 2
      paths[edge.key] = [['M', ...start], ['C', middle, start[1], middle, end[1], ...end]]
    } else if (edge.route === 'lane') {
      // Into the lane across the first gap, along it through the ranks passed, out across the last gap.
      // A lane always passes a rank: an edge to the next rank is a curve, not a lane.
      const laneY = y(edge.lane!)
      const into = start[0] + way * rankGap
      const outOf = end[0] - way * rankGap
      paths[edge.key] = [
        ['M', ...start],
        ['C', (start[0] + into) / 2, start[1], (start[0] + into) / 2, laneY, into, laneY],
        ['L', outOf, laneY],
        ['C', (outOf + end[0]) / 2, laneY, (outOf + end[0]) / 2, end[1], ...end],
      ]
    } else {
      const from = slotX(sx, edge.slots!.source)
      const to = slotX(tx, edge.slots!.target)
      const control = top - (edge.level! * BASELINE_ARC_STEP) / CUBIC_PEAK
      paths[edge.key] = [['M', from, top], ['C', from, control, to, control, to, top]]
    }
  }

  const size = baselineSize(structure.shape, geometry)
  const headroom = structure.shape.arcLevels > 0 ? structure.shape.arcLevels * BASELINE_ARC_STEP + BASELINE_ARC_STROKE : 0
  return { origin: [-width / 2, top - headroom], paths, positions, size }
}

/** Both at once: what DependencyGraph hands G6. */
export const baselineLayout = (
  nodes: readonly BaselineNodeInput[],
  edges: readonly BaselineEdgeInput[],
  geometry: BaselineGeometry,
): BaselinePlacement & { structure: BaselineStructure } => {
  const structure = baselineStructure(nodes, edges)
  return { ...baselinePlacement(structure, geometry), structure }
}

/**
 * The edge style callback that gives each edge its path, by the key G6 knows it by. G6 hands it the
 * edge datum as it holds it, whose id may be a number.
 */
export const baselineRoute = (paths: Record<string, BaselinePathCommand[]>) =>
  (datum: { id?: number | string; source: number | string; target: number | string }): BaselinePathCommand[] | undefined =>
    paths[baselineEdgeKey({ id: datum.id === undefined ? undefined : String(datum.id), source: String(datum.source), target: String(datum.target) })]
