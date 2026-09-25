/**
 * Drawing a graph at its TRUE size — a caller whose cards are designed at a pixel size (C19) and
 * must stay readable (the T3 type floor).
 *
 * WHY NOT `autoFit: 'view'`. FlowChart's fit scales the graph to FILL its box, with no zoom cap. In
 * the Blueprint Composer's fixed 360px pane that magnified a one-resource chart five times (a 780×360
 * card, a 50px eyebrow) and shrank builder-publish's four columns to 83% — its 10px eyebrows and
 * class pills to 8.3px, under the floor. Cards designed at 156×72 were never drawn at 156×72.
 *
 * WHAT THIS DOES INSTEAD, after every layout and every resize of the box: zoom 1; centre the graph if
 * it fits; if it does not, pin its LEFT (and top) edge inside the box — the machine reads left to
 * right, so the first state stays in view and the rest is a drag away — rather than centring it and
 * cutting both ends off.
 */
import type { G6 } from '@ant-design/graphs'

/** The margin kept between an overflowing graph and the box's edge, in px. */
export const NATURAL_PADDING = 16

/** The slice of a live G6 graph the placement drives. */
export type NaturalViewportGraph = Pick<G6.Graph, 'fitCenter' | 'getCanvas' | 'getSize' | 'getViewportByCanvas' | 'translateBy' | 'zoomTo'>

/**
 * Place the drawn graph at zoom 1 in its box. No animation: this follows a layout or a resize, and a
 * glide from where G6 left it would be motion that means nothing.
 */
export const placeAtNaturalSize = async (graph: NaturalViewportGraph, padding = NATURAL_PADDING): Promise<void> => {
  await graph.zoomTo(1, false)
  await graph.fitCenter(false)
  const bounds = graph.getCanvas().getBounds('elements')
  const [width, height] = graph.getSize()
  const [left, top] = graph.getViewportByCanvas([bounds.min[0], bounds.min[1]])
  const offset: [number, number] = [
    bounds.max[0] - bounds.min[0] + 2 * padding > width ? padding - left : 0,
    bounds.max[1] - bounds.min[1] + 2 * padding > height ? padding - top : 0,
  ]
  if (offset[0] || offset[1]) {
    await graph.translateBy(offset, false)
  }
}

type Edges = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>

/** Along one axis: how far to move [start, end] to sit inside [min, max] with `padding` spare. */
const shiftInto = (start: number, end: number, min: number, max: number, padding: number): number => {
  if (start < min + padding) {
    return min + padding - start
  }
  if (end > max - padding) {
    return max - padding - end
  }
  return 0
}

/**
 * The pan that brings a focused card fully into its box, with the placement's margin — [0, 0] when
 * it is already in view. A card past the RIGHT edge the browser would scroll to on its own (and the
 * graph takes that scroll back as a pan); one past the LEFT or top edge it cannot reach at all, since
 * nothing scrolls below zero — so focus would land somewhere nobody can see.
 */
export const revealOffset = (card: Edges, box: Edges, padding = NATURAL_PADDING): [number, number] => [
  shiftInto(card.left, card.right, box.left, box.right, padding),
  shiftInto(card.top, card.bottom, box.top, box.bottom, padding),
]
