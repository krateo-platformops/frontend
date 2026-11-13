/**
 * One node of FlowChart's `architecture` variant: a resource the chart declares, in the state the
 * composition is in. Three lines, as on the composer's card (ArchitectureNodeCard): what it is (the
 * kind, ×N for a forEach), what it is called (the resolved name, or the first … last of a range),
 * and the detail the RESTAction wrote (the readiness field and its value, a count, what it waits for,
 * or why it cannot be read).
 *
 * NOT A BUTTON. The composer's card selects a node for its inspector; this one has nothing to do
 * when clicked, so it is a labelled group and nothing about it looks pressable (P12).
 *
 * BUT IT TAKES FOCUS (tabIndex 0), because the graph is drawn at true size and a chart of four
 * columns is 1360px wide in a box that is often narrower. A pointer drags the rest into view; a
 * keyboard has only focus, and DependencyGraph pans a focused card into view on either side. With
 * nothing focusable in the box, Tab skipped it and the clipped columns could not be seen at all
 * (WCAG 2.1.1). Focus is also how the exception's reason and message are read without a mouse:
 * the tooltip that hover opens, keyboard focus opens too, and Escape closes it where focus stays
 * (1.4.13).
 *
 * The state is drawn by the stylesheet, keyed on `data-state`, and said in the accessible name,
 * because colour is never the only signal (G12).
 *
 * THE NAME IS SHOWN IN FULL on the regular card. A composition's Topology draws one node per
 * resource with its full name (portal#427: `publish-bp-v2-20261002-1-000` … `-007`), and it is the
 * END of the name that tells the resources apart, so cutting it with an ellipsis hid exactly what
 * the node is for. The name wraps instead: a break may fall after any hyphen or dot (the separators
 * of a Kubernetes name, `<wbr>`), and `overflow-wrap: anywhere` is the last resort for one token
 * longer than the line. No line cap: the card is as tall as its lines need, 84px at least, and
 * FlowChart reserves the tallest card's height for every card (`height`), so a taller card never
 * runs into the one under it.
 *
 * COMPACT (`density='compact'`, 180×56): for a narrow box. Two lines, not three: the name, which
 * wraps to a second line (at the same break points) and is then cut with an ellipsis, and the detail. The kind line goes — it
 * stays in the accessible name and leads the name's tooltip — and the exception is the dot alone,
 * in the card's top-right corner, since a chip with the condition's name would take a third of the
 * width. The dot keeps its tooltip, opened by hover and by keyboard focus as on the regular card,
 * and the condition stays in the accessible name. The state treatments (border, dashes, muting) are
 * the regular card's, unchanged.
 */
import { Tooltip } from 'antd'
import { Fragment, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'

import { architectureNodeLabel, architectureState, architectureTitle, exceptionText } from '../architectureVariant'
import type { ArchitectureDensity } from '../architectureVariant'
import type { FlowChartNodeData } from '../FlowChart'

import styles from './ArchitectureStateNode.module.css'

/**
 * The name with a line-break opportunity after every hyphen and dot. A browser breaks after a hyphen
 * only before a letter (UAX #14 keeps `-20261002` and `-000` whole, as if they were negative
 * numbers), so `publish-bp-v2-20261002-1-000` could break in two places only. `<wbr>` adds no
 * character: the text, its copy and its accessible name are the name as the chart sent it.
 */
export const breakableName = (name: string): ReactNode =>
  name.split(/(?<=[-.])/).map((part, index) => (
    <Fragment key={index}>{index > 0 ? <wbr /> : null}{part}</Fragment>
  ))

/**
 * The card's lines: what the card shows and what FlowChart's probe measures (`ArchitectureCardProbe`),
 * from one source so the two cannot drift.
 */
const Lines = ({ compact, data, marker }: { compact: boolean; data: FlowChartNodeData; marker: ReactNode }) => {
  const { detail, kind, name, names, version } = data
  const title = architectureTitle(names, name, version)
  return (
    <>
      {compact
        ? marker
        : (
          <span className={styles.eyebrow}>
            <span className={styles.kind} title={version ? `${kind} · ${version}` : kind}>{kind}</span>
            {marker}
          </span>
        )}
      {/* portal#311: `name` is a DISPLAY string the RESTAction already shortened, so a title of
          `name` repeated the elision and the full value was reachable nowhere. `names` carries the
          real ones; where a chart predates portal 1.8.74 it is absent and `name` stands in, which is
          exactly today's behaviour. */}
      <span className={styles.name} title={compact ? `${kind}\n${title}` : title}>{breakableName(name)}</span>
      {detail ? <span className={styles.detail} title={detail}>{detail}</span> : null}
    </>
  )
}

/** The exception marker's own markup: the dot, and on the regular card the condition's name. */
const Marker = ({ compact, label }: { compact: boolean; label: string }) => (
  <>
    <span aria-hidden className={styles.dot} />
    {compact ? null : label}
  </>
)

/**
 * A regular card as tall as its lines need, for FlowChart to measure: the card's own lines and
 * stylesheet, without what makes it a control (no role, no focus, no tooltip, no test id). FlowChart
 * draws these out of sight and reserves the tallest one's height for every card.
 */
export const ArchitectureCardProbe = ({ data }: { data: FlowChartNodeData }) => (
  <div className={styles.card} data-state={architectureState(data.state)}>
    <Lines
      compact={false}
      data={data}
      marker={data.exception ? <span className={styles.exception}><Marker compact={false} label={data.exception.label} /></span> : null}
    />
  </div>
)

interface ArchitectureStateNodeProps {
  data: FlowChartNodeData
  density?: ArchitectureDensity
  /**
   * The regular card's height, px: the box the graph reserves for it, which is the tallest card's
   * (FlowChart measures it). Absent — a card drawn on its own — it is as tall as its lines need,
   * 84px at least. The compact card is always 56px.
   */
  height?: number
}

const ArchitectureStateNode = ({ data, density = 'regular', height }: ArchitectureStateNodeProps) => {
  const compact = density === 'compact'
  const { exception } = data
  // Who opened the exception's tooltip: focus on the card, or the pointer on the marker.
  const [byFocus, setByFocus] = useState(false)
  const [byHover, setByHover] = useState(false)
  const open = byFocus || byHover

  // Keyboard focus only. A click focuses the card too, but the pointer's hover has already opened the
  // tooltip, and one opened by the click's focus would stay open after the pointer left.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => setByFocus(event.currentTarget.matches(':focus-visible'))

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setByFocus(false)
      setByHover(false)
    }
  }

  const marker = exception
    ? (
      <Tooltip onOpenChange={setByHover} open={open} title={exceptionText(exception)}>
        <span className={compact ? styles.corner : styles.exception} data-testid='architecture-exception'>
          <Marker compact={compact} label={exception.label} />
        </span>
      </Tooltip>
    )
    : null

  return (
    // C8 exception: a focusable group that discloses its details on focus and closes them on Escape.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      aria-label={architectureNodeLabel(data)}
      className={styles.card}
      data-density={compact ? 'compact' : undefined}
      data-state={architectureState(data.state)}
      onBlur={() => setByFocus(false)}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      role='group'
      style={!compact && height ? { height } : undefined}
      tabIndex={0}
    >
      <Lines compact={compact} data={data} marker={marker} />
    </div>
  )
}

export default ArchitectureStateNode
