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
  /** The CR's metadata.name — the id the parent references it by. */
  name: string
  /** Kind as written in the CR (Flex, Card, Table…), or null for a reference we cannot resolve. */
  kind: string | null
  /** Repo-relative path in the draft, or null when the child is an existing cluster widget. */
  path: string | null
  /** False when this node is referenced but not carried in the draft — an already-existing widget. */
  drafted: boolean
  /** True when the CR reads its data from a RESTAction (`spec.apiRef`) — the data-bound half. */
  bound: boolean
  children: TreeNode[]
}

interface ParsedObject {
  name: string
  kind: string | null
  path: string
  bound: boolean
  /** Ordered child CR NAMES, already resolved through resourcesRefs. */
  childNames: string[]
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

  const childNames: string[] = []
  const items = widgetData?.items
  if (Array.isArray(items)) {
    for (const entry of items) {
      const item = asRecord(entry)
      const refId = typeof item?.resourceRefId === 'string' ? item.resourceRefId : null
      if (refId) {
        childNames.push(refs.get(refId) ?? refId)
      }
    }
  }

  return {
    bound: Boolean(spec?.apiRef),
    childNames,
    kind: typeof root?.kind === 'string' ? root.kind : null,
    name,
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
    for (const child of object.childNames) {
      referenced.add(child)
    }
  }

  // `seen` is per-branch, not global: the same existing widget may legitimately be placed in two
  // sections, and both placements should render. It exists only to stop a cycle — which a
  // hand-edit can create — from recursing forever and freezing the panel.
  const toNode = (name: string, seen: ReadonlySet<string>): TreeNode => {
    const object = objects.get(name)
    if (!object) {
      // Referenced but not in the draft: an existing cluster widget being placed.
      return { bound: false, children: [], drafted: false, kind: null, name, path: null }
    }
    if (seen.has(name)) {
      return { bound: object.bound, children: [], drafted: true, kind: object.kind, name, path: object.path }
    }
    const nextSeen = new Set(seen).add(name)
    return {
      bound: object.bound,
      children: object.childNames.map((child) => toNode(child, nextSeen)),
      drafted: true,
      kind: object.kind,
      name,
      path: object.path,
    }
  }

  return [...objects.values()]
    .filter((object) => !referenced.has(object.name))
    .map((object) => toNode(object.name, new Set()))
}

/** Every node, depth-first — for counting, searching, and scrolling the Files tab to a selection. */
export const flattenTree = (nodes: readonly TreeNode[]): TreeNode[] =>
  nodes.flatMap((node) => [node, ...flattenTree(node.children)])
