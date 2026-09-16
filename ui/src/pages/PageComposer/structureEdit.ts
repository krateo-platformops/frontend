/**
 * Structural edits to one container CR: place a child, remove a child, move one up or down.
 *
 * WHY THESE THREE AND NOT "ADD A WIDGET". Every operation here rewrites a file the draft ALREADY
 * holds — the parent — and that is the only kind of edit the held draft accepts today:
 * `blueprintDraftStore.updateFile` refuses a path it is not already holding ("only previewed files
 * can be edited"). Creating a Row or a brand-new widget means adding a file, which needs a store
 * operation that does not exist yet. Splitting on that line means these three ride the proven
 * `emitFileEdit` path with no new machinery, and the file-creating half is honestly a separate
 * piece of work rather than a half-built one hiding inside this.
 *
 * THREE PLACES, ALWAYS ALL THREE. Placing a child writes:
 *   1. `spec.widgetData.items[].resourceRefId` — the ordered reference,
 *   2. `spec.resourcesRefs.items[]` — the entry resolving that id to a real CR,
 *   3. `spec.widgetData.allowedResources[]` — the child's PLURAL, without which the container
 *      refuses to render it.
 *
 * (3) was learned the hard way: it is required by the CRD on flexes, rows, cols, tabs and tables,
 * and a container that does not list a plural will not render a child of that kind even though
 * both the reference and the ref entry are correct — a page that validates and shows nothing.
 *
 * ROUND-TRIP HONESTLY. These parse with js-yaml and re-dump, so the file comes back canonically
 * formatted: key order normalises and comments do not survive. That is acceptable for draft files,
 * which are generated, and it is why this is only ever applied to a draft — never to a chart file
 * someone hand-wrote and commented.
 */
import { dump, load } from 'js-yaml'

export interface PlaceChild {
  /** metadata.name of the widget being placed — also used as the reference id. */
  name: string
  /** The CRD plural: tables, cards, paragraphs… */
  resource: string
  /** Defaults to the widgets group/version every portal widget uses. */
  apiVersion?: string
  namespace?: string
}

export type StructureResult =
  | { ok: true; content: string }
  | { ok: false; error: string }

const WIDGET_API_VERSION = 'widgets.templates.krateo.io/v1beta1'

// `lineWidth: -1` keeps long jq expressions and URLs on one line. js-yaml folds at 80 by default,
// and a folded jq filter is both unreadable in the Files tab and a diff that looks like a rewrite.
const DUMP = { lineWidth: -1, noRefs: true } as const

interface Doc {
  spec?: {
    widgetData?: { items?: { resourceRefId?: string }[]; allowedResources?: string[] }
    resourcesRefs?: { items?: { id?: string }[] }
  }
}

const parse = (yaml: string): { doc: Doc } | { error: string } => {
  let loaded: unknown
  try {
    loaded = load(yaml)
  } catch (error) {
    return { error: `could not parse the parent: ${(error as Error).message}` }
  }
  if (typeof loaded !== 'object' || loaded === null || Array.isArray(loaded)) {
    return { error: 'the parent is not a YAML object' }
  }
  return { doc: loaded }
}

/** Ensure the three lists a container edit touches exist, and hand them back. */
const slots = (doc: Doc) => {
  doc.spec ??= {}
  doc.spec.widgetData ??= {}
  doc.spec.widgetData.items ??= []
  doc.spec.widgetData.allowedResources ??= []
  doc.spec.resourcesRefs ??= {}
  doc.spec.resourcesRefs.items ??= []
  return {
    allowed: doc.spec.widgetData.allowedResources,
    items: doc.spec.widgetData.items,
    refs: doc.spec.resourcesRefs.items,
  }
}

/** Append a child to a container: the ordered reference AND the ref entry that resolves it. */
export const placeChild = (parentYaml: string, child: PlaceChild): StructureResult => {
  const parsed = parse(parentYaml)
  if ('error' in parsed) {
    return { error: parsed.error, ok: false }
  }
  const { allowed, items, refs } = slots(parsed.doc)

  // (3) the container must declare the child's PLURAL or it will not render it. Idempotent: a
  // second Table adds nothing.
  if (!allowed.includes(child.resource)) {
    allowed.push(child.resource)
  }

  // Placing the same widget twice is legitimate — a divider between sections, say — but placing it
  // twice by accident is the more likely case, and a duplicate REF ENTRY (same id) is malformed
  // either way. So the reference may repeat; the resourcesRefs entry must not.
  items.push({ resourceRefId: child.name })
  if (!refs.some((ref) => ref.id === child.name)) {
    refs.push({
      apiVersion: child.apiVersion ?? WIDGET_API_VERSION,
      id: child.name,
      name: child.name,
      namespace: child.namespace,
      resource: child.resource,
      verb: 'GET',
    } as { id?: string })
  }
  return { content: dump(parsed.doc, DUMP), ok: true }
}

