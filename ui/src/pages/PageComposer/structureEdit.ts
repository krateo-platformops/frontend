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
  /**
   * REQUIRED, not optional.
   *
   * snowplow's resourcesRefs resolver has no defaulting — it puts this straight into the /call
   * query as `namespace=<value>` — so an entry without one resolves against the empty namespace and
   * the child never renders. It is not an apply-time error either: the page publishes clean and
   * comes up with a hole in it, which is the worst failure available here. Optional-with-a-default
   * was the original shape and it produced exactly that, because js-yaml omits an undefined key
   * entirely rather than writing a null someone might notice.
   */
  namespace: string
  /** Defaults to the widgets group/version every portal widget uses. */
  apiVersion?: string
}

export type StructureResult =
  | { ok: true; content: string }
  | { ok: false; error: string }

const WIDGET_API_VERSION = 'widgets.templates.krateo.io/v1beta1'

// `lineWidth: -1` keeps long jq expressions and URLs on one line. js-yaml folds at 80 by default,
// and a folded jq filter is both unreadable in the Files tab and a diff that looks like a rewrite.
const DUMP = { lineWidth: -1, noRefs: true } as const

interface RefEntry {
  id?: string
  name?: string
  namespace?: string
  resource?: string
  apiVersion?: string
  verb?: string
}

interface Doc {
  spec?: {
    widgetData?: { items?: { resourceRefId?: string }[]; allowedResources?: string[] }
    resourcesRefs?: { items?: RefEntry[] }
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
    })
  }
  return { content: dump(parsed.doc, DUMP), ok: true }
}

/**
 * Which placement an edit acts on.
 *
 * A POSITION, not just an id, and that distinction is load-bearing. `placeChild` deliberately lets
 * the same widget be placed twice — a divider between sections is the obvious case — so an id alone
 * does not name one row. Addressed by id, "remove" deleted BOTH dividers and "move" always moved
 * the first one, whichever the author clicked.
 *
 * `refId` is still carried, as a check rather than a lookup: the tree is derived from bytes that a
 * Files-tab edit can change underneath it, and acting on position alone would then rewrite whatever
 * row had drifted into that slot. When the two disagree the edit is refused, not guessed.
 *
 * `refId` is the id the PARENT holds in `widgetData.items[].resourceRefId` — NOT the child's
 * metadata.name. The two usually coincide and nothing requires them to.
 */
export interface ChildAt {
  /** Index within the parent's `widgetData.items` — which placement, not which widget. */
  index: number
  /** The id expected at that index. A mismatch means the draft moved; the edit is refused. */
  refId: string
}

/** Resolve a position against the current items, refusing a stale one. */
const at = (items: { resourceRefId?: string }[], child: ChildAt): string | null => {
  const item = items[child.index]
  if (!item) {
    return `"${child.refId}" is no longer placed on this container`
  }
  if (item.resourceRefId !== child.refId) {
    return `this container changed under the tree — reopen it and try again`
  }
  return null
}

/**
 * Remove ONE placement of a child, and its ref entry once no placement is left.
 *
 * One, not all: see ChildAt. A widget placed twice and removed once must keep BOTH its surviving
 * reference and the entry that resolves it, or the survivor renders an empty slot.
 */
