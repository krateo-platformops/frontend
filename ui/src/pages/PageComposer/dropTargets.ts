/**
 * Which containers can accept a dragged widget — the legality kernel behind drag & drop.
 *
 * Three constraints, different in kind:
 *
 *   1. IS IT A CONTAINER AT ALL. Only `LAYOUT_KINDS` carry `widgetData.items` +
 *      `allowedResources`; a Paragraph holds nothing and never can.
 *   2. DOES THIS CONTAINER SAY IT HOLDS THIS, read from its OWN
 *      `spec.widgetData.allowedResources` — see below, because this reverses what an earlier
 *      version of this file asserted.
 *   3. CAN WE EDIT THE PARENT. A child is a reference held by its parent, so placing one rewrites
 *      the PARENT's file. A node the draft does not carry (`drafted: false`, an existing cluster
 *      widget) has no file to rewrite and cannot take a child, however legal the type would be.
 *
 * And one that is not about types at all: a node may not be dropped into itself or into its own
 * descendants, or the tree stops being a tree. That check needs the moving NODE, not its plural,
 * which is why `legalTargets` takes one and `canAccept` does not.
 *
 * WHERE THE PERMISSION COMES FROM, CORRECTED. This module used to take an injected map of
 * kind -> permitted plurals, on the stated grounds that `allowedResources` is "an ENUM on the
 * container's CRD, so a plural outside it is rejected at apply". That is false, and was checked
 * against the live CRDs: cards, rows, cols, tabs and flexes all type the field `string[]` with NO
 * enum, deliberately — the CRD's own description records that the per-widget enums drifted and
 * enforced nothing. Nothing rejects a placement at apply: not OpenAPI, not a webhook, not the
 * renderer. The only thing that reads the field back is the portal chart's design lint (rule X5).
 *
 * The map was the wrong SHAPE for the real thing too. `allowedResources` is per-CR, so two Flexes
 * on one page may legitimately declare different slots, and a map keyed by kind cannot express
 * that. The declaration lives in the draft the canvas already holds, so it is read off the node
 * rather than fetched or injected — no discovery, nothing to go stale.
 *
 * EMPTY MEANS UNCONSTRAINED, NOT "HOLDS NOTHING". The CRD requires the key, so `newContainerYaml`
 * writes `allowedResources: []` and every freshly created container starts there. Treating empty
 * as a closed set would make every container a person just made accept nothing — a canvas with no
 * legal target anywhere, indistinguishable from a broken page. Only a NON-EMPTY list is a
 * statement of intent, and that one is honoured.
 *
 * WHY HONOUR IT AT ALL, given `placeChild` GROWS the list when the plural is missing. Because
 * growing it silently redefines what the author said the slot was for, and nothing downstream
 * reports that — X5 passes precisely BECAUSE the declaration was widened. Offering only containers
 * that already say they hold this plural keeps the declaration meaningful; editing the YAML in the
 * Files tab remains the way to change one's mind.
 */
import type { TreeNode } from './objectTree'
import { LAYOUT_KINDS } from './structureEdit'

const isContainerKind = (kind: string | null): boolean =>
  !!kind && Object.prototype.hasOwnProperty.call(LAYOUT_KINDS, kind)

/**
 * Can this node hold a child of `childPlural`?
 *
 * Type legality plus editability. Says nothing about cycles — see `legalTargets`.
 */
export const canAccept = (node: TreeNode, childPlural: string): boolean => {
  if (!isContainerKind(node.kind)) {
    return false
  }
  // Not in the draft => no file to rewrite => cannot take a child, whatever its type allows.
  if (!node.drafted || !node.path) {
    return false
  }
  if (!childPlural) {
    return false
  }
  const declared = node.allowedResources
  // Absent or empty => the author has not said, so anything may land (see the header).
  return declared && declared.length > 0 ? declared.includes(childPlural) : true
}

/** Every node in this subtree, including its root — what a move may not be dropped into. */
const subtreeOf = (node: TreeNode): Set<TreeNode> => {
  const seen = new Set<TreeNode>()
  const walk = (current: TreeNode) => {
    if (seen.has(current)) {
      return
    }
    seen.add(current)
    current.children.forEach(walk)
  }
  walk(node)
  return seen
}

const flatten = (roots: readonly TreeNode[]): TreeNode[] => {
  const out: TreeNode[] = []
  const walk = (node: TreeNode) => {
    out.push(node)
    node.children.forEach(walk)
  }
  roots.forEach(walk)
  return out
}

/**
 * The containers a drag may legally land in.
 *
 * `moving.node` is supplied when an EXISTING node is being reparented, and excludes that node and
 * everything under it. Omit it when dragging a NEW widget in from the palette, which is under
 * nothing and so excludes nothing.
 *
 * Returns the nodes themselves rather than ids: a container may legitimately be placed twice (the
 * same widget under two parents), so no id or name addresses one of them — the node does.
 */
export const legalTargets = (
  roots: readonly TreeNode[],
  moving: { plural: string; node?: TreeNode },
): TreeNode[] => {
  const excluded = moving.node ? subtreeOf(moving.node) : new Set<TreeNode>()
  return flatten(roots).filter((node) => !excluded.has(node) && canAccept(node, moving.plural))
}
