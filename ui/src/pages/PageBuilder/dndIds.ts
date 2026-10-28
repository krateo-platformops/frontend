/**
 * The vocabulary the canvas and the palette speak to dnd-kit, in one place.
 *
 * dnd-kit addresses draggables and droppables by opaque id, and an id is the only thing `onDragEnd`
 * gets back. Encoding what a thing IS into its id — rather than keeping a parallel map — is what
 * lets the end of a gesture be resolved without holding state that could disagree with the tree the
 * drop is applied against. The tree is rebuilt from the draft's bytes on every render, so anything
 * remembered across a gesture is a chance to act on a node that no longer exists.
 *
 * Node ids carry name AND refId AND position because none of them identifies a placement alone: a
 * widget may legitimately sit under two parents (so the name repeats) and a container may hold the
 * same child twice (so the refId repeats). The triple is what `objectTree` already uses to mean
 * "this placement", and it is why a move can be told from a copy.
 */
import type { TreeNode } from './objectTree'
import type { PalettePick } from './PalettePanel'

export type DragPayload =
  | { from: 'palette'; pick: PalettePick }
  | { from: 'canvas'; node: TreeNode }

/** Where a drop may land: INTO a container, or BETWEEN two of its children. */
export type DropPayload =
  | { at: 'well'; node: TreeNode }
  | { at: 'gap'; node: TreeNode; index: number }

export const paletteDragId = (pick: PalettePick): string =>
  (pick.kind === 'container' ? `palette:container:${pick.layout}` : `palette:existing:${pick.resource}:${pick.name}`)

export const nodeDragId = (node: TreeNode): string =>
  `node:${node.name}:${node.refId ?? ''}:${node.position ?? ''}`

export const wellDropId = (node: TreeNode): string => `well:${node.name}`

export const gapDropId = (node: TreeNode, index: number): string => `gap:${node.name}:${index}`

/** What a completed gesture MEANS, before anything is applied. */
export type DropIntent =
  | { do: 'add'; target: TreeNode; at?: number; pick: PalettePick }
  | { do: 'move'; moving: TreeNode; target: TreeNode; at?: number }
  | { do: 'nothing'; why: string }

/**
 * Resolve a finished drag into an intent — pure, and deliberately separate from the component.
 *
 * The old canvas decided this inside a DOM event handler, so proving "this gesture means that edit"
 * required simulating a drag. dnd-kit's gestures are pointer sequences that jsdom does not
 * meaningfully reproduce, and a test that fakes them well enough to pass proves the fake, not the
 * canvas. Everything interesting here is a decision about two nodes and an index, so it is a
 * function of those — and the component keeps nothing but wiring.
 *
 * NOTE WHAT IS NOT DECIDED HERE: legality. `planAdd`/`planMove` own that and are the only things
 * that may refuse, which is why an illegal drop still resolves to a real intent and gets its reason
 * from the kernel rather than being silently dropped on the floor.
 */
export const resolveDrop = (
  dragged: DragPayload | undefined,
  over: DropPayload | undefined,
): DropIntent => {
  if (!dragged) {
    return { do: 'nothing', why: 'nothing was being dragged' }
  }
  if (!over) {
    return { do: 'nothing', why: 'the drop landed outside every container' }
  }
  const at = over.at === 'gap' ? over.index : undefined
  if (dragged.from === 'palette') {
    return { at, do: 'add', pick: dragged.pick, target: over.node }
  }
  // Onto its own container with no index: the person aimed at where it already is. Not a refusal —
  // nothing was asked for, and reporting a refusal for it would be noise.
  if (dragged.node === over.node && at === undefined) {
    return { do: 'nothing', why: 'it was dropped where it already is' }
  }
  return { at, do: 'move', moving: dragged.node, target: over.node }
}
