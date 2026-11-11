/**
 * FlowChart's `architecture` variant, the pure half: a chart's topology (one node per resource the
 * chart declares, edges from its `dependsOn`) turned into the graph DependencyGraph draws, with each
 * node in the state the composition is in.
 *
 * THE DATA IS THE RESTACTION'S. `composition-architecture` (portal) evaluates the chart's
 * descriptor against the live objects under the caller's own identity, and the widget's
 * `widgetDataTemplate` maps each node to `{uid, kind, name, state, detail, exception, parentRefs}`.
 * Nothing here reads the cluster or decides a state: a node is drawn in the state it arrives in.
 *
 * EXCEPTION-ONLY (P14). A `done` node is neutral and carries no marker; the one red on the canvas
 * is the `exception` dot, which the RESTAction sets only for NotSynced or NotReady (P13). Edges
 * take the theme's neutral tokens, dashed where they point into a node that is still withheld.
 */
import {
  GRAPH_LAYOUT,
  NATURAL_PADDING,
  type EdgeAppearance,
  type GraphDirection,
  type GraphEdge,
  type GraphNode,
  type GraphSpacing,
} from '../../components/DependencyGraph'
import { textPx } from '../../theme/tokens'

import type { FlowChartData, FlowChartNodeData } from './FlowChart'

export type ArchitectureState = NonNullable<FlowChartNodeData['state']>

export type ArchitectureException = NonNullable<FlowChartNodeData['exception']>

/** What an edge needs to know about the node it points into. */
export interface ArchitectureEdgeData {
  withheld: boolean
}

/**
 * [width, height]: ArchitectureStateNode's CSS box, and so what dagre reserves per node (C19) — the
 * one source every width here is computed from (the stylesheet's box is pinned to it by
 * architectureFit.test.ts). Wider than the composer's 156×72 because this card shows resolved names,
 * and a forEach range such as `publish-pod-sizing-v1b-000 … 009` does not fit in 156px.
 *
 * 240, not 220: with the eyebrow at the 12px floor, a forEach kind and the exception chip need
 * `LOCALRESOURCE ×8` (124px) + 8px + `NotSynced` (75px) = 207px, and 220px of card left 194px of
 * text, so the kind was cut. 240px leaves 214px (measured in architectureCardText.spec.ts).
 */
export const ARCHITECTURE_NODE_SIZE: [number, number] = [240, 84]

/** How big the card is: `regular` (absent), the 240×84 card; `compact`, a 180×56 one. */
export type ArchitectureDensity = 'regular' | 'compact'

/**
 * The compact card's box: two lines of name and the detail line, no kind line. 180px leaves 154px
 * of text, so a long service name such as `krateo-agent-gateway-platform` (~190px at the card's
 * type size) takes its second line rather than an ellipsis; only a name that needs a third is cut.
 */
export const ARCHITECTURE_COMPACT_NODE_SIZE: [number, number] = [180, 56]

/**
 * The compact card's gaps. C19's 160px between ranks was sized for the regular card side by side; under
 * a 56px card it is three cards of empty space. 32px between ranks keeps an edge with its arrowhead
 * legible and puts four ranks top to bottom (4×56 + 3×32 = 320px) inside the 360px box with the
 * placement's 16px margins; 16px between siblings puts two side by side (376px) inside ~415px.
 */
export const ARCHITECTURE_COMPACT_SPACING: GraphSpacing = { nodesep: 16, ranksep: 32 }

/**
 * Each density's card box and dagre gaps. `regular` has no spacing of its own: it is C19's, and
 * leaving it undefined is what keeps a CR that sets no density handing G6 exactly what it did.
 */
export const ARCHITECTURE_DENSITY: Record<ArchitectureDensity, { nodeSize: [number, number]; spacing?: GraphSpacing }> = {
  compact: { nodeSize: ARCHITECTURE_COMPACT_NODE_SIZE, spacing: ARCHITECTURE_COMPACT_SPACING },
  regular: { nodeSize: ARCHITECTURE_NODE_SIZE },
}

