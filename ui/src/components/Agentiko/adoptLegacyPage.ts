/**
 * ADOPT a legacy page draft — a `page-<slug>` set a live preview left in the sandbox before draft
 * records existed — into a held page draft, and so (through the autosave) into the adopter's own
 * record.
 *
 * WHY. Before records, a page's live preview WAS its only storage: its widget CRs in the sandbox,
 * labelled `krateo.io/purpose=preview-draft`, owned by nobody (229 of them on 057 at the time of
 * the plan, 94 of 101 roots person-initiated). The plan's D3 keeps every one of them until a person
 * chooses — "Unowned drafts" lists them, and Adopt is that choice. Adopting turns the set back into
 * the thing the builder holds, `pageDraftFiles(widgets)`, exactly as a Start or a proposed page
 * does, so the adopted page is editable, undoable and publishable like any other.
 *
 * HOW, as the person, through snowplow `/call`:
 *   1. READ the root Flex, and every object it reaches IN THE SANDBOX — `spec.resourcesRefs` items
 *      and a RESTAction `spec.apiRef` — walking down (a Row's Cols are refs of the Row, not of the
 *      root). A ref to anything outside the sandbox is a widget placed with "Place existing": it
 *      is kept as a ref and not read, because the page set neither owns nor ships it.
 *   2. REBUILD the draft objects: the sandbox's rewrite undone (namespace, sibling refs, apiRef,
 *      the preview labels), the apiserver's bookkeeping dropped (status, uid, resourceVersion…).
 *   3. HOLD it (the provider), and only then REMOVE the legacy objects through the audited sandbox
 *      writer — one DELETE per object read, and only objects labelled as preview drafts.
 *
 * THE ROOT NAME IS TAKEN VERBATIM — legacy roots are the unscoped `page-<slug>`, never re-derived
 * from a slug or tagged with an owner (a scoped root, `page-<slug>-<tag>`, is refused: it carries a
 * `krateo.io/draft-owner` label and belongs to a record).
 *
 * ALL OR NOTHING ON THE READ. Any read that fails — a 403, a child deleted since, a body that is
 * not an object — adopts nothing and says which: a half-read page would be held as the whole page,
 * published as the whole page, and then its legacy objects deleted, losing the part never read.
 */
import { getAccessToken } from '../../utils/getAccessToken'
import type { WriteOp } from '../BlastRadius/buildBlastRadius'

import { buildSetOpPath, type ApplyResourceSetGvr, type ApplyResourceSetOp } from './applyResourceSet'
import { DRAFT_RECORD_VERSION, LABEL_OWNER, type DraftRecordBody } from './draftRecord'
import { pageDraftFiles } from './pageDraft'
import {
  PREVIEW_PURPOSE_LABEL,
  PREVIEW_PURPOSE_VALUE,
  PREVIEW_SESSION_LABEL,
  RESTACTION_GROUP,
  RESTACTION_VERSION,
  WIDGETS_GROUP,
  WIDGETS_VERSION,
} from './previewSandbox'

/** The query parameter "Unowned drafts" links carry: `?adopt=<root flex name>`. */
export const ADOPT_PARAM = 'adopt'

/**
 * "Unowned drafts" Discard: `?discard-legacy=<root flex name>`. The portal cannot delete a set from a
 * list row — its children vary in kind and number, so a row action would delete the root and orphan
 * the rest — so it sends the person here, where the same walk reads the whole set first.
 */
export const DISCARD_LEGACY_PARAM = 'discard-legacy'

/**
 * The namespace an adopted page's objects are authored in. The sandbox rewrite overwrote the
 * original, so there is nothing to restore it from; this is the page composer's NEW_DRAFT_NAMESPACE,
 * and `pageDraftFiles` templates it away before anything publishes.
 */
export const ADOPTED_NAMESPACE = 'krateo-system'

/** How many objects one page set may have. A walk past this is a cycle or not a page. */
const MAX_OBJECTS = 200

const ROOT_NAME = /^page-[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

export const isLegacyRootName = (name: unknown): name is string =>
  typeof name === 'string' && name.length <= 63 && ROOT_NAME.test(name)

/** The root a legacy-adopt link carries, or null when there is nothing valid to adopt. */
export const adoptRootFrom = (search: string, param: string = ADOPT_PARAM): string | null => {
  let raw: string | null = null
  try {
    raw = new URLSearchParams(search).get(param)
  } catch {
    return null
  }
  return isLegacyRootName(raw) ? raw : null
}

/** One object in the sandbox, by what a `/call` needs to read or delete it. */
export interface SandboxTarget {
  gvr: ApplyResourceSetGvr
  name: string
}

export type LegacyPageRead =
  | { ok: true; record: DraftRecordBody; retire: SandboxTarget[] }
  | { ok: false; message: string }

type Json = Record<string, unknown>

const asRecord = (value: unknown): Json | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null)

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const FLEXES: ApplyResourceSetGvr = { group: WIDGETS_GROUP, resource: 'flexes', version: WIDGETS_VERSION }
const RESTACTIONS: ApplyResourceSetGvr = { group: RESTACTION_GROUP, resource: 'restactions', version: RESTACTION_VERSION }

