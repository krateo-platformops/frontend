import { useMemo } from 'react'

import DependencyGraph, { type GraphNode } from '../../components/DependencyGraph'
import { WidgetEmpty } from '../../components/WidgetStates'
import type { WidgetProps } from '../../types/Widget'

import ArchitectureStateNode from './ArchitectureStateNode'
import { ARCHITECTURE_NODE_SIZE, architectureEdgeAppearance, toArchitectureGraphData } from './architectureVariant'
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
 *     than the box keeps its first state in view and is dragged for the rest.
 *   - EDGES INTO A WITHHELD NODE ARE DASHED: that dependency has not been reached yet.
 */
const ArchitectureFlowChart = ({ data, uid }: VariantProps) => {
  const graphData = useMemo(() => toArchitectureGraphData(data), [data])

  if (graphData.nodes.length === 0) {
    return <WidgetEmpty description='Nothing to graph' />
  }

  return (
    <div className={styles.architecture} key={uid}>
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
