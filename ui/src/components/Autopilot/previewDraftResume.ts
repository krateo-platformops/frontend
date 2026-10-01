/**
 * A PERSON resuming a stored draft — and the re-apply a resumed page asks for.
 *
 * WHY A BUS, AND NOT THE PAGE WRITING THE STORE. The held draft, the publish gate and the undo
 * history all live in the provider; the composers hold none of them and write only through buses
 * (Start is `onChartStart` / `onDraftStart`). A resume is a Start of a tree that already exists, so
 * it takes the same shape: the surface emits a request with a correlation id, the provider does the
 * work, and one result answers it.
 *
 * WHY THE PROVIDER DECIDES "a draft is already open", not the page. The page's copy of the held
 * draft is the last broadcast, which can be a frame behind; the store is the truth. So the first
 * request goes WITHOUT `replace`, and a held draft comes back as `held` — which is what shows the
 * replace prompt (screen 4). Only the person's "Close and resume" sends `replace: true`.
 *
 * REPLACING IS NOT DISCARDING. The draft that is closed is not deleted: it is saved in Your drafts,
 * which is the premise of the prompt's "closing it loses nothing". So a replace never goes through
 * `emitDraftClose` — that is Discard, and Discard deletes the record.
 */
import type { SandboxTarget } from './adoptLegacyPage'
import type { DraftKind } from './blueprintDraftStore'
import type { DraftRecordBody } from './draftRecord'

export const AUTOPILOT_DRAFT_RESUME_EVENT = 'autopilotDraftResume'
export const AUTOPILOT_DRAFT_RESUME_RESULT_EVENT = 'autopilotDraftResumeResult'
export const AUTOPILOT_DRAFT_REAPPLY_EVENT = 'autopilotDraftReapply'

export interface DraftResumeDetail {
  id: string
  record: DraftRecordBody
  /** The person confirmed closing the open draft (screen 4). Absent: a held draft is answered `held`. */
  replace?: boolean
  /**
   * Adopting a legacy page set: the sandbox objects it was rebuilt from, removed once the tree is
   * held — through the audited sandbox writer, the provider's. Absent for a record.
   */
  retire?: SandboxTarget[]
}

/**
 * What happened, for the surface that asked.
 *   resumed — held; Undo starts here. `previewed`: Publish is armed (the record's renderedHash is
 *             the restored tree's). `relinked`: the Autopilot thread it came from was found and
 *             switched to. `retireError`: an adoption held the tree but could not remove the old
 *             objects, and says why. `updated`: holding the record rewrote it to the current format
 *             (an unpublished controller's document pinned to v1alpha1) — said, never saved silently.
 *   held    — a draft is open; nothing changed. `held` names it for the replace prompt.
 *   refused — nothing changed, and `message` says why (the tree is over the draft cap).
 */
export type DraftResumeResultDetail =
  | { id: string; outcome: 'resumed'; previewed: boolean; relinked: boolean; retireError?: string; updated?: string }
  | { id: string; outcome: 'held'; held: { kind: DraftKind; name: string; previewed: boolean } }
  | { id: string; outcome: 'refused'; message: string }

/** Re-apply the held page's live preview — after a resume. `discardPrevious`: the draft it replaced had one. */
export interface DraftReapplyDetail {
  discardPrevious?: boolean
}

const on = <T>(event: string, accept: (detail: T) => boolean, handler: (detail: T) => void): (() => void) => {
  const listener = (raw: Event): void => {
    const { detail } = raw as CustomEvent<T>
    if (detail && accept(detail)) {
      handler(detail)
    }
  }
  window.addEventListener(event, listener)
  return () => window.removeEventListener(event, listener)
}

const hasId = (detail: { id?: unknown }): boolean => typeof detail.id === 'string'

export const emitDraftResume = (detail: DraftResumeDetail): void => {
  window.dispatchEvent(new CustomEvent<DraftResumeDetail>(AUTOPILOT_DRAFT_RESUME_EVENT, { detail }))
}
export const onDraftResume = (handler: (detail: DraftResumeDetail) => void): (() => void) =>
  on<DraftResumeDetail>(AUTOPILOT_DRAFT_RESUME_EVENT, (detail) => hasId(detail) && !!detail.record, handler)

export const emitDraftResumeResult = (detail: DraftResumeResultDetail): void => {
  window.dispatchEvent(new CustomEvent<DraftResumeResultDetail>(AUTOPILOT_DRAFT_RESUME_RESULT_EVENT, { detail }))
}
export const onDraftResumeResult = (handler: (detail: DraftResumeResultDetail) => void): (() => void) =>
  on<DraftResumeResultDetail>(AUTOPILOT_DRAFT_RESUME_RESULT_EVENT, hasId, handler)

export const emitDraftReapply = (detail: DraftReapplyDetail = {}): void => {
  window.dispatchEvent(new CustomEvent<DraftReapplyDetail>(AUTOPILOT_DRAFT_REAPPLY_EVENT, { detail }))
}
export const onDraftReapply = (handler: (detail: DraftReapplyDetail) => void): (() => void) =>
  on<DraftReapplyDetail>(AUTOPILOT_DRAFT_REAPPLY_EVENT, () => true, handler)

export const AUTOPILOT_LEGACY_DISCARD_EVENT = 'autopilotLegacyDiscard'
export const AUTOPILOT_LEGACY_DISCARD_RESULT_EVENT = 'autopilotLegacyDiscardResult'

/**
 * Delete a whole legacy page set — "Unowned drafts" Discard, a person's destructive choice. The
 * surface read the set (readLegacyPageSet); the provider deletes it through the audited sandbox
 * writer WITH the blast-radius confirm, which lists every object before anything is deleted.
 */
export interface LegacyDiscardDetail {
  id: string
  root: string
  targets: SandboxTarget[]
}

/**
 * deleted   — every object is gone.
 * cancelled — the person declined the confirm; nothing (more) was deleted.
 * failed    — a DELETE failed, or there is no sandbox writer; `message` says which objects are left.
 */
export interface LegacyDiscardResultDetail {
  id: string
  outcome: 'deleted' | 'cancelled' | 'failed'
  message: string
}

export const emitLegacyDiscard = (detail: LegacyDiscardDetail): void => {
  window.dispatchEvent(new CustomEvent<LegacyDiscardDetail>(AUTOPILOT_LEGACY_DISCARD_EVENT, { detail }))
}
export const onLegacyDiscard = (handler: (detail: LegacyDiscardDetail) => void): (() => void) =>
  on<LegacyDiscardDetail>(AUTOPILOT_LEGACY_DISCARD_EVENT, (detail) => hasId(detail) && Array.isArray(detail.targets), handler)

export const emitLegacyDiscardResult = (detail: LegacyDiscardResultDetail): void => {
  window.dispatchEvent(new CustomEvent<LegacyDiscardResultDetail>(AUTOPILOT_LEGACY_DISCARD_RESULT_EVENT, { detail }))
}
export const onLegacyDiscardResult = (handler: (detail: LegacyDiscardResultDetail) => void): (() => void) =>
  on<LegacyDiscardResultDetail>(AUTOPILOT_LEGACY_DISCARD_RESULT_EVENT, hasId, handler)
