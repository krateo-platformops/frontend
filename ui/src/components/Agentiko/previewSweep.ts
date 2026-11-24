/**
 * THE AUTHOR'S OWN ABANDONED PREVIEWS (frontend#496).
 *
 * A live preview writes widget CRs into the sandbox, and what to remove afterwards is known only to
 * the tab that wrote them (previewSandbox.ts, the teardown session): a reload, a closed tab or a crash
 * loses it, and nothing else removed them. Two such pages, 23 objects, were on krateo-057 for four days.
 *
 * Diego's decision (2026-11-24): the author's NEXT VISIT to a builder removes them, as the author,
 * through the audited set fabric every preview uses. Only a preview that
 *   - is the author's own: `krateo.io/draft-owner` is theirs, on the root and on every object removed.
 *     A preview with no owner is never touched ("Unowned drafts" keeps those until a person chooses);
 *   - can be rebuilt: its page's draft record exists. The record is written ahead of the preview, so
 *     opening the draft again previews the same page;
 *   - is abandoned: neither the record nor the root was written for a day, and it is not the draft
 *     held here now.
 * An object a preview that stays still refers to stays too. Anything unread, unresolved or unclear
 * removes nothing: a kept leftover costs a little space, a wrong delete costs someone their page.
 */
import type { WriteOpResult } from '../../hooks/runRestSet'
import type { WidgetTransport } from '../../transport/widgetTransport'
import { getUserInfo } from '../../utils/getUserInfo'

import { legacyDeleteOps, sandboxReferencesOf, type SandboxTarget } from './adoptLegacyPage'
import { isApplySetAllowed, MAX_APPLY_SET_OPS } from './applyResourceSet'
import type { SandboxWriter } from './blueprintRenderSandbox'
import { draftOwner, draftRecordName, LABEL_OWNER, UNKNOWN_OWNER } from './draftRecord'
import { readDraftRecordByName, type RecordRead } from './draftResume'
import { isPageRoot } from './pageLint'
import {
  buildSandboxTeardownOps,
  chunkSetOps,
  draftGvrOf,
  type DraftTarget,
  ownerTagOf,
  PREVIEW_PURPOSE_LABEL,
  PREVIEW_PURPOSE_VALUE,
  primeDraftKinds,
  RESTACTION_KIND,
} from './previewSandbox'

export const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000
const READ_TIMEOUT_MS = 15_000

type Json = Record<string, unknown>
const asRecord = (value: unknown): Json | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null)
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const keyOf = ({ gvr, name }: Pick<SandboxTarget, 'gvr' | 'name'>): string => `${gvr.group}/${gvr.resource}/${name}`

interface OwnObject {
  cr: Json
  created: number
  key: string
  kind: string
  name: string
  target: DraftTarget
}

/** The listed objects that are this owner's preview drafts and whose kind this portal knows. */
const ownObjects = (listed: readonly Json[], owner: string): OwnObject[] => listed.flatMap((cr) => {
  const metadata = asRecord(cr.metadata)
  const labels = asRecord(metadata?.labels)
  const kind = text(cr.kind)
  const name = text(metadata?.name)
  const gvr = kind ? draftGvrOf(kind) : null
  if (!name || !gvr || labels?.[PREVIEW_PURPOSE_LABEL] !== PREVIEW_PURPOSE_VALUE || labels[LABEL_OWNER] !== owner) { return [] }
  return [{ cr, created: Date.parse(text(metadata?.creationTimestamp)), key: keyOf({ gvr, name }), kind, name, target: { gvr, kind, name } }]
})

/**
 * The page a scoped root previews, or null when it is not this owner's root. A name that was CUT to fit
 * (sandboxDraftName) reads as a page that does not exist: no record has that name, so it is kept.
 */
export const pageOfRoot = (rootName: string, owner: string): string | null => {
  const tag = `-${ownerTagOf(owner)}`
  if (!rootName.startsWith('page-') || !rootName.endsWith(tag)) { return null }
  return rootName.slice('page-'.length, -tag.length) || null
}

export interface SweepPlan {
  pages: string[]
  targets: DraftTarget[]
}

/**
 * What to remove, from what is there. Pure. `savedAt` is when each page's record was last saved, for the
 * pages that HAVE one; a page absent from it keeps its preview.
 */
export const planPreviewSweep = (
  listed: readonly Json[],
  { heldPage, now, owner, sandboxNamespace, savedAt }: {
    heldPage?: string
    now: number
    owner: string
    sandboxNamespace: string
    savedAt: ReadonlyMap<string, number>
  },
): SweepPlan => {
  const own = ownObjects(listed, owner)
  const byKey = new Map(own.map((object) => [object.key, object]))
  const reach = (root: OwnObject): Set<string> => {
    const seen = new Set([root.key])
    const queue = [root]
    for (let at = queue.shift(); at; at = queue.shift()) {
      for (const next of sandboxReferencesOf(at.cr, sandboxNamespace)) {
        const object = byKey.get(keyOf(next))
        if (object && !seen.has(object.key)) {
          seen.add(object.key)
          queue.push(object)
        }
      }
    }
    return seen
  }
  // A page-* Flex another object names is a nested layout, not a page of its own.
  const named = new Set(own.flatMap(({ cr }) => sandboxReferencesOf(cr, sandboxNamespace).map(keyOf)))
  const roots = own.filter(({ key, kind, name }) => isPageRoot(kind, name) && !named.has(key))
  const abandoned = roots.filter((root) => {
    const page = pageOfRoot(root.name, owner)
    const saved = page === null ? undefined : savedAt.get(page)
    return page !== null && page !== heldPage && saved !== undefined
      && now - saved > ABANDONED_AFTER_MS && now - root.created > ABANDONED_AFTER_MS
  })
  const gone = new Set(abandoned)
  const kept = new Set(roots.filter((root) => !gone.has(root)).flatMap((root) => [...reach(root)]))
  const remove = new Set(abandoned.flatMap((root) => [...reach(root)]).filter((key) => !kept.has(key)))
  return {
    pages: abandoned.flatMap((root) => pageOfRoot(root.name, owner) ?? []),
    // Roots last: a removal that stops half way leaves the root, and the next visit finds it again.
    targets: own.filter(({ key }) => remove.has(key))
      .sort((left, right) => Number(gone.has(left)) - Number(gone.has(right)))
      .map(({ target }) => target),
  }
}

