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
 * COMPACT (`density='compact'`, 180×56): for a narrow box. Two lines, not three: the name, which
 * wraps to a second line and is then cut with an ellipsis, and the detail. The kind line goes — it
 * stays in the accessible name and leads the name's tooltip — and the exception is the dot alone,
 * in the card's top-right corner, since a chip with the condition's name would take a third of the
 * width. The dot keeps its tooltip, opened by hover and by keyboard focus as on the regular card,
 * and the condition stays in the accessible name. The state treatments (border, dashes, muting) are
 * the regular card's, unchanged.
 */
import { Tooltip } from 'antd'
import { useState, type FocusEvent, type KeyboardEvent } from 'react'

import { architectureNodeLabel, architectureState, architectureTitle, exceptionText } from '../architectureVariant'
import type { ArchitectureDensity } from '../architectureVariant'
import type { FlowChartNodeData } from '../FlowChart'

import styles from './ArchitectureStateNode.module.css'

const ArchitectureStateNode = ({ data, density = 'regular' }: { data: FlowChartNodeData; density?: ArchitectureDensity }) => {
  const compact = density === 'compact'
  const { detail, exception, kind, name, names, version } = data
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
          <span aria-hidden className={styles.dot} />
          {compact ? null : exception.label}
        </span>
      </Tooltip>
    )
    : null

  const title = architectureTitle(names, name, version)

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
      tabIndex={0}
    >
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
      <span className={styles.name} title={compact ? `${kind}\n${title}` : title}>{name}</span>
      {detail ? <span className={styles.detail} title={detail}>{detail}</span> : null}
    </div>
  )
}

export default ArchitectureStateNode