/**
 * Each node's rank: its step in the longest chain of active dependencies, which is what `level`
 * means in the descriptor — computed here from the edges rather than read from the data, because
 * the widget is given `parentRefs` and not levels.
 *
 * A cycle cannot happen (the descriptor is a DAG and `toArchitectureGraphData` drops an edge whose
 * source is not drawn) but the walk is depth-capped anyway: a malformed payload must not hang the
 * page, and a wrong rank only costs a fade that should not be there.
 */
const architectureRanks = (
  nodes: readonly { id: string }[],
  edges: readonly { source: string; target: string }[],
): number[] => {
  const parents = new Map<string, string[]>()
  for (const { source, target } of edges) {
    parents.set(target, [...(parents.get(target) ?? []), source])
  }
  const depth = new Map<string, number>()
  const rankOf = (id: string, seen: ReadonlySet<string>): number => {
    const known = depth.get(id)
    if (known !== undefined) { return known }
    // Depth cap: a self-reference or a cycle in a malformed payload stops here rather than recursing.
    if (seen.has(id) || seen.size > nodes.length) { return 0 }
    const next = new Set(seen).add(id)
    const own = (parents.get(id) ?? []).reduce((deepest, parent) => Math.max(deepest, rankOf(parent, next) + 1), 0)
    depth.set(id, own)
    return own
  }
  return nodes.map(({ id }) => rankOf(id, new Set()))
}

/** What the drawn size depends on besides the graph: which way it runs, the card, and the gaps. */
export interface ArchitectureGeometry {
  direction: GraphDirection
  nodeSize: [number, number]
  spacing: GraphSpacing
}

/** How many ranks the graph has, and how many nodes its broadest rank holds: all its size depends on. */
export interface ArchitectureShape {
  broadest: number
  ranks: number
}

/** The graph's shape, by `architectureRanks`. An empty graph is 0 × 0. */
export const architectureShape = (
  nodes: readonly { id: string }[],
  edges: readonly { source: string; target: string }[],
): ArchitectureShape => {
  if (nodes.length === 0) { return { broadest: 0, ranks: 0 } }
  const perRank = new Map<number, number>()
  for (const rank of architectureRanks(nodes, edges)) {
    perRank.set(rank, (perRank.get(rank) ?? 0) + 1)
  }
  return { broadest: Math.max(...perRank.values()), ranks: Math.max(...perRank.keys()) + 1 }
}

/** A shape's drawn [width, height] at the cards' true size — `architectureGraphSize`'s arithmetic. */
const drawnSize = (
  { broadest, ranks }: ArchitectureShape,
  { direction, nodeSize: [cardWidth, cardHeight], spacing: { nodesep, ranksep } }: ArchitectureGeometry,
): [number, number] => {
  if (ranks === 0) { return [0, 0] }
  const along = (card: number) => ranks * card + (ranks - 1) * ranksep
  const across = (card: number) => broadest * card + (broadest - 1) * nodesep
  return direction === 'TB' ? [across(cardWidth), along(cardHeight)] : [along(cardWidth), across(cardHeight)]
}

/**
 * The drawn size of an architecture graph, [width, height] in px, at the cards' true size.
 *
 * ALONG the direction the graph is as long as its ranks: `ranks × card + (ranks − 1) × ranksep`.
 * ACROSS it, as broad as its broadest rank: `n × card + (n − 1) × nodesep` for the rank holding the
 * most nodes. So in LR the width is the ranks and the height the broadest column; in TB the width is
 * the broadest ROW — three ranks of one card each are one card wide, however long the chain.
 *
 * Used to tell the card whether the graph runs past its box (portal#310). Before this, a graph wider
 * than the box was simply clipped at the right edge with nothing on screen saying so: the last
 * column was cut mid-card and read as a rendering fault rather than as "there is more, drag it".
 * `fit="natural"` pins the LEFT (and top) edge, so overflow is on the right, or the bottom, on first
 * paint.
 *
 * The across-axis is the broadest rank by this walk's ranks, which are dagre's for a tree and for
 * the graphs a service path or a chart's descriptor draws (checked against the real dagre layout in
 * `architectureGraphSize.layout.test.ts`). Where dagre packs a rank wider than its own cards — an
 * edge that skips a rank takes a lane in it — the estimate is under by that lane.
 */
