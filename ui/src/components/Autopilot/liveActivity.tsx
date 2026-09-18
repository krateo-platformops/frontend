/**
 * WHAT IS HAPPENING WHILE YOU WAIT.
 *
 * The rail used to render evidence only once a turn had finished (`evidence && !streaming`), so a
 * long turn — a delegation that takes half a minute, a specialist running several tools — showed a
 * blinking caret and nothing else. The work was already being reported frame by frame; it simply
 * was not shown until it no longer mattered.
 *
 * Its own module rather than another block in AutopilotRail, which is already at the repo's
 * 500-code-line cap: this addition is what pushed it over, and the file is the wrong place to win
 * that argument.
 */
import styles from './AutopilotRail.module.css'
import type { EvidenceEntry } from './types'

/** running | done | failed — `failed` alone cannot say it, see EvidenceEntry.done. */
const activityState = (entry: EvidenceEntry): 'running' | 'done' | 'failed' => {
  if (entry.failed) {
    return 'failed'
  }
  return entry.done ? 'done' : 'running'
}

/** How the agent names what it is doing. A delegation is the interesting case: it is the specialist
 *  that is working, and saying "transfer_to_x" would name the mechanism rather than the fact. */
const activityLabel = (entry: EvidenceEntry): string =>
  (entry.agent ? `asking ${entry.agent}` : entry.tool)

/**
 * WHAT IS HAPPENING WHILE YOU WAIT.
 *
 * The rail used to render evidence only once a turn had finished (`evidence && !streaming`), so a
 * long turn — a delegation that takes half a minute, a specialist running several tools — showed a
 * blinking caret and nothing else. The work was already being reported frame by frame; it was
 * simply not being shown until it no longer mattered.
 *
 * Deliberately NOT the EvidencePanel. That is a post-hoc, collapsed "what it did", with copy and
 * nested sub-evidence — the wrong shape for a thing you glance at mid-answer. This is a short
 * ordered list of the last few steps, with the in-flight one still open.
 *
 * `aria-live="polite"` because someone who cannot see the strip has exactly the same question.
 */
export const LiveActivity = ({ evidence }: { evidence: EvidenceEntry[] }) => {
  // The last few, not all of them: during a long turn this grows without bound and the useful
  // answer is always "what is it doing NOW".
  const recent = evidence.slice(-4)
  if (!recent.length) {
    return null
  }
  return (
    <div aria-live='polite' className={styles.apLiveAct} data-testid='autopilot-live-activity'>
      {recent.map((entry) => (
        <div className={styles.apLiveActRow} data-state={activityState(entry)} key={entry.id}>
          <span className={styles.apLiveActMark} />
          <span className={styles.apEvTool}>{activityLabel(entry)}</span>
          {entry.request ? <span className={styles.apEvMeta}>{entry.request}</span> : null}
        </div>
      ))}
    </div>
  )
}
