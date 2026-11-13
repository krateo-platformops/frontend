import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import DependencyGraph, { NATURAL_PADDING, type GraphDirection, type GraphNode } from '../../components/DependencyGraph'
import { WidgetEmpty } from '../../components/WidgetStates'
import type { WidgetProps } from '../../types/Widget'

import ArchitectureStateNode from './ArchitectureStateNode'
import {
  architectureEdgeAppearance,
  architectureFit,
  architectureNodeSize,
  architectureShape,
  toArchitectureGraphData,
  type ArchitectureDensity,
} from './architectureVariant'
import styles from './FlowChart.module.css'
import type { FlowChart as WidgetType } from './FlowChart.type'
import FlowChartNodeElement from './FlowChartNodeElement'
import { useArchitectureCardHeight } from './useArchitectureCardHeight'
import { toGraphData } from './utils'

export type FlowChartWidgetData = WidgetType['spec']['widgetData']
export type FlowChartData = FlowChartWidgetData['data']
export type FlowChartNodeData = NonNullable<FlowChartData>[number]

/**
 * THE BOX DAGRE RESERVES, AND IT MUST MATCH THE CARD.
 *
 * This said [300, 140] while FlowChartNodeElement.module.css painted a 400px card (+10px padding
 * +1px border = 422px under content-box). dagre packed 300px boxes with a 60px column gap, so every
 * card overhung its own reserved area by ~120px — drawing on top of its own outbound edges and into
 * the next column. That was the reported "nodes overlap links", and it was never a
 * layout-algorithm problem.
 *
 * The card now uses border-box and fills this width exactly (see the CSS), so this array is the
 * single source of truth for node geometry. Change it here, not there. The rest of C19 — edge
 * shape, layout, ports — is shared, in components/DependencyGraph/graphConfig.ts.
 */
const NODE_SIZE: [number, number] = [400, 150]

const renderNode = ({ data }: GraphNode<FlowChartNodeData>) => <FlowChartNodeElement data={data} />

/** The compact card's renderer, a module constant: a new renderNode is a re-layout. */
const renderCompactNode = ({ data }: GraphNode<FlowChartNodeData>) => <ArchitectureStateNode data={data} density='compact' />

interface VariantProps {
  data: FlowChartData
  uid: string
}

interface ArchitectureProps extends VariantProps {
  direction: GraphDirection
  /** The CR's own choice; absent, the card is regular and may step down to compact to fit. */
  density?: ArchitectureDensity
}

/**
 * `variant: architecture` — a chart's topology in the state the composition is in (S11). It differs
 * from the resource variant in three ways, each deliberate:
 *
 *   - THEMED. Its edges take the tokens and follow the portal theme. The resource variant keeps G6's
 *     own colours, because moving it is a visual change to every FlowChart CR already published.
 *   - FITTED TO ITS BOX, NEVER PAST THE TYPE FLOOR (`fit="natural"` plus `architectureFit`). The
 *     cards are designed at 240×84 and must stay readable; `view` would magnify a one-resource chart
 *     and shrink a wide one under the floor. Instead a graph too long for its box closes its rank
 *     gaps, then takes the compact card, then scales — each only as far as the box needs, and the
 *     scale no further than the floor. Only past that is it wider than the box: it keeps its first
 *     state in view, and the rest is dragged into view, or tabbed to, since each card takes focus and
 *     a focused card is panned into view (ArchitectureStateNode).
 *   - EDGES INTO A WITHHELD NODE ARE DASHED: that dependency has not been reached yet.
 *   - LEFT TO RIGHT, ONE BASELINE (`arrangement="baseline"`, baselineLayout.ts). The main chain — the
 *     longest path in dependency order — is one straight row; an edge that skips ranks arcs over it,
 *     never through a card; branches stack under it. And the box is as tall as that drawing (plus the
 *     placement's margins), not a fixed 360px with the cards floating in the middle of it. TB keeps
 *     dagre and its fixed box: its fit closes the rank gap DOWN the box, which needs a height to fit
 *     into, and the trace page's call graphs are where dagre's own handling has been checked.
 *
 *   - EVERY NAME IN FULL. The regular card wraps its name rather than cut it, so a long name makes a
 *     taller card — and the layout reserves ONE box per node, the same for all. So the cards are
 *     drawn first out of sight (`useArchitectureCardHeight`: the card's own lines and stylesheet),
 *     the tallest is measured, and every card is drawn, and laid out, at that height: no taller card
 *     runs into its neighbour, and the rows stay one height. The graph is created once the fonts
 *     have arrived and the cards are measured in them, so it is laid out once.
 *
 * `direction` and `density` (both optional) are for a box narrower than the chain is long. The trace
 * page's services column is ~415px: three 240px cards left to right are 1040px, so only the first was
 * in view. TB compact draws one 180×56 card per row, and is as wide as its broadest row. A density
 * the CR sets is kept (the adaptation only closes gaps and scales it); one it leaves out is regular,
 * stepping down to compact when the box needs it. `direction` is the CR's, always.
 */
