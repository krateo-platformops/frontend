/**
 * Plan an ADD: a palette pick dropped onto a container.
 *
 * The sibling of `planMove`, and deliberately the same shape — a pure function that decides, so the
 * canvas, the tree and (later) an agent proposal all reach the same verdict about the same gesture.
 * A rule implemented twice is a rule that will disagree with itself.
 *
 * TWO PICKS, ONE DIFFERENCE THAT MATTERS: a container is CREATED (a new file joins the draft) while
 * an existing widget is only PLACED (a reference to a CR already on the cluster). Getting that
 * backwards writes files that should not exist, so the plan reports the created file separately
 * rather than folding it into `files`.
 *
 * EMISSION ORDER IS THE CALLER'S, and it is not free: the new container's file must be added BEFORE
 * the parent that references it, or the parent briefly names a file the draft does not carry. The
 * tree's own add does it in that order for the same reason; `created` is returned first-class so a
 * caller cannot accidentally emit them the other way round.
 *
 * NOTHING IS EMITTED HERE. The placement is computed in memory first, so a refusal costs nothing —
 * there is no orphan file to clean up, because nothing has been written yet.
 */
import { canAccept } from './dropTargets'
import type { TreeNode } from './objectTree'
import type { PalettePick } from './PalettePanel'
import { containerPath, newContainerYaml, placeChild } from './structureEdit'
import type { LAYOUT_KINDS } from './structureEdit'
import { runStructureTx } from './structureTx'

export type AddPlan =
  | {
    ok: true
    /** The new container's file, when the pick created one. Emit this BEFORE `files`. */
    created?: { path: string; content: string }
    /** Only the files the transaction changed — the target parent. */
    files: Record<string, string>
  }
  | { ok: false; reason: string }

/**
 * A free name for a new container, derived from its parent so the draft reads as a structure rather
 * than a pile of `flex-1`s. Mirrors the tree's own naming, including the numeric suffix, so a
 * container added by drag and one added from the tree are indistinguishable afterwards.
 */
const freeName = (files: Readonly<Record<string, string>>, parent: string, kind: keyof typeof LAYOUT_KINDS): string => {
  const taken = new Set(Object.keys(files))
  let name = `${parent}-${kind.toLowerCase()}`
  let suffix = 2
  while (taken.has(containerPath(kind, name))) {
    name = `${parent}-${kind.toLowerCase()}-${suffix}`
    suffix += 1
  }
  return name
}

export const planAdd = (
  files: Readonly<Record<string, string>>,
  target: TreeNode,
  pick: PalettePick,
  /** The draft's namespace. Required: `PlaceChild.namespace` has no default and an entry without
   *  one resolves against the empty namespace, so the child publishes clean and renders nothing. */
  namespace: string | null,
  at?: number,
): AddPlan => {
  if (!namespace) {
    return { ok: false, reason: 'this draft declares no namespace, so nothing can be added to it' }
  }
  if (!target.path) {
    return { ok: false, reason: `"${target.name}" is not carried in this draft, so it has no file to place a child in` }
  }
  // One authority for legality, shared with every other way a child can land here.
  if (!canAccept(target, pick.resource)) {
    return { ok: false, reason: `"${target.name}" cannot hold a ${pick.resource}` }
  }

  const created = pick.kind === 'container'
    ? (() => {
      const name = freeName(files, target.name, pick.layout)
      return { content: newContainerYaml(pick.layout, name, namespace), name, path: containerPath(pick.layout, name) }
    })()
    : null

  const child = {
    name: created?.name ?? (pick.kind === 'existing' ? pick.name : ''),
    namespace,
    resource: pick.resource,
  }

  const result = runStructureTx(files, [
    { apply: (yaml) => placeChild(yaml, child, at), path: target.path },
  ])
  if (!result.ok) {
    return { ok: false, reason: result.error }
  }
  return created
    ? { created: { content: created.content, path: created.path }, files: result.files, ok: true }
    : { files: result.files, ok: true }
}
