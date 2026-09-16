/**
 * The draft's files, read as the tree they actually describe.
 *
 * A page is not a list. A widget CR names its ordered children in
 * `spec.widgetData.items[].resourceRefId`, and resolves each of those ids to a real CR through
 * `spec.resourcesRefs.items[]` ({id, name, resource}). Two levels of indirection, and the shape
 * every container kind uses — Flex, Row, Col, Tabs, Card.
 *
 * DERIVED, NEVER STORED. The held draft stays a flat `Record<path, content>`, exactly as
 * `blueprintDraftStore` keeps it and exactly as `filesBundle` publishes it. This module is a VIEW
 * over that map, recomputed from the bytes. A tree kept alongside the files would be a second
 * source of truth, and the first thing to drift the moment someone edits YAML in the Files tab —
 * which is a thing the surface explicitly supports.
 *
 * PLACED vs DRAFTED. A page routinely references widgets that already exist on the cluster and are
 * NOT part of the draft (that is what "Compose a page" does today, and what makes it safe: those
 * widgets are already data-bound). Such a child still belongs in the tree — you need to see it to
 * reorder or remove it — so it appears as a node with `drafted: false` and no path. Dropping it
 * would silently hide most of a composed page.
 */
import { load } from 'js-yaml'

export interface TreeNode {
  /** The CR's metadata.name. */
  name: string
  /**
   * The `resourceRefId` the PARENT addresses this child by — the key a structural edit matches on.
   *
   * Not the same string as `name`, and that is the whole reason this field exists: `resourcesRefs`
   * maps an id to a CR name and nothing requires the two to coincide. A remove or a move that
   * matched on the resolved name would silently refuse every edit on a page that names them apart
   * (and would match the WRONG row on a page that reuses a name under two ids). Null for a root,
   * which no parent addresses.
   */
  refId: string | null
  /**
   * This node's index in its parent's `widgetData.items` — WHICH placement it is.
   *
   * The same widget may legitimately be placed twice (a divider between sections), so an id does
   * not name one row: a remove addressed by id deleted every copy, and a move always moved the
   * first. Null for a root, which sits in no parent's items.
   */
  position: number | null
  /** Kind as written in the CR (Flex, Card, Table…), or null for a reference we cannot resolve. */
  kind: string | null
  /** Repo-relative path in the draft, or null when the child is an existing cluster widget. */
  path: string | null
  /** False when this node is referenced but not carried in the draft — an already-existing widget. */
  drafted: boolean
  /** True when the CR reads its data from a RESTAction (`spec.apiRef`) — the data-bound half. */
  bound: boolean
  /**
   * Path of the file that PLACES this node — the one a move/remove rewrites, since a child is a
   * reference held by its parent, not a property of itself. Null for a root, which nothing places.
   */
  parentPath: string | null
  children: TreeNode[]
}

/** One ordered child of a container: the id its parent holds, and the CR name that id resolves to. */
interface ChildRef {
  refId: string
  name: string
}

