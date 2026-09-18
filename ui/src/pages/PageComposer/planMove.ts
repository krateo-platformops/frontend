/**
 * Plan a move: which container a widget may be dropped into, and the bytes that result.
 *
 * Stage 4 of drag & drop, and deliberately a PURE function rather than a handler. The canvas and
 * the tree are two surfaces onto the same draft, and a drop must mean the same thing on both — so
 * the decision lives here and each surface only reports what was dragged onto what. A rule
 * implemented twice is a rule that will disagree with itself.
 *
 * It composes the two stages underneath it rather than re-deciding anything:
 *   - #297 `legalTargets` answers MAY this land here — container kind, what the target itself
 *     declares it holds, editability, and the cycle rule (no dropping a container inside itself).
 *   - #300 `reparentChild` answers WHAT BYTES result — remove then place, all-or-nothing across the
 *     two files, refusing the whole move if either file changed underneath it, and placing at the
 *     requested index rather than always at the end.
 *
 * WHAT GUARDS A STALE DROP. A drag is slow in computer terms and the Files tab can rewrite a file
 * mid-gesture, so the question is real. The guard is `ChildAt` (#300): the removal names both the
 * index and the id expected there, and refuses when the parent no longer matches. That is the
 * failure that corrupts a draft — removing the wrong row — and it is checked against the CURRENT
 * bytes on every move.
 *
 * `reparentChild` also accepts an `expect` byte-pin, and this function deliberately does NOT pass
 * one. It could only pin against the same `files` it is about to apply to, which is self-consistent
 * by construction and would refuse nothing — a guard in name only. The caller's real obligation is
 * narrower and worth stating: `roots` must be derived from the `files` passed alongside it. A tree
 * built from one snapshot and applied to another is a caller bug this function cannot detect.
 *
 * The target file needs no pin either: a target that gained a child under the drag is simply
 * appended to, which is the correct outcome rather than a conflict.
 */
import { legalTargets } from './dropTargets'
import type { TreeNode } from './objectTree'
import { reparentChild } from './structureTx'

export type MovePlan =
  | { ok: true; files: Record<string, string> }
  | { ok: false; reason: string }

/**
 * A node can only be moved if its parent addresses it — id, position and the file that holds the
 * reference. A root is placed by nothing, so there is no reference to move.
 */
const placement = (node: TreeNode): { index: number; parentPath: string; refId: string } | null =>
  (node.parentPath && node.refId !== null && node.position !== null
    ? { index: node.position, parentPath: node.parentPath, refId: node.refId }
    : null)

export const planMove = (
  files: Readonly<Record<string, string>>,
  roots: readonly TreeNode[],
  moving: TreeNode,
  target: TreeNode,
  /**
   * Where in the target's children it lands, measured against the list as it is NOW. Omitted means
   * the end, which is what dropping onto a container (rather than between two of its children)
   * means.
   *
   * `reparentChild` owns the correction for a same-parent move: the removal runs first, so an
   * index measured before the move is one too high whenever it points past the row being removed.
   * That correction lives there because that is where the ordering of the two edits is decided.
   */
  at?: number,
): MovePlan => {
  const from = placement(moving)
  if (!from) {
    return { ok: false, reason: `"${moving.name}" is a page root — it is not placed on anything, so there is nothing to move` }
  }
  // The plural is what the target's enum is checked against, and what the new parent must write
  // down. Read from the parent's own resourcesRefs entry; never guessed from the kind.
  if (!moving.resource) {
    return { ok: false, reason: `"${moving.name}" has no resource declared on its reference — the draft cannot say what kind of thing it is` }
  }
  // Required by the widget CRDs and undefaulted by snowplow: a placement without it renders nothing.
  if (!moving.namespace) {
    return { ok: false, reason: `"${moving.name}" has no namespace declared on its reference — re-placing it would render an empty slot` }
  }
  if (!target.path) {
    return { ok: false, reason: `"${target.name}" is not carried in this draft, so it has no file to place a child in` }
  }

  // One authority for legality, shared with the tree and with whatever highlights drop zones.
  if (!legalTargets(roots, { node: moving, plural: moving.resource }).includes(target)) {
    return target === moving
      ? { ok: false, reason: `"${moving.name}" cannot be dropped into itself` }
      : { ok: false, reason: `"${target.name}" cannot hold a ${moving.resource}` }
  }

  const result = reparentChild(files, {
    at: { index: from.index, refId: from.refId },
    child: { name: moving.name, namespace: moving.namespace, resource: moving.resource },
    fromPath: from.parentPath,
    toIndex: at,
    toPath: target.path,
  })
  return result.ok ? { files: result.files, ok: true } : { ok: false, reason: result.error }
}
