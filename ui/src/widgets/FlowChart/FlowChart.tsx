import { useMemo } from 'react'

import DependencyGraph, { type GraphNode } from '../../components/DependencyGraph'
import { WidgetEmpty } from '../../components/WidgetStates'
import type { WidgetProps } from '../../types/Widget'

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

const FlowChart = ({ uid, widgetData }: WidgetProps<FlowChartWidgetData>) => {
  const { data } = widgetData
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

export default FlowChart
