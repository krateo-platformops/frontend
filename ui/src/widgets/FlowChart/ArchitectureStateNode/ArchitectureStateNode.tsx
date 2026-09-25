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
 * The state is drawn by the stylesheet, keyed on `data-state`, and said in the accessible name,
 * because colour is never the only signal (G12).
 */
import { Tooltip } from 'antd'

import { architectureNodeLabel, architectureState, exceptionText } from '../architectureVariant'
import type { FlowChartNodeData } from '../FlowChart'

import styles from './ArchitectureStateNode.module.css'

const ArchitectureStateNode = ({ data }: { data: FlowChartNodeData }) => {
  const { detail, exception, kind, name } = data

  return (
    <div aria-label={architectureNodeLabel(data)} className={styles.card} data-state={architectureState(data.state)} role='group'>
      <span className={styles.eyebrow}>
        <span className={styles.kind} title={kind}>{kind}</span>
        {exception
          ? (
            <Tooltip title={exceptionText(exception)}>
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
