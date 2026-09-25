/**
 * UNDO for the composer — the whole held draft, one snapshot per accepted edit.
 *
 * WHY IT BECAME NECESSARY RATHER THAN NICE. The composer had no undo of any kind, which was merely
 * expensive while every operation was recoverable by hand. Two of them were not: the first drop
 * into a container permanently narrowed it, and Remove permanently orphaned a file — and NEITHER
 * was announced. An unannounced irreversible operation is strictly worse than an announced one.
 * The first is fixed at the source (a derived allowedResources is no longer a rule) and the second
 * is fixed by Remove actually removing — which makes it genuinely destructive, confirmed but gone.
 * That is the operation this exists for.
 *
 * WHOLE-TREE SNAPSHOTS, NOT AN OPERATION LOG. Every structural edit already flows through buses
 * carrying whole file contents, and the store holds `{path: content}`. So the cheapest correct
 * history is the map itself, copied before each accepted mutation: it needs no inverse for any
 * operation, it cannot drift from what the store holds, and it covers edits this module has never
 * heard of — including the agent's, and including a hand edit typed in the Files tab. The cost is
 * memory, bounded below, against a draft already capped at 512 KiB.
 *
 * PUSHED ONLY ON ACCEPTED EDITS. A refused add or an over-cap edit leaves the held tree exactly as
 * it was, so recording a snapshot for one would make Undo a no-op that still consumed a step — the
 * button would move and nothing would change, which reads as a bug.
 *
 * CLEARED WHEN THE DRAFT IS REPLACED. A snapshot restored into a different page would be a new and
 * far worse kind of data loss than the one this fixes.
 *
 * No React: a module store read through useSyncExternalStore, the same shape conversationStore and
 * composerDraftStore use and for the same reason — the rail and the composer both remount.
 */
import type { DraftKind } from './blueprintDraftStore'

/**
 * The tree and WHAT it is. One store holds either builder's draft, and a page tree restored into a
 * held chart — undo reading the kind from what is held NOW rather than from the step — would
 * publish as a chart made of widget CRs. The kind travels with the files so a restore cannot
 * relabel them.
 */
export interface Snapshot {
  files: Record<string, string>
  kind: DraftKind
}

/**
 * Twenty steps. Enough to walk back out of a wrong turn in a composing session, and short enough
 * that the memory is bounded by a small multiple of the 512 KiB draft cap.
 */
const MAX_DEPTH = 20

let stack: Snapshot[] = []
const listeners = new Set<() => void>()

const announce = (): void => {
  for (const listener of listeners) {
    listener()
  }
}

export const draftHistory = {
  /** A new draft is not answerable for the last one's history. */
  clear: (): void => {
    if (!stack.length) {
      return
    }
    stack = []
    announce()
  },
  /** How many steps back are available — what the control reads to know whether it is enabled. */
  depth: (): number => stack.length,
  /** The tree to go back to, or null when there is nothing to undo. Removes it from the stack. */
  pop: (): Snapshot | null => {
    const previous = stack[stack.length - 1]
    if (!previous) {
      return null
    }
    stack = stack.slice(0, -1)
    announce()
    return previous
  },
  /** Snapshot the tree as it is BEFORE an accepted mutation. Oldest steps fall off the bottom. */
  push: ({ files, kind }: Snapshot): void => {
    // Deep enough: the map is one level and its values are immutable strings.
    stack = [...stack, { files: { ...files }, kind }].slice(-MAX_DEPTH)
    announce()
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
}
