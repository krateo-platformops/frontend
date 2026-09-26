/**
 * The BATCH counterpart of previewFileEdit / previewFileAdd / previewFileRemove: several files of the
 * held draft, written as ONE change or not at all.
 *
 * WHY A FOURTH BUS. One composer gesture can be several files. Placing a node writes its template
 * AND rewrites templates/architecture.yaml; accepting an edge rewrites the descriptor and every
 * template it re-gates. On the single-file buses that was one event per file — so a refusal of the
 * second left the first written (a node in the descriptor with no template, or the reverse), each
 * file took its own Undo step, and an add was never answered at all. A half-applied gesture is a
 * draft nobody drew.
 *
 * SO THE PROVIDER PLANS ALL OF IT BEFORE IT WRITES ANY OF IT (blueprintDraftStore.applyFiles): every
 * precondition is checked first, the byte cap is measured once over the result, and a refusal leaves
 * the held tree byte for byte as it was. An accepted batch is one Undo step and one announcement.
 *
 * `expect` IS WHAT MAKES A PLAN SAFE TO SEND. A surface computes its batch from the files it last
 * saw; if an agent's write or a hand edit landed in between, the plan is stale. It carries the bytes
 * each edited or removed path had when the plan read it, and the provider refuses the whole batch
 * when any of them moved — rather than overwrite a change the plan never saw.
 *
 * `kind` IS REQUIRED here, unlike on the older buses: a chart batch landing in a held PAGE (both hold
 * Chart.yaml and values.schema.json) is exactly the mistake a path alone cannot see.
 *
 * SYNCHRONOUS, like previewFileEdit: dispatchEvent runs every listener before it returns, so the
 * answer comes back from `emitFilesBatch` itself. Pure module: one event name, a dispatch/subscribe
 * pair. No React, no module state.
 */
import type { DraftKind } from './blueprintDraftStore'

export const AUTOPILOT_PREVIEW_FILES_BATCH_EVENT = 'autopilotPreviewFilesBatch'

/** One gesture's files. A path appears in at most one of add, edit and remove. */
export interface FilesBatchDetail {
  /** Required: a batch planned against the other kind of draft is refused. */
  kind: DraftKind
  /** Paths the draft must NOT hold yet. */
  add?: Record<string, string>
  /** Paths the draft MUST hold — their new bytes. */
  edit?: Record<string, string>
  /** Paths the draft MUST hold — dropped. */
  remove?: string[]
  /** The bytes each edited or removed path had when the plan read it. */
  expect?: Record<string, string>
}

/** The provider's answer: every path written, or nothing written and why (and where, when one path is the cause). */
export type FilesBatchOutcome = { ok: true; paths: string[] } | { ok: false; error: string; path?: string }

interface FilesBatchRequest extends FilesBatchDetail {
  respond?: (outcome: FilesBatchOutcome) => void
}

const isStringMap = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.values(value).every((entry) => typeof entry === 'string')

/** The shape a listener may trust. Anything else is not a batch, and is not delivered. */
const isBatch = (detail: FilesBatchRequest | null | undefined): detail is FilesBatchRequest =>
  !!detail
  && (detail.kind === 'blueprint' || detail.kind === 'page')
  && (detail.add === undefined || isStringMap(detail.add))
  && (detail.edit === undefined || isStringMap(detail.edit))
  && (detail.expect === undefined || isStringMap(detail.expect))
  && (detail.remove === undefined || (Array.isArray(detail.remove) && detail.remove.every((path) => typeof path === 'string')))

/**
 * Emit one gesture's files. Returns the provider's answer, or null when nothing answered — no
 * provider mounted — which a caller must read as "nothing was written".
 */
export const emitFilesBatch = (detail: FilesBatchDetail): FilesBatchOutcome | null => {
  const answer: { outcome: FilesBatchOutcome | null } = { outcome: null }
  const respond = (outcome: FilesBatchOutcome): void => {
    // The first answer is the provider's; a second subscriber cannot overrule it.
    answer.outcome ??= outcome
  }
  window.dispatchEvent(new CustomEvent<FilesBatchRequest>(AUTOPILOT_PREVIEW_FILES_BATCH_EVENT, { detail: { ...detail, respond } }))
  return answer.outcome
}

/**
 * Subscribe to batches. The handler gets the batch and a `respond` it may call once, synchronously.
 * Returns the unsubscribe fn (React effect cleanup).
 */
export const onFilesBatch = (handler: (detail: FilesBatchDetail, respond: (outcome: FilesBatchOutcome) => void) => void): (() => void) => {
  const listener = (event: Event): void => {
    const { detail } = event as CustomEvent<FilesBatchRequest | undefined>
    if (isBatch(detail)) {
      const { respond, ...batch } = detail
      handler(batch, respond ?? (() => undefined))
    }
  }
  window.addEventListener(AUTOPILOT_PREVIEW_FILES_BATCH_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_PREVIEW_FILES_BATCH_EVENT, listener)
}