interface ParsedObject {
  name: string
  kind: string | null
  path: string
  bound: boolean
  namespace: string | null
  /** Ordered children, each carrying BOTH the parent's id for it and the name it resolves to. */
  children: ChildRef[]
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  ((typeof value === 'object' && value !== null && !Array.isArray(value))
    ? value as Record<string, unknown>
    : null)

/** One file → the object it declares, or null when it is not a widget CR we can read. */
const parseObject = (path: string, content: string): ParsedObject | null => {
  let doc: unknown
  try {
    doc = load(content)
  } catch {
    // A file mid-edit is routinely invalid. The tree simply omits it rather than throwing and
    // taking the whole panel down while someone is typing.
    return null
  }
  const root = asRecord(doc)
  const meta = asRecord(root?.metadata)
  const name = typeof meta?.name === 'string' ? meta.name : null
  if (!name) {
    return null
  }
  const spec = asRecord(root?.spec)
  const widgetData = asRecord(spec?.widgetData)

  // refId -> CR name. The id and the name usually coincide, but nothing requires it, so resolve
  // rather than assume: a page that names them differently would otherwise render a flat tree.
  const refs = new Map<string, string>()
  const refItems = asRecord(spec?.resourcesRefs)?.items
  if (Array.isArray(refItems)) {
    for (const entry of refItems) {
      const ref = asRecord(entry)
      if (typeof ref?.id === 'string' && typeof ref?.name === 'string') {
        refs.set(ref.id, ref.name)
      }
    }
  }

  const children: ChildRef[] = []
  const items = widgetData?.items
  if (Array.isArray(items)) {
    for (const entry of items) {
      const item = asRecord(entry)
      const refId = typeof item?.resourceRefId === 'string' ? item.resourceRefId : null
      if (refId) {
        // Unresolvable id: keep it, named by itself. A dangling reference is a real state of a
        // half-edited page and the tree should show it, not drop the row.
        children.push({ name: refs.get(refId) ?? refId, refId })
      }
    }
  }

  return {
    bound: Boolean(spec?.apiRef),
    children,
    kind: typeof root?.kind === 'string' ? root.kind : null,
    name,
    namespace: typeof meta?.namespace === 'string' ? meta.namespace : null,
    path,
  }
}

/**
 * Build the forest. Roots are the objects nothing else references — normally exactly one (the page)
 * plus any orphan a half-finished edit left behind, which is worth SEEING rather than hiding.
 */
export const buildObjectTree = (files: Record<string, string>): TreeNode[] => {
  const objects = new Map<string, ParsedObject>()
  for (const [path, content] of Object.entries(files)) {
    const parsed = parseObject(path, content)
    if (parsed) {
      objects.set(parsed.name, parsed)
    }
  }

  const referenced = new Set<string>()
  for (const object of objects.values()) {
    for (const child of object.children) {
      referenced.add(child.name)
    }
  }

  // `seen` is per-branch, not global: the same existing widget may legitimately be placed in two
  // sections, and both placements should render. It exists only to stop a cycle — which a
  // hand-edit can create — from recursing forever and freezing the panel.
  const toNode = (
    name: string,
    refId: string | null,
    position: number | null,
    seen: ReadonlySet<string>,
    parentPath: string | null,
  ): TreeNode => {
    const object = objects.get(name)
    if (!object) {
      // Referenced but not in the draft: an existing cluster widget being placed.
      return { bound: false, children: [], drafted: false, kind: null, name, parentPath, path: null, position, refId }
    }
    if (seen.has(name)) {
      return { bound: object.bound, children: [], drafted: true, kind: object.kind, name, parentPath, path: object.path, position, refId }
    }
    const nextSeen = new Set(seen).add(name)
    return {
      bound: object.bound,
      children: object.children.map((child, index) => toNode(child.name, child.refId, index, nextSeen, object.path)),
      drafted: true,
      kind: object.kind,
      name,
      parentPath,
      path: object.path,
      position,
      refId,
    }
  }

  return [...objects.values()]
    .filter((object) => !referenced.has(object.name))
    .map((object) => toNode(object.name, null, null, new Set(), null))
}

/** Every node, depth-first — for counting, searching, and scrolling the Files tab to a selection. */
export const flattenTree = (nodes: readonly TreeNode[]): TreeNode[] =>
  nodes.flatMap((node) => [node, ...flattenTree(node.children)])

/**
 * The namespace the draft's own objects live in — what a NEW object must join to be reachable.
 *
 * Read from the draft rather than taken from a prop: a widget's `apiRef.namespace` and each
 * `resourcesRefs` entry's namespace are REQUIRED by the widget CRDs and have no server-side
 * default, so an object generated without one is rejected at apply ("spec.apiRef.namespace:
 * Required value") — and a child placed without one resolves to an empty namespace and never
 * renders. The draft is the only party that knows the answer, so it is the one asked.
 *
 * Picks the most common namespace among the draft's objects, so one stray object cannot move where
 * new ones are created. Null when the draft declares none — the caller must then refuse to
 * generate rather than emit an object the cluster will reject.
 */
export const draftNamespace = (files: Record<string, string>): string | null => {
  const counts = new Map<string, number>()
  for (const [path, content] of Object.entries(files)) {
    const namespace = parseObject(path, content)?.namespace
    if (namespace) {
      counts.set(namespace, (counts.get(namespace) ?? 0) + 1)
    }
  }
  let best: string | null = null
  let bestCount = 0
  for (const [namespace, count] of counts) {
    if (count > bestCount) {
      best = namespace
      bestCount = count
    }
  }
  return best
}
