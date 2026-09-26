/**
 * The edge inspector — mockup screens 6 and 7: the pending edge the person is about to accept, and,
 * once accepted, what that did to the chart.
 *
 * ONE SWITCH AND ONE PICKER (06:81-96). "Wait for readiness" is on by default: the dependent waits
 * for its dependency to be READY, as the target declares it — off, it only has to exist. "Ready when"
 * lists what the target can be waited on for, from the cluster (readinessOptions): a custom
 * resource's own status fields, a composition's Ready and Synced, a native kind's kstatus meaning.
 * Arrow keys move through it (a radio group); nothing is guessed, and a target with nothing to offer
 * says why.
 *
 * `readyWhen` BELONGS TO THE TARGET (D18): a choice that changes it re-gates every other dependent
 * waiting on that node, and the inspector names them before Accept.
 *
 * THE KERNEL RUNS LIVE. Every answer is planned (planEdge) as it is given; a refusal is said in the
 * red box and Accept is off, with the reason as its description. A refusal from the provider on Accept
 * lands in the same box, and nothing is written.
 *
 * WHAT JUST HAPPENED (07:109-118): the dependent's entry in the descriptor as it is now, one sentence
 * per template rewritten, and the standing note on hand-written gates. Neutral — an account, not a
 * status (indicators are exception-only).
 */
import { Button, Radio, Switch } from 'antd'
import { useEffect, useId, useRef, useState } from 'react'

import type { ResourceNode } from './architecture'
import { counted } from './architectureView'
import styles from './BlueprintComposer.module.css'
import type { EdgeOp, EdgePlan } from './planEdge'
import { readinessOptions, type StatusRead } from './readinessOptions'
import type { AcceptedEdge, PendingEdge } from './useEdgeEditing'

const Field = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <div className={styles.field}>
    <span className={styles.eyebrow}>{label}</span>
    {children}
  </div>
)

/** The op a pending edge's answers make: `readyWhen` only when the choice changes what the target holds. */
export const pendingOp = (pending: PendingEdge, target: ResourceNode, ready: boolean, choice: string | null): EdgeOp => {
  const op: EdgeOp = { from: pending.from, op: 'add', ready, to: pending.to }
  if (ready && choice !== null && choice !== (target.readyWhen ?? '')) {
    op.readyWhen = choice === '' ? null : choice
  }
  return op
}

export interface PendingEdgeInspectorProps {
  pending: PendingEdge
  /** The dependency, as the descriptor holds it. */
  target: ResourceNode
  /** Its status schema, as read (useStatusFields). */
  status: StatusRead
  /** The kernel, live. */
  plan: (op: EdgeOp) => EdgePlan
  /** Accept: the error in words when nothing was written. */
  onAccept: (op: EdgeOp) => string | null
  onCancel: () => void
}