/** `widgets.templates.krateo.io/v1beta1` + `rows` → a GVR; null for anything that is not group/version. */
const gvrOf = (apiVersion: unknown, resource: unknown): ApplyResourceSetGvr | null => {
  if (!nonEmpty(apiVersion) || !nonEmpty(resource)) {
    return null
  }
  const [group, version, extra] = apiVersion.split('/')
  if (extra !== undefined) {
    return null
  }
  return version === undefined ? { group: '', resource, version: group } : { group, resource, version }
}

const keyOf = ({ gvr, name }: SandboxTarget): string => `${gvr.group}/${gvr.resource}/${name}`

/** The objects this one references IN THE SANDBOX — the page set's own members, and nothing else. */
export const sandboxReferencesOf = (cr: Json, sandboxNamespace: string): SandboxTarget[] => {
  const spec = asRecord(cr.spec)
  const targets: SandboxTarget[] = []
  const items = asRecord(spec?.resourcesRefs)?.items
  for (const entry of Array.isArray(items) ? items : []) {
    const item = asRecord(entry)
    const gvr = gvrOf(item?.apiVersion, item?.resource)
    if (item && gvr && nonEmpty(item.name) && item.namespace === sandboxNamespace) {
      targets.push({ gvr, name: item.name })
    }
  }
  const apiRef = asRecord(spec?.apiRef)
  if (apiRef && nonEmpty(apiRef.name) && apiRef.namespace === sandboxNamespace) {
    targets.push({ gvr: RESTACTIONS, name: apiRef.name })
  }
  return targets
}

/** Keys the apiserver writes and a draft never carries. */
const BOOKKEEPING_ANNOTATIONS = ['kubectl.kubernetes.io/last-applied-configuration']

/**
 * A sandbox object back to the draft object it was applied from — the inverse of
 * `rewriteDraftsForSandbox`, as far as it can be inverted: the sandbox namespace becomes
 * ADOPTED_NAMESPACE (the original was overwritten), the preview labels go, and so does everything
 * the apiserver added. A ref or apiRef into the sandbox was a sibling in the set, and follows the
 * set; one elsewhere is left exactly as it was.
 */
export const toDraftObject = (cr: Json, sandboxNamespace: string): Json => {
  const metadata = asRecord(cr.metadata) ?? {}
  const without = (map: unknown, drop: readonly string[]): Json =>
    Object.fromEntries(Object.entries(asRecord(map) ?? {}).filter(([key]) => !drop.includes(key)))
  const labels = without(metadata.labels, [PREVIEW_PURPOSE_LABEL, PREVIEW_SESSION_LABEL])
  const annotations = without(metadata.annotations, BOOKKEEPING_ANNOTATIONS)
  const draft: Json = {
    apiVersion: cr.apiVersion,
    kind: cr.kind,
    metadata: {
      ...(Object.keys(annotations).length ? { annotations } : {}),
      ...(Object.keys(labels).length ? { labels } : {}),
      name: metadata.name,
      namespace: ADOPTED_NAMESPACE,
    },
  }
  const spec = asRecord(cr.spec)
  if (spec) {
    const next: Json = structuredClone(spec)
    const refs = asRecord(next.resourcesRefs)
    for (const entry of Array.isArray(refs?.items) ? refs.items : []) {
      const item = asRecord(entry)
      if (item && item.namespace === sandboxNamespace) {
        item.namespace = ADOPTED_NAMESPACE
      }
    }
    const apiRef = asRecord(next.apiRef)
    if (apiRef && apiRef.namespace === sandboxNamespace) {
      apiRef.namespace = ADOPTED_NAMESPACE
    }
    draft.spec = next
  }
  return draft
}

const authHeader = (): Record<string, string> => {
  try {
    return { Authorization: `Bearer ${getAccessToken()}` }
  } catch {
    return {}
  }
}

