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
 */
import { Tooltip } from 'antd'
import { useState, type FocusEvent, type KeyboardEvent } from 'react'

import { architectureNodeLabel, architectureState, exceptionText } from '../architectureVariant'
import type { FlowChartNodeData } from '../FlowChart'

import styles from './ArchitectureStateNode.module.css'

const ArchitectureStateNode = ({ data }: { data: FlowChartNodeData }) => {
  const { detail, exception, kind, name } = data
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

  return (
    <div
      aria-label={architectureNodeLabel(data)}
      className={styles.card}
      data-state={architectureState(data.state)}
      onBlur={() => setByFocus(false)}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      role='group'
      tabIndex={0}
    >
      <span className={styles.eyebrow}>
        <span className={styles.kind} title={kind}>{kind}</span>
        {exception
          ? (
            <Tooltip onOpenChange={setByHover} open={open} title={exceptionText(exception)}>
              <span className={styles.exception} data-testid='architecture-exception'>
                <span aria-hidden className={styles.dot} />
                {exception.label}
              </span>
            </Tooltip>
          )
          : null}
      </span>
      <span className={styles.name} title={name}>{name}</span>
      {detail ? <span className={styles.detail} title={detail}>{detail}</span> : null}
    </div>
  )
}

export default ArchitectureStateNode