export const PendingEdgeInspector = ({ onAccept, onCancel, pending, plan, status, target }: PendingEdgeInspectorProps) => {
  // The keyboard's route here unmounts the Select it came from: focus lands on the first question.
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  const [ready, setReady] = useState(true)
  // Null until the person picks: the suggestion (which may arrive with the CRD read) stands till then.
  const [picked, setPicked] = useState<string | null>(null)
  const [providerError, setProviderError] = useState<string | null>(null)
  const refusalId = useId()
  const choices = readinessOptions(target, status)
  const choice = picked ?? choices.suggested
  const op = pendingOp(pending, target, ready, choice)
  const planned = plan(op)
  const refusal = providerError ?? (planned.ok ? null : planned.reason)
  const regated = planned.ok ? planned.regated : []
  const accept = () => setProviderError(onAccept(op))
  return (
    <section aria-label='Inspector' className={styles.pane}>
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>Inspector</span>
        <span className={styles.countPill}>edge</span>
      </div>
      <div className={styles.section} data-testid='edge-inspector'>
        <Field label='Dependency'>
          <span className={styles.fieldValue}>{`${pending.from} → ${pending.to}`}</span>
        </Field>
        <div className={styles.switchRow}>
          <div>
            <div className={styles.switchLabel}>Wait for readiness</div>
            <div className={styles.fieldText}>off = it only has to exist</div>
          </div>
          <Switch aria-label='Wait for readiness' checked={ready} onChange={(next) => { setReady(next); setProviderError(null) }} ref={first} />
        </div>
        {target.forEach ? <p className={styles.fieldText}>{`Waits for every item — ${target.id} is one per item of ${target.forEach}.`}</p> : null}
        {ready ? (
          <Field label={`Ready when · from ${target.kind}'s ${target.class === 'native' ? 'kind' : 'status schema'}`}>
            {choices.options.length ? (
              <Radio.Group
                aria-label='Ready when'
                className={styles.readyOptions}
                onChange={(event) => { setPicked(String(event.target.value)); setProviderError(null) }}
                value={choice ?? undefined}
              >
                {choices.options.map((option) => (
                  <Radio className={styles.readyOption} key={option.value} value={option.value}>
                    <span className={styles.mono}>{option.label}</span>
                    <span className={styles.readyHint}>{option.hint}</span>
                  </Radio>
                ))}
              </Radio.Group>
            ) : null}
            {choices.sentence ? <span className={styles.fieldText} role='status'>{choices.sentence}</span> : null}
            {choices.note ? <span className={styles.fieldText}>{choices.note}</span> : null}
          </Field>
        ) : null}
        {regated.length ? (
          <p className={styles.note} data-testid='regate-warning'>
            {`This also changes what ${regated.join(', ')} ${regated.length === 1 ? 'waits' : 'wait'} for — readyWhen belongs to ${pending.to}, not to one edge.`}
          </p>
        ) : null}
        {refusal ? (
          <div className={styles.schemaRefusal} id={refusalId} role='alert'>{refusal}</div>
        ) : null}
        <div className={styles.edgeActions}>
          <Button aria-describedby={refusal ? refusalId : undefined} disabled={!planned.ok} onClick={accept} type='primary'>Accept edge</Button>
          <Button onClick={onCancel} type='link'>Cancel</Button>
        </div>
      </div>
    </section>
  )
}

/** The canvas head while an edge is drawn (06:60), or once one is accepted — a NEUTRAL count (D7). */
export const edgeHead = ({ accepted, drawing, pending }: { accepted: AcceptedEdge | null; drawing: { source: string } | null; pending: PendingEdge | null }): React.ReactNode => {
  if (pending || drawing) {
    return <span className={`${styles.eyebrow} ${styles.eyebrowActive}`}>{`Drawing: ${pending?.from ?? drawing?.source} → ${pending?.to ?? '…'}`}</span>
  }
  return accepted ? (
    <>
      <span className={styles.eyebrow}>Edge accepted</span>
      <span className={styles.countPill}>{`${counted(accepted.rewritten, 'file')} rewritten`}</span>
    </>
  ) : null
}

/** A drop the kernel refused — said where the person looks next, until they move on. */
export const RefusedMoment = ({ onDismiss, reason }: { reason: string; onDismiss: () => void }) => (
  <div className={styles.schemaRefusal} data-testid='refused-moment' role='alert'>
    <strong>Refused a moment ago</strong>
    <div>{reason}</div>
    <Button className={styles.inlineAction} onClick={onDismiss} size='small' type='link'>Dismiss</Button>
  </div>
)

export const WhatJustHappened = ({ edge, onDone }: { edge: AcceptedEdge; onDone: () => void }) => {
  // Accept unmounted the pending inspector it was pressed in: focus lands on the account of it.
  const done = useRef<HTMLButtonElement>(null)
  useEffect(() => { done.current?.focus() }, [])
  return (
    <section aria-label='What just happened' className={styles.pane}>
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>What just happened</span>
        <span className={styles.spacer} />
        <Button onClick={onDone} ref={done} size='small' type='link'>Done</Button>
      </div>
      <div className={styles.section} data-testid='what-just-happened'>
        <Field label='templates/architecture.yaml'>
          <pre className={styles.entry}>{edge.entry}</pre>
        </Field>
        {edge.lines.map((line) => (
          <Field key={line.path} label={line.path}>
            <span className={styles.fieldText}>{line.text}</span>
          </Field>
        ))}
        <p className={styles.note}>
          A hand-written <code>lookup</code> outside a marked block is left alone and flagged in the Source tab as an
          unmanaged gate, so a migrated chart keeps working while it is being described.
        </p>
      </div>
    </section>
  )
}
