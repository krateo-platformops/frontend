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
 * Measured before paint (a layout effect), so a graph created after it is laid out at the right
 * height the first time; and again when the fonts finish loading, because a name set in the fallback
 * face wraps differently. Never under 84px (ARCHITECTURE_NODE_SIZE). jsdom lays nothing out: every
 * card measures 0, and the height stays 84.
 *
 * `nodes` must be stable (memoised): a new array is a new measure.
 */
export const useArchitectureCardHeight = (nodes: readonly GraphNode<FlowChartNodeData>[]): { height: number; probe: ReactNode } => {
  const probe = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(ARCHITECTURE_NODE_SIZE[1])

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
      if (live) { measure() }
    })
    fonts.addEventListener('loadingdone', measure)
    return () => {
      live = false
      fonts.removeEventListener('loadingdone', measure)
    }
  }, [nodes])

  return {
    height,
    // Out of sight and out of the accessibility tree: measured, never read or reached.
    probe: (
      <div aria-hidden className={styles.probe} ref={probe}>
        {nodes.map(({ data, id }) => <ArchitectureCardProbe data={data} key={id} />)}
      </div>
    ),
  }
}
