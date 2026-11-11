/**
 * The baseline layout (`baselineLayout.ts`) as G6 extensions: a LAYOUT that puts each node where the
 * layout computed, and an EDGE that draws exactly the path it computed.
 *
 * WHY A REGISTERED LAYOUT, NOT POSITIONS ON THE DATA. @ant-design/graphs deep-merges its FlowGraph
 * defaults into every options object, and those include `layout: { type: 'dagre' }`: leaving `layout`
 * out keeps dagre, so x/y on the node data would be overwritten by dagre's. A layout of our own is the
 * library's own way to say where nodes go. It runs where dagre ran, with no animation, so everything
 * after it (the placement at true size, the canvas bounds) is unchanged.
 *
 * WHY AN EDGE THAT DRAWS A GIVEN PATH. G6's own edges are drawn port to port (`cubic-horizontal`), so
 * an edge that skips a rank on a straight row runs through the card in between, and none of them can
 * be told "arc above the row". The paths are computed with the positions, from the same structure, so
 * they meet the cards where the cards are.
 */
import { G6 } from '@ant-design/graphs'

import { BASELINE_EDGE, BASELINE_LAYOUT, type BaselinePathCommand } from './baselineLayout'

interface BaselineLayoutOptions extends G6.BaseLayoutOptions {
  positions?: Record<string, [number, number]>
}

/** Each node at its computed centre. A node the positions do not name (none should) is left at the origin. */
class BaselineLayout extends G6.BaseLayout<BaselineLayoutOptions> {
  id = BASELINE_LAYOUT

  async execute(model: G6.GraphData, options?: BaselineLayoutOptions): Promise<G6.GraphData> {
    const positions = options?.positions ?? this.options.positions ?? {}
    return Promise.resolve({
      nodes: (model.nodes ?? []).map(({ id }) => {
        const [x, y] = positions[String(id)] ?? [0, 0]
        return { id, style: { x, y } }
      }),
    })
  }
}

/** The edge's style: G6's, plus the path (`route`) the layout computed for it. */
type BaselineEdgeStyle = G6.BaseEdgeStyleProps & { route?: BaselinePathCommand[] }

/** Draws its `route`. Without one (an edge the layout did not see) it is a straight line between the two cards. */
class BaselineEdge extends G6.BaseEdge {
  protected getKeyPath(attributes: Required<BaselineEdgeStyle>): G6.PathArray {
    const { route } = attributes
    if (Array.isArray(route) && route.length > 0) {
      return route as unknown as G6.PathArray
    }
    const [source, target] = this.getEndpoints(attributes)
    return [['M', source[0], source[1]], ['L', target[0], target[1]]]
  }
}

/** Register both, once. The registry throws on a second registration, which is the "already registered" case. */
export const registerBaseline = (): void => {
  try {
    G6.register(G6.ExtensionCategory.LAYOUT, BASELINE_LAYOUT, BaselineLayout)
  } catch {
    /* already registered */
  }
  try {
    G6.register(G6.ExtensionCategory.EDGE, BASELINE_EDGE, BaselineEdge)
  } catch {
    /* already registered */
  }
}