export const architectureGraphSize = (
  nodes: readonly { id: string }[],
  edges: readonly { source: string; target: string }[],
  geometry: ArchitectureGeometry,
): [number, number] => drawnSize(architectureShape(nodes, edges), geometry)

/**
 * The drawn WIDTH of an LR graph of regular cards with C19's gaps — what the composition page's
 * diagram has always measured: `ranks × cardWidth + (ranks − 1) × ranksep`.
 */
export const architectureGraphWidth = (
  nodes: readonly { id: string }[],
  edges: readonly { source: string; target: string }[],
  cardWidth = ARCHITECTURE_NODE_SIZE[0],
  ranksep = GRAPH_LAYOUT.ranksep,
): number => architectureGraphSize(nodes, edges, {
  direction: 'LR',
  nodeSize: [cardWidth, ARCHITECTURE_NODE_SIZE[1]],
  spacing: { nodesep: GRAPH_LAYOUT.nodesep, ranksep },
})[0]

/**
 * ADAPT, NEVER CLIP. The graph was drawn at true size whatever its box, so the builder-publish chain
 * (four ranks: 4 × 220 + 3 × 160 = 1360px with the 220px card of the time; 1440px at today's 240px)
 * lost its fourth card in the ~1180px the composition page gives it at a 1456px window, and in
 * ~1000px at 1280 — on every builder-publish composition. #310's fade said so; it did not help
 * anyone read the card. Now the graph adapts to the box first, in this order, and is recomputed
 * whenever the box is resized:
 *
 *   1. THE RANK GAP shrinks (LR: between columns; TB: between rows), from the density's own gap
 *      towards `ARCHITECTURE_MIN_RANK_GAP`, just far enough to fit — in steps of
 *      `ARCHITECTURE_RANK_GAP_STEP`, so dragging a window edge re-lays the graph out every few
 *      dozen pixels rather than on every one.
 *   2. THE COMPACT CARD (180×56, the trace page's), and step 1 again for its own gap. Compact's gap
 *      (32px) is already under the minimum, so for compact step 1 changes nothing.
 *   3. A SCALE, down to fit, but never so far that the card's smallest text renders under
 *      `ARCHITECTURE_TYPE_FLOOR` px (T3's floor) — the limit is computed from the type roles the
 *      card's CSS actually uses (`ARCHITECTURE_TEXT_ROLES`), per density.
 *
 * Past the floor, the graph is drawn as small as it may be and today's behaviour stands: pinned left
 * (and top) edge, the fade, drag or Tab for the rest.
 *
 * TODAY THE FLOOR STOPS STEP 3 BEFORE IT STARTS. No text on either card is under the floor (pinned
 * by architectureFit.test.ts against the stylesheet), and both cards' smallest text sits AT it:
 * `text-caption`, 12px — the detail line on both, and on the regular card the kind line and the
 * exception chip's label too, raised from `text-label-xs` (10px). Any scale under 1 puts that text
 * under 12px, so neither card is ever scaled. The step is here, and pinned by tests at other type
 * sizes, so the rule does not depend on today's card; with today's card it scales nothing.
 *
 * AN EXPLICIT DENSITY IS THE AUTHOR'S FLOOR. A CR that sets `density` (either value) chose the card:
 * only steps 1 and 3 apply to it, and `regular` never becomes compact. Only a CR that leaves density
 * out (every composition page's diagram) may step down to compact. `direction` is never changed.
 *
 * "FITS" IS THE PLACEMENT'S DEFINITION: the drawn size plus `NATURAL_PADDING` on both sides, which is
 * when `placeAtNaturalSize` centres the graph rather than pinning its left edge. In LR only the width
 * is measured, as it always was, and nothing here makes an LR graph taller (the gap is horizontal,
 * the compact card is shorter, a scale only shrinks), so the 360px box holds whatever it held. In TB
 * the gap runs down the box, so the height is measured too, and the width against the broadest row.
 */

