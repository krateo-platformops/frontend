import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import DependencyGraph, { GRAPH_LAYOUT, type GraphDirection, type GraphNode } from '../../components/DependencyGraph'
import { WidgetEmpty } from '../../components/WidgetStates'
import type { WidgetProps } from '../../types/Widget'

import ArchitectureStateNode from './ArchitectureStateNode'
import {
  ARCHITECTURE_DENSITY,
  architectureEdgeAppearance,
  architectureGraphSize,
  toArchitectureGraphData,
  type ArchitectureDensity,
} from './architectureVariant'
import styles from './FlowChart.module.css'
import type { FlowChart as WidgetType } from './FlowChart.type'
import FlowChartNodeElement from './FlowChartNodeElement'
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

/** One card renderer per density, each a module constant: a new renderNode is a re-layout. */
const RENDER_ARCHITECTURE_NODE: Record<ArchitectureDensity, (node: GraphNode<FlowChartNodeData>) => ReactNode> = {
  compact: ({ data }) => <ArchitectureStateNode data={data} density='compact' />,
  regular: ({ data }) => <ArchitectureStateNode data={data} />,
}

interface VariantProps {
  data: FlowChartData
  uid: string
}

interface ArchitectureProps extends VariantProps {
  direction: GraphDirection
  density: ArchitectureDensity
}

/**
 * `variant: architecture` — a chart's topology in the state the composition is in (S11). It differs
 * from the resource variant in three ways, each deliberate:
 *
 *   - THEMED. Its edges take the tokens and follow the portal theme. The resource variant keeps G6's
 *     own colours, because moving it is a visual change to every FlowChart CR already published.
 *   - TRUE SIZE (`fit="natural"`). The cards are designed at 220×84 and must stay readable; `view`
 *     would magnify a one-resource chart and shrink a wide one under the type floor. A graph wider
 *     than the box keeps its first state in view; the rest is dragged into view, or tabbed to, since
 *     each card takes focus and a focused card is panned into view (ArchitectureStateNode).
 *   - EDGES INTO A WITHHELD NODE ARE DASHED: that dependency has not been reached yet.
 *
 * `direction` and `density` (both optional; absent, LR and regular — the composition page's diagram,
 * unchanged) are for a box narrower than the chain is long. The trace page's services column is
 * ~415px: three 220px cards left to right are 980px, so only the first was in view. TB compact draws
 * one 180×56 card per row, and is as wide as its broadest row.
 */
const ArchitectureFlowChart = ({ data, density, direction, uid }: ArchitectureProps) => {
  const { nodeSize, spacing } = ARCHITECTURE_DENSITY[density]
  const graphData = useMemo(() => toArchitectureGraphData(data), [data])
  const [drawnWidth, drawnHeight] = useMemo(
    () => architectureGraphSize(graphData.nodes, graphData.edges, { direction, nodeSize, spacing: spacing ?? GRAPH_LAYOUT }),
    [direction, graphData, nodeSize, spacing],
  )
  const box = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [overflowsBelow, setOverflowsBelow] = useState(false)

  // portal#310. The graph is drawn at TRUE SIZE and `fit="natural"` pins its left edge, so a graph
  // wider than the box is clipped on the right — four columns are 1360px against a card that gives
  // ~1200px at 1518px of viewport, and EVERY composition with an architecture on 057 has four. The
  // overflow itself is the deliberate trade (see the variant's comment: the type floor outranks
  // fitting), but nothing on screen said so, and a card cut mid-name reads as a rendering fault
  // rather than as "there is more, drag it". This only decides whether to SAY so.
  //
  // Measured, not assumed: the box width comes from the element, the drawn width from the node
  // geometry, because the canvas is G6's and its content bounds are not ours to read from here.
  //
  // In TB the graph also grows DOWNWARDS, one row per rank, and the placement pins its top edge, so a
  // chain deeper than the box runs off the bottom: that is said too. In LR the height is not
  // measured, as it never was — the composition page's diagram must not gain a fade it did not have.
  useLayoutEffect(() => {
    const element = box.current
    if (!element || drawnWidth === 0) { return }
    const measure = () => {
      setOverflows(drawnWidth > element.clientWidth)
      setOverflowsBelow(direction === 'TB' && drawnHeight > element.clientHeight)
    }
    measure()
    // ResizeObserver is absent in jsdom unless a test installs one; the first measure already ran,
    // so a missing observer costs responsiveness to a resize, never the initial state.
    if (typeof ResizeObserver === 'undefined') { return }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [direction, drawnHeight, drawnWidth])

  if (graphData.nodes.length === 0) {
    return <WidgetEmpty description='Nothing to graph' />
  }

  return (
    <div
      className={styles.architecture}
      // The fade is decorative: it repeats what the clipped card already shows, for people who read
      // the clip as damage. The content is reachable without it — drag, or Tab, which pans a focused
      // card into view — so it carries no accessible name and announces nothing (G12 is about colour
      // never being the ONLY signal; here the signal is the clipped card itself).
      data-overflows={overflows ? 'true' : undefined}
      data-overflows-below={overflowsBelow ? 'true' : undefined}
      data-testid='architecture-graph-box'
      key={uid}
      ref={box}
    >
      <DependencyGraph
        direction={direction}
        edgeAppearance={architectureEdgeAppearance}
        edges={graphData.edges}
        fit='natural'
        nodeSize={nodeSize}
        nodes={graphData.nodes}
        renderNode={RENDER_ARCHITECTURE_NODE[density]}
        spacing={spacing}
      />
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
  // A value this build does not know falls back to the default, as an unknown `state` does.
  return variant === 'architecture'
    ? <ArchitectureFlowChart data={data} density={density === 'compact' ? 'compact' : 'regular'} direction={direction === 'TB' ? 'TB' : 'LR'} uid={uid} />
    : <ResourceFlowChart data={data} uid={uid} />
}

export default FlowChart
