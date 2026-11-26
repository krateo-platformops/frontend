/**
 * The flat node list a Tree receives, nested into the shape antd draws.
 *
 * Flat because a CRD schema cannot recurse and because it is what a RESTAction's jq produces: one
 * object per resource, each naming its owner. Three things in that list are not a tree, and each has
 * a rule rather than an error, so a partial or filtered answer still draws everything it holds:
 *
 * - a repeated `key`: the first node wins, the later ones are dropped (antd needs unique keys);
 * - a `parentKey` that names no node (the parent was filtered out): the node is drawn at the root;
 * - a cycle (a → b → a): the node where the walk comes back round is drawn at the root, which breaks it.
 */
export interface FlatNode {
  key: string
  parentKey?: string
}

export interface NestedNode<T extends FlatNode> {
  children: NestedNode<T>[]
  node: T
}

/** The parent each node is drawn under: its declared one, unless that is missing or closes a cycle. */
const effectiveParents = <T extends FlatNode>(byKey: Map<string, T>): Map<string, string | undefined> => {
  const parents = new Map<string, string | undefined>()
  for (const [key, node] of byKey) {
    const declared = node.parentKey
    parents.set(key, declared !== undefined && declared !== key && byKey.has(declared) ? declared : undefined)
  }
  // Walk up from each node; a walk that reaches a node it already passed is a cycle, cut at that node.
  for (const start of byKey.keys()) {
    const seen = new Set<string>()
    let current: string | undefined = start
    while (current !== undefined) {
      if (seen.has(current)) {
        parents.set(current, undefined)
        break
      }
      seen.add(current)
      current = parents.get(current)
    }
  }
  return parents
}

/** Nest the flat list. Siblings keep the order they have in it. */
export const buildTree = <T extends FlatNode>(items: readonly T[]): NestedNode<T>[] => {
  const byKey = new Map<string, T>()
  for (const item of items) {
    if (!byKey.has(item.key)) { byKey.set(item.key, item) }
  }
  const parents = effectiveParents(byKey)
  const nested = new Map<string, NestedNode<T>>()
  for (const [key, node] of byKey) { nested.set(key, { children: [], node }) }

  const roots: NestedNode<T>[] = []
  for (const [key, entry] of nested) {
    const parent = parents.get(key)
    if (parent === undefined) {
      roots.push(entry)
    } else {
      nested.get(parent)?.children.push(entry)
    }
  }
  return roots
}

/** A node's ancestors, nearest first, following the same parents the tree is drawn with. */
export const ancestorsOf = <T extends FlatNode>(roots: NestedNode<T>[], key: string): string[] => {
  const path: string[] = []
  const walk = (entries: NestedNode<T>[]): boolean => entries.some((entry) => {
    if (entry.node.key === key) { return true }
    path.push(entry.node.key)
    if (walk(entry.children)) { return true }
    path.pop()
    return false
  })
  return walk(roots) ? path.reverse() : []
}