/** The narrowest rank gap step 1 goes to, px. */
export const ARCHITECTURE_MIN_RANK_GAP = 56

/** Step 1's increment, px: a shrunk gap is always a multiple of it. */
export const ARCHITECTURE_RANK_GAP_STEP = 8

/** T3's type floor: no text on the card is scaled under this, px. */
export const ARCHITECTURE_TYPE_FLOOR = 12

/**
 * The type roles each card's text is set in — ArchitectureStateNode.module.css, `font-size:
 * var(--krateo-text-<role>)` on every line the density renders (pinned against the stylesheet by
 * architectureFit.test.ts). Regular: the name (`body-sm`), and the kind line, the exception chip and
 * the detail (`caption`). Compact draws no kind line and an exception as a bare dot, so it is the name
 * and the detail only — the same two roles.
 */
export const ARCHITECTURE_TEXT_ROLES: Record<ArchitectureDensity, readonly string[]> = {
  compact: ['body-sm', 'caption'],
  regular: ['body-sm', 'caption'],
}

/**
 * The smallest scale a density may be drawn at: the one that puts its smallest text at the floor,
 * and never above 1 — a card whose smallest text is already under the floor is not scaled at all.
 */
export const architectureMinScale = (density: ArchitectureDensity, roleSize: (role: string) => number = textPx): number =>
  Math.min(1, ARCHITECTURE_TYPE_FLOOR / Math.min(...ARCHITECTURE_TEXT_ROLES[density].map(roleSize)))

/**
 * Which step the graph was adapted to: `none` (it fits as designed), `gap`, `compact`, `scale`, or
 * `overflow` (past the floor). `unmeasured`: the box has no size yet, so nothing is decided.
 */
export type ArchitectureFitStep = 'compact' | 'gap' | 'none' | 'overflow' | 'scale' | 'unmeasured'

/** What the graph is drawn with in a box, and whether it still runs past it. */
export interface ArchitectureFit {
  density: ArchitectureDensity
  /** Between ranks, px. */
  rankGap: number
  /**
   * The gaps DependencyGraph is given. Undefined for regular at its own gap — C19's, exactly what a
   * CR that sets nothing has always handed G6.
   */
  spacing?: GraphSpacing
  /** The zoom the graph is drawn at, ≤ 1. */
  scale: number
  /** The drawn [width, height] at that scale, px. */
  size: [number, number]
  /** A left-pinned graph runs past the box's right edge: the fade's cue (portal#310). */
  overflows: boolean
  /** TB only: a top-pinned graph runs past the bottom. */
  overflowsBelow: boolean
  step: ArchitectureFitStep
}

export interface ArchitectureFitInput {
  /** The box's [clientWidth, clientHeight]. A width of 0 is a box not laid out yet (hidden, or jsdom). */
  box: [number, number]
  direction: GraphDirection
  /** The CR's `density`, when it sets one: then it is not changed. Absent: regular, compact if need be. */
  density?: ArchitectureDensity
  /** A type role's size in px: the tokens', unless a test gives another scale. */
  roleSize?: (role: string) => number
}

/** A density's card and its own gaps, regular's being C19's. */
const densityGeometry = (density: ArchitectureDensity): { nodeSize: [number, number]; spacing: GraphSpacing } => {
  const { nodeSize, spacing } = ARCHITECTURE_DENSITY[density]
  return { nodeSize, spacing: spacing ?? { nodesep: GRAPH_LAYOUT.nodesep, ranksep: GRAPH_LAYOUT.ranksep } }
}

/**
 * One object per (density, gap), whichever call asks: DependencyGraph re-lays out on a NEW spacing
 * object, so a resize that leaves the gap where it was must hand it the same one. Compact's is its
 * module constant. Bounded: a gap is a multiple of the step between the minimum and C19's.
 */