/** Remove every placement of a child, and its ref entry. */
export const removeChild = (parentYaml: string, name: string): StructureResult => {
  const parsed = parse(parentYaml)
  if ('error' in parsed) {
    return { error: parsed.error, ok: false }
  }
  const { items, refs } = slots(parsed.doc)
  const before = items.length
  const kept = items.filter((item) => item.resourceRefId !== name)
  if (kept.length === before) {
    return { error: `"${name}" is not placed on this container`, ok: false }
  }
  if (parsed.doc.spec?.widgetData) {
    parsed.doc.spec.widgetData.items = kept
  }
  // The ref entry goes only when NOTHING references it any more — a widget placed twice and
  // removed once must keep resolving, or the surviving placement renders an empty slot.
  if (parsed.doc.spec?.resourcesRefs && !kept.some((item) => item.resourceRefId === name)) {
    parsed.doc.spec.resourcesRefs.items = refs.filter((ref) => ref.id !== name)
  }
  return { content: dump(parsed.doc, DUMP), ok: true }
}

/** The container kinds the composer can insert, with the CRD plural each publishes under. */
export const LAYOUT_KINDS = {
  Card: 'cards',
  Col: 'cols',
  Flex: 'flexes',
  Row: 'rows',
  Tabs: 'tabs',
} as const

export type LayoutKind = keyof typeof LAYOUT_KINDS

/**
 * The YAML for a new, empty container.
 *
 * Minimal on purpose: kind, name, empty items, empty refs. Everything else a container can carry —
 * gap, justify, vertical, allowedResources — is a decision the author has not made yet, and
 * guessing produces a file whose defaults look chosen. They can set them in the Files tab, or the
 * live render shows them what the bare default looks like first.
 *
 * `allowedResources` is present and EMPTY, which I got wrong first time and the cluster corrected:
 * the CRD REQUIRES the field on flexes, rows, cols and tabs, so omitting it produces a container
 * the apiserver rejects outright. Empty is right because `placeChild` appends each child's plural
 * as it is placed — the list grows to exactly what the container actually holds, rather than being
 * guessed up front.
 */
export const newContainerYaml = (kind: LayoutKind, name: string, namespace?: string): string => dump({
  apiVersion: WIDGET_API_VERSION,
  kind,
  metadata: { name, namespace },
  spec: { resourcesRefs: { items: [] }, widgetData: { allowedResources: [], items: [] } },
}, DUMP)

/**
 * The repo path a container publishes under, matching the chart's own convention:
 * `<lowercase kind>.<name>.yaml` under the portal templates directory.
 */
export const containerPath = (kind: LayoutKind, name: string, directory: string): string =>
  `${directory.replace(/\/$/, '')}/${kind.toLowerCase()}.${name}.yaml`

/**
 * Move a child one place earlier or later. Order in `items` IS the rendered order, so this is how
 * a person reorders a page without hand-editing YAML.
 */
export const moveChild = (parentYaml: string, name: string, direction: 'up' | 'down'): StructureResult => {
  const parsed = parse(parentYaml)
  if ('error' in parsed) {
    return { error: parsed.error, ok: false }
  }
  const { items } = slots(parsed.doc)
  const index = items.findIndex((item) => item.resourceRefId === name)
  if (index < 0) {
    return { error: `"${name}" is not placed on this container`, ok: false }
  }
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= items.length) {
    // Already at the end it is being moved toward. Refused rather than silently doing nothing, so
    // the caller can leave the control disabled instead of offering a no-op.
    return { error: `"${name}" is already ${direction === 'up' ? 'first' : 'last'}`, ok: false }
  }
  const [moved] = items.splice(index, 1)
  items.splice(target, 0, moved)
  return { content: dump(parsed.doc, DUMP), ok: true }
}
