/**
 * One resource on the architecture canvas — the 156×72 card of mockup screens 5 and 8.
 *
 * THREE LINES AND NOTHING ELSE, because 72px holds three: the kind and its API group (what it is),
 * the descriptor id (what the chart calls it), and the class pill (what supplies its readiness when
 * `readyWhen` is omitted — native, custom, composition). What the machine is DOING to the node in
 * the selected state is drawn by the card's border and opacity, not by more text.
 *
 * ITS STATES ARE G6's. The card is rendered in its own React root by G6 (no context reaches it —
 * only the props of this call), and it re-renders when the composer calls `setElementState` on the
 * live graph: stepping the machine redraws the cards where they stand, with no layout pass. So
 * `node.states` is the one input for how the card looks in a state, and the styles for each state
 * live in the stylesheet keyed on `data-states`.
 *
 * A REAL BUTTON. G6's `node:click` answers a pointer; a keyboard has no pointer, and G6 hit-tests a
 * forwarded click at its coordinates. So the card is a <button> that selects through the closure
 * the composer passes in, and Enter or Space on a focused card does exactly what a click does.
 */
import type { GraphNode } from '../../components/DependencyGraph'

import styles from './ArchitectureCanvas.module.css'
import type { ArchitectureNodeData } from './architectureGraph'
import { apiGroup } from './architectureView'

/** [width, height] — the card's CSS box, and so what dagre reserves per node (C19). */
export const NODE_SIZE: [number, number] = [156, 72]

/** What each state means, said aloud: the card's accessible name carries it, not its colour. */
const STATE_WORDS: Record<string, string> = {
  cycle: 'part of a dependency cycle',
  frontier: 'enters in this state',
  lit: 'renders in this state',
  orthogonal: 'outside the sequence',
  withheld: 'withheld until a later state',
}

const CLASS_STYLE: Record<ArchitectureNodeData['resource']['class'], string | undefined> = {
  composition: styles.classComposition,
  custom: styles.classCustom,
  native: styles.classNative,
}

export const ArchitectureNodeCard = ({ node, onSelect }: {
  node: GraphNode<ArchitectureNodeData>
  onSelect: (id: string) => void
}) => {
  const { resource } = node.data
  const states = node.states ?? []
  const said = states.map((state) => STATE_WORDS[state]).filter(Boolean)
  const markers = [resource.lifecycle, resource.when ? 'optional' : null].filter((marker): marker is string => !!marker)
  return (
    <button
      aria-label={[`${node.id}, a ${resource.kind} (${resource.class})`, ...said].join(', ')}
      aria-pressed={states.includes('selected')}
      className={styles.card}
      data-optional={resource.when ? 'true' : undefined}
      data-states={states.join(' ')}
      data-testid={`node-card-${node.id}`}
      onClick={() => onSelect(node.id)}
      // The eyebrow truncates at 156px ("REPOSITORY · GITHU…"); the full kind and version on hover.
      title={`${resource.kind} · ${resource.apiVersion}`}
      type='button'
    >
      <span className={styles.cardEyebrow}>{`${resource.kind} · ${apiGroup(resource.apiVersion)}`}</span>
      <span className={styles.cardId}>
        {node.id}
        {/* One card stands for every item of a forEach — the ×N says so without a count it cannot know. */}
        {resource.forEach ? <span className={styles.cardEach}>×N</span> : null}
      </span>
      <span className={styles.cardPills}>
        <span className={`${styles.classPill} ${CLASS_STYLE[resource.class] ?? ''}`}>{resource.class}</span>
        {markers.map((marker) => <span className={styles.classPill} key={marker}>{marker}</span>)}
      </span>
    </button>
  )
}

export default ArchitectureNodeCard