const GAPS = new Map<string, GraphSpacing>()
const gapsOf = (density: ArchitectureDensity, nodesep: number, ranksep: number): GraphSpacing => {
  const own = ARCHITECTURE_DENSITY[density].spacing
  if (own && own.nodesep === nodesep && own.ranksep === ranksep) { return own }
  const key = `${density}:${nodesep}:${ranksep}`
  const known = GAPS.get(key)
  if (known) { return known }
  const made = { nodesep, ranksep }
  GAPS.set(key, made)
  return made
}

/**
 * The adaptation (see the block above) for a graph of `shape` in `box`. Pure, so every width is a
 * test; FlowChart calls it with the box it measures, on every resize.
 */
export const architectureFit = (
  shape: ArchitectureShape,
  { box: [boxWidth, boxHeight], density, direction, roleSize = textPx }: ArchitectureFitInput,
): ArchitectureFit => {
  const tb = direction === 'TB'
  const roomWidth = boxWidth - 2 * NATURAL_PADDING
  const roomHeight = boxHeight - 2 * NATURAL_PADDING

  const fitOf = (chosen: ArchitectureDensity, rankGap: number, scale: number, step: ArchitectureFitStep): ArchitectureFit => {
    const { nodeSize, spacing: own } = densityGeometry(chosen)
    const spacing = gapsOf(chosen, own.nodesep, rankGap)
    const [width, height] = drawnSize(shape, { direction, nodeSize, spacing })
    const size: [number, number] = [width * scale, height * scale]
    return {
      density: chosen,
      // A pinned graph starts NATURAL_PADDING in, so past that it is cut.
      overflows: size[0] + NATURAL_PADDING > boxWidth,
      overflowsBelow: tb && size[1] + NATURAL_PADDING > boxHeight,
      rankGap,
      scale,
      size,
      spacing: chosen === 'regular' && rankGap === own.ranksep ? ARCHITECTURE_DENSITY.regular.spacing : spacing,
      step,
    }
  }
  const fits = ([width, height]: [number, number]): boolean => width <= roomWidth && (!tb || height <= roomHeight)

  const candidates: ArchitectureDensity[] = density ? [density] : ['regular', 'compact']
  const last = candidates[candidates.length - 1]
  if (boxWidth <= 0 || shape.ranks === 0) {
    return fitOf(candidates[0], densityGeometry(candidates[0]).spacing.ranksep, 1, 'unmeasured')
  }

  // Steps 1 and 2: each density in turn, at the widest gap that fits — its own, or less, to the minimum.
  for (const [index, chosen] of candidates.entries()) {
    const { nodeSize: [cardWidth, cardHeight], spacing: { ranksep: ownGap } } = densityGeometry(chosen)
    const minGap = Math.min(ownGap, ARCHITECTURE_MIN_RANK_GAP)
    const card = tb ? cardHeight : cardWidth
    const roomPerGap = shape.ranks > 1 ? ((tb ? roomHeight : roomWidth) - shape.ranks * card) / (shape.ranks - 1) : ownGap
    const stepped = Math.floor(roomPerGap / ARCHITECTURE_RANK_GAP_STEP) * ARCHITECTURE_RANK_GAP_STEP
    const rankGap = Math.min(ownGap, Math.max(minGap, stepped))
    const closed: ArchitectureFitStep = rankGap < ownGap ? 'gap' : 'none'
    const fit = fitOf(chosen, rankGap, 1, index > 0 ? 'compact' : closed)
    if (fits(fit.size)) { return fit }
  }

  // Step 3: the last density, at its narrowest gap, scaled to fit — down to the type floor, no further.
  const minGap = Math.min(densityGeometry(last).spacing.ranksep, ARCHITECTURE_MIN_RANK_GAP)
  const [width, height] = fitOf(last, minGap, 1, 'overflow').size
  // Two decimals, rounded down: a scale rounded up could miss the box by a pixel.
  const toFit = Math.floor(Math.min(roomWidth / width, tb ? roomHeight / height : Infinity) * 100) / 100
  const floor = architectureMinScale(last, roleSize)
  return toFit >= floor ? fitOf(last, minGap, toFit, 'scale') : fitOf(last, minGap, floor, 'overflow')
}

const STATES: readonly ArchitectureState[] = ['done', 'waiting', 'withheld', 'unreadable', 'unavailable', 'unknown']

