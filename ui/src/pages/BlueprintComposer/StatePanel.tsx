/**
 * The selected state, in words — the side panel of mockup screen 8.
 *
 * The canvas lights the machine; this says what the light means: what RENDERS in the state, what
 * ENTERS in it, what is WITHHELD, and what has to become true to LEAVE it. All of it is the
 * stepper model's (`stepperModel`), which derives it from the same edges the graph draws, so the
 * panel and the picture cannot disagree.
 *
 * SHIMS ARE SEPARATE. A `lifecycle` resource is outside the sequence — it renders while a legacy
 * reference exists, whatever the state — so it is listed apart rather than counted as rendering
 * in S1 or withheld until S4, either of which would be a claim about the machine that is false.
 */
import type { ChartArchitecture } from './architecture'
import { counted, describeLeave, type ArchitectureView } from './architectureView'
import styles from './BlueprintComposer.module.css'
import type { StepperModel } from './stepperModel'

/** Why there is no machine to show, per shape of the architecture file. */
const NO_MACHINE: Record<Exclude<ArchitectureView['status'], 'ok'>, string> = {
  absent: 'No states to step — the chart has no architecture file.',
  cycle: 'No states to step — the dependencies form a cycle, and a chart with a cycle never leaves its first state.',
  invalid: 'No states to step — the architecture file has problems to fix first.',
  unreadable: 'No states to step — the architecture file carries no descriptor.',
}

/** A resource as a list names it: its id, and ×N when one card stands for every item of a forEach. */
const named = (architecture: ChartArchitecture, ids: string[]): string =>
  ids.map((id) => (architecture.resources.find((node) => node.id === id)?.forEach ? `${id} ×N` : id)).join(' · ')

/** "nothing — everything renders" is true of a last state, and a strange thing to say of an empty chart. */
const withheldText = (architecture: ChartArchitecture, model: StepperModel): string => {
  if (model.withheld.length) {
    return named(architecture, model.withheld)
  }
  return model.initial ? 'nothing' : 'nothing — everything renders'
}

const Field = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <div className={styles.field}>
    <span className={styles.eyebrow}>{label}</span>
    {children}
  </div>
)

export const StatePanel = ({ model, view }: { model: StepperModel | null; view: ArchitectureView }) => {
  if (view.status !== 'ok' || !model) {
    return (
      <section aria-label='State' className={styles.pane}>
        <div className={styles.paneHead}><span className={styles.paneTitle}>State</span></div>
        <div className={styles.section}>
          <p className={styles.fieldText}>{view.status === 'ok' ? NO_MACHINE.invalid : NO_MACHINE[view.status]}</p>
        </div>
      </section>
    )
  }
  const { architecture } = view
  const shims = architecture.resources.filter((node) => node.lifecycle)
  let leaves: React.ReactNode
  if (model.initial) {
    leaves = <span className={styles.fieldText}>Nothing yet — the chart has no resources in its sequence.</span>
  } else if (model.level === model.total - 1) {
    leaves = <span className={styles.fieldText}>This is the last state: nothing waits on it.</span>
  } else if (!model.leavesWhen.length) {
    leaves = (
      <span className={styles.fieldText}>
        {`On the next reconcile once these exist — the edges into S${model.level + 2} wait for existence, not readiness.`}
      </span>
    )
  } else {
    leaves = (
      <ul className={styles.plainList}>
        {model.leavesWhen.map((condition) => (
          <li className={styles.fieldValue} key={`${condition.from}->${condition.to}`}>{describeLeave(condition)}</li>
        ))}
      </ul>
    )
  }

  return (
    <section aria-label='State' className={styles.pane}>
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>{`State ${model.label}`}</span>
        {model.name ? <span className={styles.countPill}>{model.name}</span> : null}
        <span className={styles.spacer} />
        <span className={styles.fieldText}>{`of ${counted(model.total, 'state')}`}</span>
      </div>
      <div className={styles.section} data-testid='state-panel'>
        <Field label='Renders'>
          <span className={styles.fieldValue}>{model.lit.length ? named(architecture, model.lit) : 'nothing yet'}</span>
        </Field>
        {model.frontier.length && !model.initial ? (
          <Field label='Enters in this state'>
            <span className={styles.fieldValue}>{named(architecture, model.frontier)}</span>
          </Field>
        ) : null}
        <Field label='Withheld'>
          <span className={styles.fieldValue}>{withheldText(architecture, model)}</span>
        </Field>
        <Field label='Leaves when'>{leaves}</Field>
        {shims.length ? (
          <Field label='Outside the sequence'>
            <ul className={styles.plainList}>
              {shims.map((node) => (
                <li className={styles.fieldText} key={node.id}>
                  <span className={styles.fieldValue}>{node.id}</span>
                  {node.lifecycle === 'shim'
                    ? ' — a shim: renders while a legacy reference exists, then goes on its own.'
                    : ' — the descriptor itself, in no state.'}
                </li>
              ))}
            </ul>
          </Field>
        ) : null}
      </div>
    </section>
  )
}

export default StatePanel
