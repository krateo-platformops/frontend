import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import DependencyGraph, { type GraphNode } from '../../components/DependencyGraph'
import { WidgetEmpty } from '../../components/WidgetStates'
import type { WidgetProps } from '../../types/Widget'

import ArchitectureStateNode from './ArchitectureStateNode'
import { ARCHITECTURE_NODE_SIZE, architectureEdgeAppearance, architectureGraphWidth, toArchitectureGraphData } from './architectureVariant'
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

const renderArchitectureNode = ({ data }: GraphNode<FlowChartNodeData>) => <ArchitectureStateNode data={data} />

interface VariantProps {
  data: FlowChartData
  uid: string
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
 */
const ArchitectureFlowChart = ({ data, uid }: VariantProps) => {
  const graphData = useMemo(() => toArchitectureGraphData(data), [data])
  const drawnWidth = useMemo(() => architectureGraphWidth(graphData.nodes, graphData.edges), [graphData])
  const box = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)

  // portal#310. The graph is drawn at TRUE SIZE and `fit="natural"` pins its left edge, so a graph
  // wider than the box is clipped on the right — four columns are 1360px against a card that gives
  // ~1200px at 1518px of viewport, and EVERY composition with an architecture on 057 has four. The
  // overflow itself is the deliberate trade (see the variant's comment: the type floor outranks
  // fitting), but nothing on screen said so, and a card cut mid-name reads as a rendering fault
  // rather than as "there is more, drag it". This only decides whether to SAY so.
  //
  // Measured, not assumed: the box width comes from the element, the drawn width from the node
  // geometry, because the canvas is G6's and its content bounds are not ours to read from here.
  useLayoutEffect(() => {
    const element = box.current
    if (!element || drawnWidth === 0) { return }
    const measure = () => setOverflows(drawnWidth > element.clientWidth)
    measure()
    // ResizeObserver is absent in jsdom unless a test installs one; the first measure already ran,
    // so a missing observer costs responsiveness to a resize, never the initial state.
    if (typeof ResizeObserver === 'undefined') { return }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [drawnWidth])

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
      data-testid='architecture-graph-box'
      key={uid}
      ref={box}
    >
      <DependencyGraph
        edgeAppearance={architectureEdgeAppearance}
        edges={graphData.edges}
        fit='natural'
        nodeSize={ARCHITECTURE_NODE_SIZE}
        nodes={graphData.nodes}
        renderNode={renderArchitectureNode}
      />
    </div>
  )
}

/** `variant: resource`, the default: one card per live object. Unchanged by the architecture variant. */
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
  const { data, variant } = widgetData
  return variant === 'architecture'
    ? <ArchitectureFlowChart data={data} uid={uid} />
    : <ResourceFlowChart data={data} uid={uid} />
}

export default FlowChart