/**
 * The state a node is drawn in. A missing state, or one this build does not know, is drawn as
 * `unknown`. That is muted, and it claims nothing: a newer RESTAction's state must not be shown as
 * done.
 */
export const architectureState = (state: unknown): ArchitectureState =>
  STATES.find((known) => known === state) ?? 'unknown'

/**
 * The full value behind the name line, for the card's `title` — what hover and keyboard focus
 * disclose. Before portal#311 the `title` repeated the already-shortened string, so nothing anywhere
 * in the UI could tell you what a node's objects were actually called.
 *
 * A `forEach` node lists every instance: `targetCommitId · 9 of 9` tells you there are nine and the
 * name line tells you the range, but neither says WHICH nine, and the RESTAction has them. Capped,
 * because a tooltip is not a table — past the cap it says how many more.
 *
 * The NAME LINE is left exactly as the RESTAction wrote it. Eliding the shared prefix is the right
 * call for 214px of card (it is the suffix that tells the nodes apart), and moving that rule into
 * the SPA would be a second change riding on this one. What was wrong was only that the elision
 * reached the tooltip too, so the full value existed nowhere.
 */
export const architectureTitle = (names: readonly string[] | undefined, fallback: string, apiVersion?: string, cap = 12): string => {
  const kindLine = apiVersion ? [apiVersion] : []
  if (!names || names.length === 0) { return [fallback, ...kindLine].join('\n') }
  const shown = names.slice(0, cap)
  const rest = names.length - shown.length
  return [...shown, ...(rest > 0 ? [`… and ${rest} more`] : []), ...kindLine].join('\n')
}

/** `label: reason — message`, the words behind the exception dot. */
export const exceptionText = ({ label, message, reason }: ArchitectureException): string =>
  `${label}${reason ? `: ${reason}` : ''}${message ? ` — ${message}` : ''}`

/** The card's accessible name: "kind name, state", then the exception when there is one. */
export const architectureNodeLabel = (node: FlowChartNodeData): string =>
  [`${node.kind} ${node.name}`, architectureState(node.state), ...(node.exception ? [exceptionText(node.exception)] : [])].join(', ')

/**
 * The graph. Unlike the resource variant's `toGraphData`, it guards the three shapes that make G6
 * throw, because a throw replaces the whole graph with the widget's error card:
 *   - two nodes with one uid ("already exists"): the first is kept;
 *   - an edge from a node that is not drawn: a dependency on a resource whose `when` is false for
 *     this composition is dropped, not drawn to nowhere;
 *   - a parent listed twice: one edge.
 * Every edge carries an id (`GraphEdge` explains why) and whether its target is withheld.
 */
export const toArchitectureGraphData = (data: FlowChartData): {
  edges: GraphEdge<ArchitectureEdgeData>[]
  nodes: GraphNode<FlowChartNodeData>[]
} => {
  if (!Array.isArray(data)) {
    return { edges: [], nodes: [] }
  }
  const byId = new Map<string, FlowChartNodeData>()
  for (const node of data) {
    if (typeof node?.uid === 'string' && node.uid !== '' && !byId.has(node.uid)) {
      byId.set(node.uid, node)
    }
  }
  const nodes = [...byId.entries()].map(([id, node]) => ({ data: node, id }))
  const edges = new Map<string, GraphEdge<ArchitectureEdgeData>>()
  for (const { data: node, id: target } of nodes) {
    const withheld = architectureState(node.state) === 'withheld'
    for (const { uid: source } of node.parentRefs ?? []) {
      if (typeof source === 'string' && source !== target && byId.has(source)) {
        const id = `${source}→${target}`
        edges.set(id, edges.get(id) ?? { data: { withheld }, id, source, target })
      }
    }
  }
  return { edges: [...edges.values()], nodes }
}

/** Dashed into a withheld node, solid otherwise. No label, and no colour: those are the tokens'. */
export const architectureEdgeAppearance = (edge: GraphEdge<ArchitectureEdgeData>): EdgeAppearance =>
  ({ dashed: edge.data?.withheld === true })
