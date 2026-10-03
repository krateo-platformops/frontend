/**
 * The verdict envelope validate_draft returns — the same shape as core-provider-agent's
 * validate_chart (`{ok, failedStep, steps[]}`), so an agent's retry loop has one branch whichever
 * builder it authors for, plus the coverage report the live dry-run produces.
 */

/** One step's verdict. `problems` fail the step; `notes` never do. */
export interface StepResult {
  name: string
  ok: boolean
  problems: string[]
  notes: string[]
}

/** What the live API server judged, object by object (the live-dry-run step's classification). */
export type DryRunVerdict = 'validated' | 'rejected' | 'notChecked'

export interface ObjectVerdict {
  /** `widgets[i] (Kind/name)` — the same label every lint line carries. */
  object: string
  /** `<plural>/<name>` */
  resource: string
  verdict: DryRunVerdict
  /** The API server's own message (rejected), or why it was not judged (notChecked). */
  detail?: string
}

export interface Coverage {
  objects: number
  validated: number
  rejected: number
  notChecked: number
  /** One sentence: "API server accepted all N objects", or what it did not. */
  summary: string
  verdicts: ObjectVerdict[]
}

export interface Envelope {
  ok: boolean
  /** The first step that failed; null when every step passed. */
  failedStep: string | null
  /** The steps that ran, in order. Steps after a failure did not run. */
  steps: StepResult[]
  /** Null when the live dry-run did not run (an earlier step failed). */
  coverage: Coverage | null
}

export const step = (name: string, problems: string[] = [], notes: string[] = []): StepResult =>
  ({ name, ok: problems.length === 0, problems, notes })
