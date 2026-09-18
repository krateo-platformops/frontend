/**
 * Which containers can accept a dragged widget — the legality kernel behind drag & drop.
 *
 * WHY THIS IS NOT "does the parent declare the plural". `placeChild` GROWS the parent's
 * `widgetData.allowedResources` when the plural is missing, so asking what a container currently
 * declares answers nothing about what it may hold. The real constraints are three, and they are
 * different in kind:
 *
 *   1. IS IT A CONTAINER AT ALL. Only `LAYOUT_KINDS` carry `widgetData.items` + `allowedResources`;
 *      a Paragraph holds nothing and never can.
 *   2. DOES THE CRD PERMIT THE PLURAL. `allowedResources` is an ENUM on the container's CRD, so a
 *      plural outside it is rejected at apply no matter what the draft says — the reason a Flex
 *      cannot hold an `inputs` today (see PageSearch.tsx). That enum lives on the cluster, so it is
 *      INJECTED here rather than fetched: this module stays pure and testable, and the caller owns
 *      the discovery.
 *   3. CAN WE EDIT THE PARENT. A child is a reference held by its parent, so placing one rewrites
 *      the PARENT's file. A node the draft does not carry (`drafted: false`, an existing cluster
 *      widget) has no file to rewrite and cannot take a child, however legal the type would be.
 *
 * And one that is not about types at all: a node may not be dropped into itself or into its own
 * descendants, or the tree stops being a tree. That check needs the moving NODE, not its plural,
 * which is why `legalTargets` takes one and `canAccept` does not.
 *
 * UNKNOWN ENUM MEANS PERMITTED, deliberately. Before the CRDs are discovered the caller supplies
 * nothing and every container accepts every plural. Defaulting to DENY would render a canvas with
 * no legal target anywhere — indistinguishable from a broken page — and `placeChild` plus the
 * live-CRD validation downstream still reject a genuinely bad placement. So the strong guarantee,
 * "an illegal drop is impossible rather than rejected afterwards", holds exactly when the enum is
 * known, and the module never pretends otherwise.
 */
import type { TreeNode } from './objectTree'
import { LAYOUT_KINDS } from './structureEdit'

/** CRD plural -> the plurals that container's `allowedResources` enum admits. */
export type PermittedChildren = Readonly<Record<string, readonly string[]>>

const isContainerKind = (kind: string | null): boolean =>
  !!kind && Object.prototype.hasOwnProperty.call(LAYOUT_KINDS, kind)

/**
 * Can this node hold a child of `childPlural`?
 *
 * Type legality plus editability. Says nothing about cycles — see `legalTargets`.
 */
export const canAccept = (
  node: TreeNode,
  childPlural: string,
  permitted?: PermittedChildren,
): boolean => {
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
  const enumerated = permitted?.[node.kind as string]
  // Unknown enum => permitted (see the header). A DECLARED but empty enum is a real "holds
  // nothing" and is honoured as such.
  return enumerated ? enumerated.includes(childPlural) : true
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
  permitted?: PermittedChildren,
): TreeNode[] => {
  const excluded = moving.node ? subtreeOf(moving.node) : new Set<TreeNode>()
  return flatten(roots).filter((node) => !excluded.has(node) && canAccept(node, moving.plural, permitted))
}
