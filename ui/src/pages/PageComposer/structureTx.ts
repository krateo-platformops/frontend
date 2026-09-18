/**
 * All-or-nothing structural edits across MORE THAN ONE file — the keystone of drag & drop.
 *
 * WHY A TRANSACTION AT ALL. A child is a reference held by its parent, so moving one between
 * containers rewrites TWO files: the old parent loses the reference, the new parent gains it (and
 * gains the plural in `allowedResources`). Applied separately, a failure between them leaves a
 * draft that is neither the before nor the after — the child vanishes from one parent without
 * appearing in the other, and nothing says so. Every structural primitive already returns a
 * `StructureResult` rather than throwing, so composing them is a matter of not committing until
 * they have all succeeded.
 *
 * THE CASE THAT MAKES THIS MORE THAN A LOOP: two edits on the SAME file. A reorder inside one
 * container is `removeChild` then `placeChild` on one parent, and the naive version reads the
 * original bytes twice and writes the second result — silently discarding the first. So each edit
 * sees the output of the one before it, and a path touched twice is threaded, not re-read.
 *
 * WHAT IT DOES NOT DO. It is not a lock. The draft can still be edited between the caller reading
 * `files` and calling here — the Files tab is always live — so `expectContent` lets a caller pin
 * the bytes it planned against and be refused rather than overwrite someone's edit. That check is
 * opt-in per edit because the common path (a drag computed and committed in the same tick) has
 * nothing to pin against.
 *
 * Returns ONLY the files it changed. The caller hands those to the draft store, so an untouched
 * file is never rewritten with identical bytes — which would otherwise show up as a diff and as a
 * spurious re-render of the whole preview.
 */
import type { ChildAt, PlaceChild, StructureResult } from './structureEdit'
import { placeChild, removeChild } from './structureEdit'

export interface TxEdit {
  /** Draft-relative path of the file this edit rewrites. */
  path: string
  /** The primitive to run, e.g. `(yaml) => removeChild(yaml, at)`. */
  apply: (yaml: string) => StructureResult
  /**
   * Optional: the exact bytes this edit was planned against. When given and the file no longer
   * matches, the whole transaction is refused rather than clobbering the newer content.
   */
  expectContent?: string
}

export type TxResult =
  | { ok: true; files: Record<string, string> }
  | { ok: false; error: string; path: string }

/**
 * Run every edit, or none of them.
 *
 * Edits are applied in order, and an edit on a path an earlier edit already touched sees that
 * earlier output.
 */
export const runStructureTx = (
  files: Readonly<Record<string, string>>,
  edits: readonly TxEdit[],
): TxResult => {
  // Staged, not committed: nothing leaves this function unless every edit succeeds.
  const staged: Record<string, string> = {}

  for (const edit of edits) {
    const firstTouch = !Object.prototype.hasOwnProperty.call(staged, edit.path)
    const current = firstTouch ? files[edit.path] : staged[edit.path]

    if (typeof current !== 'string') {
      return {
        error: `the draft holds no file at ${edit.path}, so there is nothing to edit`,
        ok: false,
        path: edit.path,
      }
    }
    // Only on FIRST touch. `expectContent` asks "has this file changed since I read it"; once this
    // transaction has staged the path, its bytes are this transaction's own work and pinning them
    // against the pre-transaction copy would refuse every legitimate second edit — which is exactly
    // what a reorder inside one container is.
    if (firstTouch && edit.expectContent !== undefined && edit.expectContent !== current) {
      return {
        error: `${edit.path} changed since this edit was planned — refusing rather than overwriting it`,
        ok: false,
        path: edit.path,
      }
    }

    const result = edit.apply(current)
    if (!result.ok) {
      return { error: result.error, ok: false, path: edit.path }
    }
    staged[edit.path] = result.content
  }

  // Report only what actually differs. An edit can legitimately be a no-op (placing a plural the
  // container already declares), and rewriting a file with identical bytes reads as a change
  // downstream — a diff in the Files tab and a preview re-render that explains nothing.
  const changed: Record<string, string> = {}
  for (const [path, content] of Object.entries(staged)) {
    if (content !== files[path]) {
      changed[path] = content
    }
  }
  return { files: changed, ok: true }
}

/**
 * Move an existing child from one container to another — the edit a drag performs.
 *
 * Remove FIRST, then place. The order is not cosmetic: within a single parent the removal shifts
 * every later index, so placing first would make the removal address the wrong row.
 *
 * `fromPath === toPath` is a legitimate reorder and works by the same path — the placement lands at
 * the end of the parent's items, which is what dropping a child back onto its own container means.
 */
export const reparentChild = (
  files: Readonly<Record<string, string>>,
  move: {
    /** File of the parent the child is leaving. */
    fromPath: string
    /** File of the parent it is joining. */
    toPath: string
    /** Which placement is leaving — an index plus the id expected there. */
    at: ChildAt
    /** The child as the new parent must declare it. */
    child: PlaceChild
    /** Optional: pin the bytes this move was planned against. */
    expect?: { from?: string; to?: string }
  },
): TxResult => runStructureTx(files, [
  { apply: (yaml) => removeChild(yaml, move.at), expectContent: move.expect?.from, path: move.fromPath },
  { apply: (yaml) => placeChild(yaml, move.child), expectContent: move.expect?.to, path: move.toPath },
])
