import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import type { GraphNode } from '../../components/DependencyGraph'

import { ArchitectureCardProbe } from './ArchitectureStateNode'
import { ARCHITECTURE_NODE_SIZE } from './architectureVariant'
import type { FlowChartNodeData } from './FlowChart'
import styles from './FlowChart.module.css'

/**
 * EVERY NAME IN FULL: the height every regular architecture card is drawn, and laid out, at.
 *
 * The regular card wraps its name rather than cut it, so a long name makes a taller card — and the
 * layout reserves ONE box per node, the same for all. So the cards are drawn first out of sight
 * (`probe`, to be rendered inside a positioned box: the card's own lines and stylesheet, as tall as
 * those lines need), and the tallest is measured. Every card drawn at that height means no taller
 * card runs into its neighbour, and the rows stay one height.
 *
 * MEASURED IN THE FACE IT IS DRAWN IN. The first measure (a layout effect, before paint) is what
 * starts the card's fonts loading, so it is taken in the fallback face, where a name wraps
 * differently. `measured` is false until the fonts that measure asked for have arrived and the cards
 * have been measured again: the caller creates its graph only then, so G6 lays it out once, at the
 * right height. Created at the fallback face's height instead, the graph was laid out again when
 * the fonts arrived, in a box that grew under it — and for the second (about the first render's
 * length) the old placement held, every card 35px low and the last row past the box's edge. A face
 * that loads later still is measured again ('loadingdone'). Where the browser has no FontFaceSet
 * (jsdom), `measured` is true from the start. Never under 84px (ARCHITECTURE_NODE_SIZE). jsdom lays
 * nothing out: every card measures 0, and the height stays 84.
 *
 * `nodes` must be stable (memoised): a new array is a new measure.
 */
export const useArchitectureCardHeight = (nodes: readonly GraphNode<FlowChartNodeData>[]): { height: number; measured: boolean; probe: ReactNode } => {
  const probe = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(ARCHITECTURE_NODE_SIZE[1])
  const [measured, setMeasured] = useState(() => typeof document === 'undefined' || !document.fonts)

  useLayoutEffect(() => {
    const element = probe.current
    if (!element) { return }
    const measure = () => {
      const tallest = Math.max(0, ...[...element.children].map((card) => card.getBoundingClientRect().height))
      setHeight(Math.max(ARCHITECTURE_NODE_SIZE[1], Math.ceil(tallest)))
    }
    measure()
    const fonts = typeof document === 'undefined' ? undefined : document.fonts
    if (!fonts) { return }
    let live = true
    void fonts.ready.then(() => {
      if (!live) { return }
      measure()
      setMeasured(true)
    })
    fonts.addEventListener('loadingdone', measure)
    return () => {
      live = false
      fonts.removeEventListener('loadingdone', measure)
    }
  }, [nodes])

  return {
    height,
    measured,
    // Out of sight and out of the accessibility tree: measured, never read or reached.
    probe: (
      <div aria-hidden className={styles.probe} ref={probe}>
        {nodes.map(({ data, id }) => <ArchitectureCardProbe data={data} key={id} />)}
      </div>
    ),
  }
}