/** One `/call` GET. The object, or why not — worded for the adopt refusal it becomes part of. */
const readOne = async (base: string, namespace: string, target: SandboxTarget): Promise<Json | string> => {
  const url = new URL(`${base.replace(/\/+$/, '')}/call`)
  const { group, resource, version } = target.gvr
  url.searchParams.set('apiVersion', group ? `${group}/${version}` : version)
  url.searchParams.set('resource', resource)
  url.searchParams.set('name', target.name)
  url.searchParams.set('namespace', namespace)
  try {
    const response = await fetch(url.toString(), { headers: { ...authHeader() } })
    if (response.status === 404) { return `${resource}/${target.name} is not in the sandbox any more` }
    if (response.status === 403) { return `you are not allowed to read ${resource}/${target.name}` }
    if (!response.ok) { return `reading ${resource}/${target.name} answered ${response.status}` }
    const body = asRecord(await response.json().catch(() => null))
    return body && nonEmpty(body.kind) && nonEmpty(asRecord(body.metadata)?.name) ? body : `${resource}/${target.name} is not a Kubernetes object`
  } catch (error) {
    return `snowplow could not be reached (${error instanceof Error ? error.message : String(error)})`
  }
}

const isPreviewDraft = (cr: Json): boolean => asRecord(asRecord(cr.metadata)?.labels)?.[PREVIEW_PURPOSE_LABEL] === PREVIEW_PURPOSE_VALUE

/**
 * Read a legacy page set and rebuild it as a page draft record. Never throws; nothing is written.
 * `retire` is what the provider removes once the tree is held: every object read that carries the
 * preview-draft label — an object the walk reached without it was not put there by a preview, and
 * is not this adoption's to delete.
 */
export const readLegacyPageSet = async (
  snowplowBaseUrl: string | undefined,
  sandboxNamespace: string | undefined,
  rootName: string,
  /** What a refusal says was not done: the same walk serves Adopt and the legacy Discard. */
  purpose: 'adopt' | 'discard' = 'adopt',
  now: () => Date = () => new Date(),
): Promise<LegacyPageRead> => {
  if (!snowplowBaseUrl || !sandboxNamespace) {
    return { message: 'This portal has no preview sandbox configured, so there is no old draft to adopt.', ok: false }
  }
  if (!isLegacyRootName(rootName)) {
    return { message: `"${String(rootName)}" is not the name of a page draft.`, ok: false }
  }
  const refused = (why: string): LegacyPageRead =>
    ({ message: `Nothing was ${purpose === 'adopt' ? 'adopted' : 'deleted'}: ${why}. The old draft is still in the sandbox, unchanged.`, ok: false })
  const rootTarget: SandboxTarget = { gvr: FLEXES, name: rootName }
  const read: { target: SandboxTarget; cr: Json }[] = []
  const seen = new Set<string>([keyOf(rootTarget)])
  const queue: SandboxTarget[] = [rootTarget]
  while (queue.length) {
    const target = queue.shift() as SandboxTarget
    // One object at a time and in order: the walk discovers the next reads from this one's refs.
    // eslint-disable-next-line no-await-in-loop
    const cr = await readOne(snowplowBaseUrl, sandboxNamespace, target)
    if (typeof cr === 'string') {
      return refused(cr)
    }
    if (target === rootTarget && !isPreviewDraft(cr)) {
      return refused(`${rootName} is not a preview draft`)
    }
    // An owner-scoped preview is the live render of someone's RECORD, not a legacy set: its tree is
    // in that record, and deleting its objects would only take the render from under its owner.
    if (target === rootTarget && nonEmpty(asRecord(asRecord(cr.metadata)?.labels)?.[LABEL_OWNER])) {
      return refused(`${rootName} is the preview of a draft that already has an owner`)
    }
    read.push({ cr, target })
    for (const next of sandboxReferencesOf(cr, sandboxNamespace)) {
      if (!seen.has(keyOf(next))) {
        seen.add(keyOf(next))
        queue.push(next)
      }
    }
    if (seen.size > MAX_OBJECTS) {
      return refused(`${rootName} reaches more than ${MAX_OBJECTS} objects, which is not a page`)
    }
  }
  const files = pageDraftFiles(read.map(({ cr }) => toDraftObject(cr, sandboxNamespace)))
  if (!files) {
    return refused(`${rootName} could not be rebuilt as a page — one of its objects has no kind or name`)
  }
  const created = asRecord(read[0].cr.metadata)?.creationTimestamp
  return {
    ok: true,
    record: {
      files,
      kind: 'page',
      name: rootName.replace(/^page-/, ''),
      state: 'open',
      updatedAt: nonEmpty(created) ? created : now().toISOString(),
      version: DRAFT_RECORD_VERSION,
    },
    retire: read.filter(({ cr }) => isPreviewDraft(cr)).map(({ target }) => target),
  }
}

/** The DELETEs that retire a legacy set, as the audited set dispatcher takes them. */
export const legacyDeleteOps = (targets: readonly SandboxTarget[], sandboxNamespace: string): WriteOp[] =>
  targets.map(({ gvr, name }) => {
    const op: ApplyResourceSetOp = { gvr, name, namespace: sandboxNamespace, verb: 'DELETE' }
    return { path: buildSetOpPath(op), verb: op.verb }
  })
