/**
 * THE FIVE localStorage KEYS THIS DIRECTORY OWNS, and the one-time migration that carries a
 * user's data across the `autopilot` → `agentiko` rename.
 *
 * WHY THE KEYS LIVE HERE instead of beside the stores that read them.
 *
 * The rename had one silent, permanent failure available to it: a find-and-replace renames
 * these five key STRINGS along with everything else, `tsc` stays clean, and every test stays
 * green — because the tests assert against the same constants — while every user's live
 * conversation, their whole thread archive, their speak-back preference, the "notice already
 * shown" flag and their dragged rail width are orphaned under keys nothing reads any more.
 * Nothing errors. The history is simply gone, and `getStoredRailWidth`/`loadCurrentThread`
 * return their defaults as if the user had never used the rail.
 *
 * ORDERING IS A DATA DEPENDENCY, NOT A CONVENTION — which is the only reason this file is
 * not just a comment promising to "run the migration early".
 *
 * Two readers touch storage during MODULE EVALUATION, before any React code runs:
 *   · `conversationStore.ts` ends with `export const agentikoConversationStore =
 *     createConversationStore()`, and that constructor calls `loadCurrentThread()` — so
 *     CURRENT_KEY is read at import time.
 *   · `speakBackStore.ts` ends with `export const agentikoSpeakBackStore =
 *     createSpeakBackStore()`, whose initial state is `enabled: readFlag(SPEAK_BACK_PREF_KEY,
 *     true)` — so the preference key is read at import time too.
 * (`railWidth.ts` is read later, from `useState(getStoredRailWidth)` at first render.)
 *
 * A migration that merely ran "early" — a side-effect import in `main.tsx`, say — would be
 * one import reorder away from running too late, and running too late is indistinguishable
 * from not running at all. So every reader IMPORTS its key from this module, and ES module
 * evaluation guarantees this module's body has finished — including the
 * `migrateLegacyStorageKeys()` call at the bottom — before the importing module's body
 * starts. You cannot name one of these keys without having migrated it first. This module
 * imports nothing, so no cycle can invert that order, and a future reader added anywhere in
 * the tree inherits the guarantee for free by having to import the key from here.
 *
 * LIFETIME. Added for the release that renames this directory (the first after 1.8.28).
 * Keep it for two releases so a user who skips one still gets carried across, then delete
 * this module's `LEGACY_KEYS`, the `migrateLegacyStorageKeys` call and `storageKeys.test.ts`'s
 * migration block, leaving the key constants. REMOVE NO EARLIER THAN 1.8.31 — and note that
 * deleting it early is not a style question: the old values are still the only copy in the
 * browser of anyone who has not loaded a build carrying this file.
 */

/** localStorage key for the CURRENT (live) thread — rehydrated on reload. */
export const CURRENT_KEY = 'krateo.agentiko.current.v1'
/** localStorage key for the ARCHIVE list (past threads, newest first). */
export const ARCHIVE_KEY = 'krateo.agentiko.archive.v1'
/** FR 76: the per-user speak-back preference key. */
export const SPEAK_BACK_PREF_KEY = 'krateo.agentiko.speakback.v1'
/** FR 77: the "first-use line already shown" flag. */
export const SPEAK_BACK_NOTICE_KEY = 'krateo.agentiko.speakback.notice.v1'
/** The user's dragged rail width. Note the spelling: the pre-rename key was hyphenated
 *  (`krateo-autopilot-rail-width`) while the other four were dotted; the migration below
 *  normalises it onto the dotted form the rest of them use. */
export const RAIL_WIDTH_STORAGE_KEY = 'krateo.agentiko.rail-width'

/**
 * The pre-rename key for each of the five, OLDEST FIRST in the pair.
 *
 * The legacy spellings are written as LITERALS on purpose. They exist nowhere else in the
 * tree any more, so there is no constant left to rename them out from under this table —
 * which is exactly how the data loss this migration prevents would have happened.
 */
const LEGACY_KEYS: ReadonlyArray<readonly [legacy: string, current: string]> = [
  ['krateo.autopilot.current.v1', CURRENT_KEY],
  ['krateo.autopilot.archive.v1', ARCHIVE_KEY],
  ['krateo.autopilot.speakback.v1', SPEAK_BACK_PREF_KEY],
  ['krateo.autopilot.speakback.notice.v1', SPEAK_BACK_NOTICE_KEY],
  ['krateo-autopilot-rail-width', RAIL_WIDTH_STORAGE_KEY],
]

/**
 * Copy each legacy key's value onto its current key, once, then drop the legacy key.
 *
 * IDEMPOTENT: after the first run every legacy key is gone, so every later run is a
 * handful of `getItem` misses. Exported so a test can run it a second time and show that.
 *
 * NEVER OVERWRITES. A value already under the current key wins and the legacy key is left
 * alone — the only way both can exist is a user who moved back to an older build (which
 * writes the legacy key again) and then forward, and in that case we have no way to tell
 * which of the two is the one they want. Keeping the newer key and not touching the older
 * one is the choice that cannot lose anything.
 *
 * WRITE BEFORE DELETE, deliberately: if `setItem` throws (quota), `removeItem` is never
 * reached and the value stays where it is, so a failed migration degrades to "not migrated
 * yet" and the next page load tries again. The reverse order would delete the only copy.
 *
 * SURVIVES STORAGE BEING UNAVAILABLE. Reading `globalThis.localStorage` can itself throw
 * (`SecurityError` in a blocked context) and is absent in the node test environment, so the
 * handle is taken defensively and each key is wrapped on its own — one poisoned key must not
 * stop the other four. This is the `sessionHistoryStore.ts` idiom.
 */
export const migrateLegacyStorageKeys = (): void => {
  let ls: Storage | null = null
  try {
    ls = globalThis.localStorage ?? null
  } catch {
    return
  }
  if (!ls) {
    return
  }
  for (const [legacy, current] of LEGACY_KEYS) {
    try {
      if (ls.getItem(current) !== null) {
        continue
      }
      const value = ls.getItem(legacy)
      if (value === null) {
        continue
      }
      ls.setItem(current, value)
      ls.removeItem(legacy)
    } catch {
      // Quota or a blocked key: leave it legacy and try again on the next load.
    }
  }
}

// Runs at module evaluation — see ORDERING above. Every reader of a key in this file imports
// it from here, so this has necessarily finished before any of them can read storage.
migrateLegacyStorageKeys()