/** snowplow's collection read, as the person: every object of a category, or null when it was not read. */
const listCategory = async (fetchAs: WidgetTransport['fetch'], base: string, namespace: string, category: string): Promise<Json[] | null> => {
  try {
    const url = new URL(`${base.replace(/\/+$/, '')}/list`)
    url.searchParams.set('category', category)
    url.searchParams.set('ns', namespace)
    const response = await fetchAs(url.toString(), { signal: AbortSignal.timeout(READ_TIMEOUT_MS) })
    const items: unknown = response.ok ? await response.json() : null
    return Array.isArray(items) ? items.map(asRecord).filter((item) => item !== null) : null
  } catch {
    return null
  }
}

export interface SweepDeps {
  /** The signed-in transport's fetch: this module never reads the token (transport/tokenReach.test.ts). */
  fetch: WidgetTransport['fetch']
  /** The page draft held in this tab, read when it matters: again right before deleting. */
  heldPage: () => string | undefined
  now?: () => number
  readRecord?: (name: string) => Promise<RecordRead>
  snowplowBaseUrl?: string
  username?: () => string | undefined
  writer: SandboxWriter
}

/** Remove the author's own abandoned previews. Never throws; the pages removed, or why nothing was. */
export const sweepOwnPreviews = async (deps: SweepDeps): Promise<{ pages: string[]; removed: number } | string> => {
  const { snowplowBaseUrl, writer } = deps
  const { sandboxNamespace } = writer
  const owner = draftOwner((deps.username ?? (() => getUserInfo().username))())
  if (!snowplowBaseUrl || owner === UNKNOWN_OWNER) { return 'not signed in, or no snowplow' }
  const [widgets, actions] = await Promise.all([
    listCategory(deps.fetch, snowplowBaseUrl, sandboxNamespace, 'widgets'),
    listCategory(deps.fetch, snowplowBaseUrl, sandboxNamespace, 'actions'),
  ])
  if (!widgets || !actions) { return 'the sandbox was not read' }
  const listed = [...widgets, ...actions.filter(({ kind }) => kind === RESTACTION_KIND)]
  await primeDraftKinds(listed, snowplowBaseUrl)
  const readRecord = deps.readRecord ?? ((name: string) => readDraftRecordByName(snowplowBaseUrl, sandboxNamespace, name))
  const pages = [...new Set(ownObjects(listed, owner).flatMap(({ kind, name }) => (isPageRoot(kind, name) ? pageOfRoot(name, owner) ?? [] : [])))]
  const savedAt = new Map<string, number>()
  for (const page of pages) {
    // eslint-disable-next-line no-await-in-loop -- a handful of reads, one at a time
    const read = await readRecord(draftRecordName('page', owner, page))
    const saved = read.ok && read.record.kind === 'page' && read.record.name === page ? Date.parse(read.record.updatedAt) : Number.NaN
    if (!Number.isNaN(saved)) { savedAt.set(page, saved) }
  }
  const plan = planPreviewSweep(listed, { heldPage: deps.heldPage(), now: (deps.now ?? Date.now)(), owner, sandboxNamespace, savedAt })
  const ops = buildSandboxTeardownOps(plan.targets, sandboxNamespace)
  if (!chunkSetOps(ops).every((chunk) => isApplySetAllowed(chunk, sandboxNamespace))) { return 'outside the sandbox write scope' }
  let removed = 0
  for (let at = 0; at < plan.targets.length; at += MAX_APPLY_SET_OPS) {
    const set = legacyDeleteOps(plan.targets.slice(at, at + MAX_APPLY_SET_OPS), sandboxNamespace)
    let results: WriteOpResult[] | null = null
    try {
      // eslint-disable-next-line no-await-in-loop -- the fabric's sets are sequential
      results = await writer.handleActionSet(set, { silent: true, skipConfirmForSandbox: sandboxNamespace })
    } catch {
      return 'the sandbox could not be written'
    }
    removed += results?.filter(({ ok }) => ok).length ?? 0
    // Already gone is done; any other refusal stops here, before the roots.
    if (!results || results.some(({ ok, status }) => !ok && status !== 404)) { return 'the sandbox refused a removal' }
  }
  return { pages: plan.pages, removed }
}

// One sweep per document: what it finds cannot become abandoned again within a visit.
let sweep: Promise<unknown> | null = null

/** Start the sweep once per document. */
export const startPreviewSweep = (deps: SweepDeps): void => {
  sweep ??= sweepOwnPreviews(deps).catch(() => undefined)
}

/** A preview waits for a sweep in flight, so the two never write the same objects at once. */
export const previewSweepSettled = async (): Promise<void> => { await sweep }

/** Test-only: a fresh document. */
export const resetPreviewSweep = (): void => { sweep = null }