export const removeChild = (parentYaml: string, child: ChildAt): StructureResult => {
  const parsed = parse(parentYaml)
  if ('error' in parsed) {
    return { error: parsed.error, ok: false }
  }
  const { items, refs } = slots(parsed.doc)
  const stale = at(items, child)
  if (stale) {
    return { error: stale, ok: false }
  }
  items.splice(child.index, 1)
  // The ref entry goes only when NOTHING references it any more.
  if (parsed.doc.spec?.resourcesRefs && !items.some((item) => item.resourceRefId === child.refId)) {
    parsed.doc.spec.resourcesRefs.items = refs.filter((ref) => ref.id !== child.refId)
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
export const newContainerYaml = (kind: LayoutKind, name: string, namespace: string): string => dump({
  apiVersion: WIDGET_API_VERSION,
  kind,
  metadata: { name, namespace },
  spec: { resourcesRefs: { items: [] }, widgetData: { allowedResources: [], items: [] } },
}, DUMP)

/**
 * The HELD KEY a new container is added under — `<lowercase kind>.<name>.yaml`, a bare identity
 * token with no directory.
 *
 * Not a repo path, and the distinction is the bug this shape exists to prevent. A page draft holds
 * its files under bare tokens and `pagePublishPath` prefixes the chart root at publish; a surface
 * that handed a already-prefixed path to `addFile` got it prefixed a second time and published to
 * `helm/portal/templates/helm/portal/templates/…`. The key is what a WRITER uses; the repo path is
 * derived from it, in one place, at publish.
 */
export const containerPath = (kind: LayoutKind, name: string): string =>
  `${kind.toLowerCase()}.${name}.yaml`

/**
 * Move a child one place earlier or later. Order in `items` IS the rendered order, so this is how
 * a person reorders a page without hand-editing YAML.
 */
export const moveChild = (parentYaml: string, child: ChildAt, direction: 'up' | 'down'): StructureResult => {
  const parsed = parse(parentYaml)
  if ('error' in parsed) {
    return { error: parsed.error, ok: false }
  }
  const { items } = slots(parsed.doc)
  const stale = at(items, child)
  if (stale) {
    return { error: stale, ok: false }
  }
  const { index } = child
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= items.length) {
    // Already at the end it is being moved toward. Refused rather than silently doing nothing, so
    // the caller can leave the control disabled instead of offering a no-op.
    return { error: `"${child.refId}" is already ${direction === 'up' ? 'first' : 'last'}`, ok: false }
  }
  const [moved] = items.splice(index, 1)
  items.splice(target, 0, moved)
  return { content: dump(parsed.doc, DUMP), ok: true }
}

/**
 * Wrap an existing child in a NEW container, in place — the operation that actually creates nesting.
 *
 * WHY THIS AND NOT "INSERT AN EMPTY ROW". Inserting an empty container beside a child gives you a
 * container and a child that are siblings; arranging them then means a move for every object you
 * wanted inside. The design names the real operation — *"Layout inserts a Row, Col, Tabs or Card
 * and RE-PARENTS the selection into it — this is what unlocks nesting"* — and re-parenting is what
 * this does: the child leaves its parent's items, the new container takes its exact slot, and the
 * child becomes the container's only member.
 *
 * TWO DOCUMENTS COME BACK, and both must be written for either to be valid. The parent now
 * references a container that has to exist, and the container references a child it has to
 * resolve. The caller emits the container FIRST — same ordering rule as every other add, for the
 * same reason: a draft that briefly points at nothing renders an empty slot.
 *
 * THE CHILD'S REF ENTRY MOVES WITH IT. Its resource plural, namespace and apiVersion are read off
 * the parent's existing entry rather than re-derived, because those are the only record of where
 * the child actually lives — re-deriving them is how a placed EXISTING widget (which may live in
 * another namespace entirely) silently stops resolving.
 */
export const wrapChild = (
  parentYaml: string,
  child: ChildAt,
  wrapper: { kind: LayoutKind; name: string; namespace: string },
): { ok: true; parent: string; container: string } | { ok: false; error: string } => {
  const parsed = parse(parentYaml)
  if ('error' in parsed) {
    return { error: parsed.error, ok: false }
  }
  const { allowed, items, refs } = slots(parsed.doc)
  const stale = at(items, child)
  if (stale) {
    return { error: stale, ok: false }
  }
  const entry = refs.find((ref) => ref.id === child.refId)
  if (!entry?.name || !entry.resource) {
    // Without the resolved name and plural there is nothing to place in the container, and
    // inventing either would produce a container referencing a widget that does not resolve.
    return { error: `"${child.refId}" has no resourcesRefs entry to move`, ok: false }
  }

  // The container, holding the child. Built through placeChild so the three places a child lives
  // are written by the same code here as everywhere else.
  const seeded = placeChild(newContainerYaml(wrapper.kind, wrapper.name, wrapper.namespace), {
    apiVersion: entry.apiVersion,
    name: entry.name,
    namespace: entry.namespace ?? wrapper.namespace,
    resource: entry.resource,
  })
  if (!seeded.ok) {
    return { error: seeded.error, ok: false }
  }

  // The parent: the container takes the child's EXACT slot, so the page's reading order survives.
  items[child.index] = { resourceRefId: wrapper.name }
  if (!allowed.includes(LAYOUT_KINDS[wrapper.kind])) {
    allowed.push(LAYOUT_KINDS[wrapper.kind])
  }
  if (!refs.some((ref) => ref.id === wrapper.name)) {
    refs.push({
      apiVersion: WIDGET_API_VERSION,
      id: wrapper.name,
      name: wrapper.name,
      namespace: wrapper.namespace,
      resource: LAYOUT_KINDS[wrapper.kind],
      verb: 'GET',
    })
  }
  // The child's entry goes only if nothing in THIS parent still references it — a widget placed
  // twice and wrapped once keeps resolving for the placement that stayed put.
  if (parsed.doc.spec?.resourcesRefs && !items.some((item) => item.resourceRefId === child.refId)) {
    parsed.doc.spec.resourcesRefs.items = refs.filter((ref) => ref.id !== child.refId)
  }

  return { container: seeded.content, ok: true, parent: dump(parsed.doc, DUMP) }
}
