/**
 * Agentiko COMPOSER DRAFT STORE — the rail's textarea draft plus the one thing the
 * draft alone cannot tell you: WHERE THE WORDS CAME FROM.
 *
 * WHY THIS EXISTS (two reasons, one store):
 *
 * 1. REMOUNT SURVIVAL. The draft used to live in `AgentikoRail`'s `useState`. The rail
 *    hangs under `<RouterProvider key={routerVersion}>` (App.tsx), so a routes-as-data
 *    reload remounts it and resets every `useState` — silently wiping a half-written
 *    question. Same failure the transcript had, same fix: a module-level singleton read
 *    through `useSyncExternalStore` (see conversationStore.ts's header for the full story).
 *
 * 2. PROVENANCE, for speak-back. Agentiko speaks an answer back ONLY when the question
 *    was asked BY VOICE — concretely, when the composer text was composed PURELY of
 *    dictated segments with no manual typing mixed in. That is a property of HOW the
 *    draft was built, not of the string itself: "scale payments to three" is
 *    indistinguishable from the same sentence typed. So it is MODELLED EXPLICITLY here
 *    (`provenance`) rather than inferred later, and it travels with the draft through the
 *    remount for the same reason the text does — a remount mid-compose must not silently
 *    downgrade a dictated draft to a typed one (or, worse, upgrade a typed one).
 *
 * THE PROVENANCE LATTICE (deliberately one-way, and deliberately conservative):
 *
 *     empty ──appendDictatedSegment──► dictated ──setTypedDraft──► typed
 *       │                                                            ▲
 *       └────────────────── setTypedDraft ───────────────────────────┘
 *
 *   - `dictated` survives further dictation and nothing else.
 *   - ANY keyboard edit (a keystroke, a deletion, a paste — every one of them arrives as
 *     the textarea's onChange) moves the draft to `typed` and it never moves back. One
 *     typed character is enough: the trigger is "purely dictated", not "mostly dictated".
 *   - Emptying the draft returns it to `empty`, so the NEXT draft starts clean: a typed
 *     question that was deleted must not poison a subsequent dictated one.
 *
 * DICTATION NOW USES THIS SEAM. `voice/voiceStore.ts` calls `appendDictatedSegment` with
 * each validated transcript and calls nothing else here — no DOM mutation of the textarea,
 * which is what keeps the composer's OpenAPI paste capture from seeing a transcript as a
 * pasted document. It remains the ONLY way words enter the draft other than the textarea's
 * own `onChange`, which is what makes the lattice above decidable rather than guessed.
 *
 * NOT PERSISTED to localStorage, on purpose: a draft is in-flight user speech/typing, and
 * the voice spec (FR 39) allows only the transcript and the speak-back preference on disk.
 * A module singleton survives the remount; a page reload legitimately starts fresh.
 *
 * No React imports here (pure store); the rail adapts it via useSyncExternalStore.
 */

import type { TurnModality } from './types'

/** How the words currently in the composer got there. See the lattice above. */
export type DraftProvenance = 'empty' | 'dictated' | 'typed'

/** The durable slice of composer state that must survive a provider/rail remount. */
export interface ComposerDraftState {
  /** The exact text in the textarea. */
  text: string
  /** Where that text came from (never inferred from the text itself). */
  provenance: DraftProvenance
}

export interface ComposerDraftStore {
  /** Current immutable snapshot (stable reference until a write) — for useSyncExternalStore. */
  getSnapshot: () => ComposerDraftState
  /** Subscribe to changes; returns an unsubscribe. */
  subscribe: (listener: () => void) => () => void
  /**
   * The user typed / edited / pasted. Called from the textarea's `onChange`, which is the
   * ONLY keyboard path into the draft, so this is the single place provenance becomes
   * `typed`. An edit that leaves the draft empty resets provenance to `empty`.
   */
  setTypedDraft: (text: string) => void
  /**
   * THE DICTATION SEAM — called by `voice/voiceStore.ts`'s `commit()`, and by nothing else.
   *
   * Appends one finalized transcript segment after whatever is in the draft AT THE MOMENT
   * IT ARRIVES (voice spec FR 8), separated by a single space, and keeps the draft's
   * provenance `dictated` UNLESS the keyboard has already touched it — in which case the
   * turn is a mixed one and stays `typed` forever. Empty/whitespace segments are ignored
   * (a transcript that says nothing must not flip an empty draft to `dictated`).
   */
  appendDictatedSegment: (segment: string) => void
  /** Empty the draft and reset provenance (called after Send). */
  clear: () => void
  /**
   * The modality to stamp on the turn being sent from the CURRENT draft: `voice` only for
   * a purely-dictated draft. Read at Send, before `clear()`.
   */
  turnModality: () => TurnModality
}

const EMPTY_DRAFT: ComposerDraftState = { provenance: 'empty', text: '' }

/**
 * Create a composer draft store. Snapshots are immutable and their reference is stable
 * until the next write, so `useSyncExternalStore` re-renders only on real changes.
 */
export const createComposerDraftStore = (): ComposerDraftStore => {
  let state: ComposerDraftState = EMPTY_DRAFT
  const listeners = new Set<() => void>()

  const set = (next: ComposerDraftState): void => {
    if (next.text === state.text && next.provenance === state.provenance) {
      return
    }
    state = next
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    appendDictatedSegment: (segment) => {
      const spoken = segment.trim()
      if (!spoken) {
        return
      }
      const text = state.text ? `${state.text} ${spoken}` : spoken
      // A keyboard-touched draft stays `typed` no matter how much is dictated onto it.
      set({ provenance: state.provenance === 'typed' ? 'typed' : 'dictated', text })
    },
    clear: () => set(EMPTY_DRAFT),
    getSnapshot: () => state,
    setTypedDraft: (text) => set(text ? { provenance: 'typed', text } : EMPTY_DRAFT),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    turnModality: () => (state.provenance === 'dictated' ? 'voice' : 'text'),
  }
}

/**
 * The app-wide singleton. Lives at module scope, so it OUTLIVES any rail/provider remount
 * (that is the whole point). One rail per app → one draft.
 */
export const agentikoComposerDraftStore = createComposerDraftStore()
