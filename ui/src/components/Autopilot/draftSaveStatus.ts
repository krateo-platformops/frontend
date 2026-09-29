/**
 * Whether the held draft's RECORD is saved — the one fact the composer header says about autosave.
 *
 * WHY MODULE STATE. The autosave lives in the provider (it hangs off the held-draft store), and the
 * composers are routes that do not sit under the provider's context. A tiny external store read
 * through useSyncExternalStore reaches both without threading a prop through the router, and it
 * survives a provider remount the same way the conversation store does.
 *
 * NEVER SILENT. A save that failed is `error` with the apiserver's reason, and stays that way until
 * a later save lands — "Saved" is shown only for a write that answered 2xx. `off` (no sandbox is
 * configured, so there is nowhere to save) shows nothing at all: autosave being unavailable is the
 * install's shape, not a fault of this draft.
 */
import { useSyncExternalStore } from 'react'

import type { DraftKind } from './blueprintDraftStore'

export type DraftSavePhase = 'off' | 'idle' | 'saving' | 'saved' | 'error'

export interface DraftSaveStatus {
  phase: DraftSavePhase
  /** The kind of the draft the phase is about — a composer shows only its own kind's status. */
  kind?: DraftKind
  /** RFC 3339 time of the last save that landed (phase `saved`). */
  savedAt?: string
  /** Why the last save did not land (phase `error`). */
  reason?: string
}

const INITIAL: DraftSaveStatus = { phase: 'off' }

let current: DraftSaveStatus = INITIAL
const listeners = new Set<() => void>()

export const draftSaveStatus = {
  get: (): DraftSaveStatus => current,
  /** Tests only: module state outlives a test. */
  reset: (): void => {
    current = INITIAL
    listeners.forEach((listener) => listener())
  },
  set: (next: DraftSaveStatus): void => {
    current = next
    listeners.forEach((listener) => listener())
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
}

export const useDraftSaveStatus = (): DraftSaveStatus =>
  useSyncExternalStore(draftSaveStatus.subscribe, draftSaveStatus.get)

/**
 * Whether closing the held draft of `kind` leaves it stored. A close writes any pending save before
 * the draft goes (useDraftAutosave), so a record that is saving, saved, or about to be is kept;
 * `off` (no sandbox) and `error` (the last save failed) mean the close loses the files, and the
 * composer's confirm must still say so.
 */
export const draftKeptOnClose = (status: DraftSaveStatus, kind: DraftKind): boolean =>
  status.kind === kind && (status.phase === 'idle' || status.phase === 'saving' || status.phase === 'saved')