const ArchitectureFlowChart = ({ data, density, direction, uid }: ArchitectureProps) => {
  const graphData = useMemo(() => toArchitectureGraphData(data), [data])
  const shape = useMemo(() => architectureShape(graphData.nodes, graphData.edges), [graphData])
  const empty = graphData.nodes.length === 0
  const box = useRef<HTMLDivElement>(null)
  // The box's [clientWidth, clientHeight]; null until it has been measured once.
  const [boxSize, setBoxSize] = useState<[number, number] | null>(null)
  // EVERY NAME IN FULL (see above): the tallest card, what every regular card is drawn and laid out at.
  const { height: cardHeight, measured, probe } = useArchitectureCardHeight(graphData.nodes)

  // ADAPT, NEVER CLIP (architectureVariant's `architectureFit`): the box is measured, here and on
  // every resize, and the graph drawn with the gap, the card and the scale that fit it — or, past
  // the type floor, as small as it may be, with portal#310's fade saying that there is more.
  //
  // Measured, not assumed: the box comes from the element, the drawn size from the node geometry,
  // because the canvas is G6's and its content bounds are not ours to read from here. The first
  // measure runs before the browser paints, and the graph is created only after it, so G6 lays the
  // graph out once, already adapted, rather than at true size and then again.
  useLayoutEffect(() => {
    const element = box.current
    if (!element) { return }
    const measure = () => {
      const width = element.clientWidth
      const height = element.clientHeight
      setBoxSize((known) => (known?.[0] === width && known[1] === height ? known : [width, height]))
    }
    measure()
    // ResizeObserver is absent in jsdom unless a test installs one; the first measure already ran,
    // so a missing observer costs responsiveness to a resize, never the initial state.
    if (typeof ResizeObserver === 'undefined') { return }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [empty])

  const fit = useMemo(
    () => architectureFit(shape, { box: boxSize ?? [0, 0], cardHeight, density, direction }),
    [boxSize, cardHeight, density, direction, shape],
  )
  // A new renderer is a re-layout: it changes only with the height, which is a re-layout anyway.
  const renderRegularNode = useCallback(
    ({ data: node }: GraphNode<FlowChartNodeData>) => <ArchitectureStateNode data={node} height={cardHeight} />,
    [cardHeight],
  )
  // LR: the box's height is the drawing's, at the fit's card, gaps and scale, with the placement's
  // margin above and below — so `placeAtNaturalSize` centres it, and no fixed height leaves it floating.
  const height = direction === 'TB' ? undefined : { '--architecture-height': `${Math.ceil(fit.size[1] + 2 * NATURAL_PADDING)}px` } as CSSProperties

  if (empty) {
    return <WidgetEmpty description='Nothing to graph' />
  }

  return (
    <div
      className={styles.architecture}
      // The fade is decorative: it repeats what the clipped card already shows, for people who read
      // the clip as damage. The content is reachable without it — drag, or Tab, which pans a focused
      // card into view — so it carries no accessible name and announces nothing (G12 is about colour
      // never being the ONLY signal; here the signal is the clipped card itself).
      data-overflows={fit.overflows ? 'true' : undefined}
      data-overflows-below={fit.overflowsBelow ? 'true' : undefined}
      data-testid='architecture-graph-box'
      key={uid}
      ref={box}
      style={height}
    >
      {probe}
      {/* Created once both are known, so G6 lays the graph out once: the box, and the card's height in its own face. */}
      {boxSize && measured
        ? (
          <DependencyGraph
            arrangement='baseline'
            direction={direction}
            edgeAppearance={architectureEdgeAppearance}
            edges={graphData.edges}
            fit='natural'
            nodeSize={architectureNodeSize(fit.density, cardHeight)}
            nodes={graphData.nodes}
            renderNode={fit.density === 'compact' ? renderCompactNode : renderRegularNode}
            spacing={fit.spacing}
            zoom={fit.scale}
          />
        )
        : null}
    </div>
  )
}

/**
 * `variant: resource`, the default: one card per live object. Unchanged by the architecture variant,
 * and it ignores `direction` and `density`: its 400×150 card is scaled to fill the box (`view`), so
 * it has no true-size overflow for either to solve, and honouring them would restyle every resource
 * FlowChart already published.
 */
const ResourceFlowChart = ({ data, uid }: VariantProps) => {
  // Memoised on the CR's data so a host re-render is not a new graph (and not a re-layout).
  const graphData = useMemo(() => toGraphData(data), [data])

  if (!data || graphData.nodes.length === 0) {
    return <WidgetEmpty description='Nothing to graph' />
  }

  return (
    <div className={styles.flowChart} key={uid}>
      {/* themed={false}: the canvas keeps G6's own light-theme colours, as it always has (it never
          followed the portal theme). Moving it onto the tokens is a visual change, and ships as one. */}
      <DependencyGraph
        edges={graphData.edges}
        nodeSize={NODE_SIZE}
        nodes={graphData.nodes as GraphNode<FlowChartNodeData>[]}
        renderNode={renderNode}
        themed={false}
      />
    </div>
  )
}

const FlowChart = ({ uid, widgetData }: WidgetProps<FlowChartWidgetData>) => {
  const { data, density, direction, variant } = widgetData
  // A value this build does not know falls back to the default, as an unknown `state` does: for
  // density that is "not set", which may step down to compact; a spelled-out `regular` may not.
  const chosen = density === 'compact' || density === 'regular' ? density : undefined
  return variant === 'architecture'
    ? <ArchitectureFlowChart data={data} density={chosen} direction={direction === 'TB' ? 'TB' : 'LR'} uid={uid} />
    : <ResourceFlowChart data={data} uid={uid} />
}

export default FlowChart
