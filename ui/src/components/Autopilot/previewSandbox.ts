/**
 * W4 previewPage v2 (FE-P4) — the PURE sandbox-draft toolkit behind the live page
 * preview (portal-builder spec, Addendum A.2). The idea: §1.2's "no off-snowplow live
 * preview is possible" stands — so we do not go off-snowplow. The drafts are APPLIED
 * to the quarantined preview sandbox namespace (config api.PREVIEW_SANDBOX_NAMESPACE)
 * through the SAME gated set fabric every other write uses, and the REAL deployed
 * snowplow compiles + serves them; the drawer then renders the ROOT draft's actual
 * `widgetEndpoint`. Nothing is faked, nothing reimplements jq/RESTAction/envelope
 * resolution, zero snowplow changes (e2e-proven live on the release cluster).
 *
 * This module is pure (no React, no dispatch): draft validation against the
 * CO-LOCATED widget schemas (ajv over src/widgets/<Kind>/<Kind>.schema.json — the
 * same JSON the CRDs are generated from, so a draft that passes here matches the
 * strict-CRD admission gate's shape), the A.2.2 namespace/label REWRITE, the ordered
 * apply/teardown op builders (applyResourceSet shapes, ≤10-op chunks), the root
 * endpoint builder, and the drawer-close teardown session. Orchestration lives in
 * previewPageV2.ts; the drawer surface in previewSurface.tsx.
 */

import { getResourceEndpoint } from '../../utils/utils'

import { type ApplyResourceSetGvr, type ApplyResourceSetOp, MAX_APPLY_SET_OPS } from './applyResourceSet'
import { LABEL_OWNER } from './draftRecord'
import { pluralOf, primeKinds } from './kindResolver'
import {
  expectedApiVersionOf,
  isPageRoot,
  lintPageDrafts,
  RESTACTION_GROUP,
  RESTACTION_KIND,
  RESTACTION_VERSION,
  RESTACTIONS_PLURAL,
  WIDGETS_API_VERSION,
  WIDGETS_GROUP,
  WIDGETS_VERSION,
} from './pageLint'

/** The widget-CR and RESTAction coordinates live with the lint (pageLint.ts); re-exported for this module's callers. */
export {
  expectedApiVersionOf,
  RESTACTION_API_VERSION,
  RESTACTION_GROUP,
  RESTACTION_KIND,
  RESTACTION_VERSION,
  RESTACTIONS_PLURAL,
  WIDGETS_API_VERSION,
  WIDGETS_GROUP,
  WIDGETS_VERSION,
} from './pageLint'

/** The A.2.2 draft labels: purpose marker + the per-thread session id (teardown/TTL keys). */
export const PREVIEW_PURPOSE_LABEL = 'krateo.io/purpose'
export const PREVIEW_PURPOSE_VALUE = 'preview-draft'
export const PREVIEW_SESSION_LABEL = 'krateo.io/preview-session'
/** Whose preview a sandbox CR is — the draft-record kernel's owner label, the same key and value. */
export const PREVIEW_OWNER_LABEL = LABEL_OWNER

const asRecord = (value: unknown): Record<string, unknown> | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** The apply target of one draft: its GVR + name (namespace is the sandbox by then). */
export interface DraftTarget {
  gvr: ApplyResourceSetGvr
  name: string
  kind: string
}

/** The GVR a draft's kind maps to — widget kinds via the plural table, RESTAction, or null (unknown). */
/**
 * The GVR for a draft kind, or null.
 *
 * SYNCHRONOUS, reading a cache `primeDraftKinds` fills — the shape `@kubernetes/client-node` uses
 * (async `resource()` at the seam, sync path building after), because the callers that assemble API
 * paths are not async and should not become so.
 *
 * A kind nobody primed reads as unknown. That is the same deny-by-default the old hardcoded table
 * gave, and it fails in the safe direction: an unprimed lookup can only under-permit.
 */
export const draftGvrOf = (kind: string): ApplyResourceSetGvr | null => {
  if (kind === RESTACTION_KIND) {
    return { group: RESTACTION_GROUP, resource: RESTACTIONS_PLURAL, version: RESTACTION_VERSION }
  }
  const plural = pluralOf(WIDGETS_API_VERSION, kind)

  return plural ? { group: WIDGETS_GROUP, resource: plural, version: WIDGETS_VERSION } : null
}

/**
 * Resolve every widget kind in `drafts` before anything reads a GVR. Call this FIRST.
 *
 * RESTAction is excluded: it is a different group with a fixed plural this module owns, not a
 * discovered widget kind.
 */
export const primeDraftKinds = async (
  drafts: readonly Record<string, unknown>[],
  snowplowBaseUrl?: string,
): Promise<void> => {
  const kinds = drafts
    .map((cr) => (isNonEmptyString(cr.kind) ? cr.kind : ''))
    .filter((kind) => kind && kind !== RESTACTION_KIND)
  await primeKinds(snowplowBaseUrl, WIDGETS_API_VERSION, kinds)
}

const draftName = (cr: Record<string, unknown>): string | null => {
  const name = asRecord(cr.metadata)?.name

  return isNonEmptyString(name) ? name : null
}

// ────────────────────────────────────────────────────────────────────────────
// Validation — the page lint over the CO-LOCATED widget schemas (lazy, cached per kind)
// ────────────────────────────────────────────────────────────────────────────

/** Lazy glob of every co-located widget schema, keyed by its kind (the file basename —
 * e.g. Flex.schema.json → Flex, Listy.schema.json → Listy). Loaded on first use. */
const schemaLoaders = import.meta.glob<Record<string, unknown>>('../../widgets/*/*.schema.json', { import: 'default' })

const schemaLoaderByKind = new Map<string, () => Promise<Record<string, unknown>>>(
  Object.entries(schemaLoaders).map(([path, loader]) => {
    const base = path.split('/').pop() ?? path

    return [base.replace(/\.schema\.json$/, ''), loader]
  }),
)

/**
 * Validate the WHOLE draft set — the pure page lint (pageLint.ts) over this portal's own sources:
 * the co-located schemas through the glob above, and the plurals snowplow's discovery resolver
 * answers. Returns problem lines for the drawer — EMPTY means every draft is applyable.
 */
export const validatePageDrafts = async (
  drafts: readonly Record<string, unknown>[],
  snowplowBaseUrl?: string,
): Promise<string[]> => {
  // Resolve the kinds before any of them is looked up. Without a base URL nothing resolves and
  // every widget kind reads as unknown — which is why the caller must pass it (previewPageV2 does).
  await primeDraftKinds(drafts, snowplowBaseUrl)

  return lintPageDrafts(drafts, {
    pluralOf: (kind) => pluralOf(WIDGETS_API_VERSION, kind),
    schemaFor: (kind) => schemaLoaderByKind.get(kind)?.() ?? null,
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Owner-scoped sandbox names — two people previewing the same page never collide
// ────────────────────────────────────────────────────────────────────────────

/** Kubernetes' name ceiling we hold every sandbox name to (a DNS-1123 label, so it also fits a label value). */
const MAX_SANDBOX_NAME = 63

/** FNV-1a, 32-bit, as 8 hex characters. Not a security hash — it only has to spread names apart. */
const hash8 = (text: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * The tag every sandbox name of this owner ends in: 8 hex characters of the owner.
 *
 * WHY A HASH AND NOT THE OWNER ITSELF. The owner is already on the object, readable and queryable,
 * as the `krateo.io/draft-owner` label — the name's only job is to be DIFFERENT from every other
 * owner's. A raw-owner suffix cannot promise that: `x` by `alice-bob` and `x-alice` by `bob` both
 * come out `x-alice-bob`, because a suffix has no delimiter the owner cannot also contain. And the
 * owner can be 40 characters, which would leave a page slug 22. A fixed-width tag has neither
 * problem: it always takes 9 characters, and the SET of names one owner can produce (everything
 * ending in their tag) is disjoint from another owner's whenever the two tags differ — 32 bits, so
 * a clash needs tens of thousands of users before it is even plausible.
 */
export const ownerTagOf = (owner: string): string => hash8(`owner:${owner}`)

/**
 * The name a draft gets in the sandbox: `<name>-<owner tag>`, a DNS-1123 name within 63 characters.
 *
 * THE PROBLEM IT SOLVES. Draft names are derived from the page (`page-<slug>`, `<name>-card`, …),
 * so two people previewing `my-page` wrote the SAME names into the one shared sandbox. The pre-apply
 * sweep deletes every name it is about to write, whoever wrote it; the 409 reclaim deletes whatever
 * is in the way, whoever put it there. Both are right for a crashed tab of one's OWN and were wrong
 * for a colleague's live preview, which vanished mid-edit. Scoping the name makes both safe without
 * changing either: they only ever name what this owner could have written.
 *
 * TRUNCATION KEEPS BOTH GUARANTEES. A name too long for `<name>-<tag>` is cut, and the cut is
 * followed by a hash of the FULL name before the owner tag — `<first 45>-<hash of name>-<tag>` — so
 * two long names sharing a prefix stay distinct within one owner's set, and the owner tag is never
 * the part that gets cut. The name keeps its readable head (the `page-` prefix the root is found
 * by survives any cut).
 *
 * IDEMPOTENT: a name already ending in this owner's tag is returned as-is, so scoping twice — a
 * resume handed a name that was already scoped — cannot stack tags.
 */
export const sandboxDraftName = (name: string, owner: string): string => {
  const tag = `-${ownerTagOf(owner)}`
  if (name.endsWith(tag)) {
    return name
  }
  if (name.length + tag.length <= MAX_SANDBOX_NAME) {
    return `${name}${tag}`
  }
  const nameHash = `-${hash8(name)}`
  const head = name.slice(0, MAX_SANDBOX_NAME - nameHash.length - tag.length).replace(/[-.]+$/, '')
  return `${head}${nameHash}${tag}`
}

// ────────────────────────────────────────────────────────────────────────────
// The A.2.2 rewrite — namespace forced to the sandbox, labels stamped, refs fixed
// ────────────────────────────────────────────────────────────────────────────

/**
 * Rewrite every draft for the sandbox (A.2.2). Pure — returns NEW objects:
 *   - `metadata.namespace` is FORCED to the sandbox (whatever the model emitted; the
 *     agent cannot steer a draft elsewhere);
 *   - `metadata.name` is OWNER-SCOPED (`sandboxDraftName`) — the sandbox is shared, and two
 *     people previewing the same page must not write, sweep or reclaim each other's objects;
 *   - labels stamped: `krateo.io/purpose=preview-draft`, the per-thread session id, and
 *     `krateo.io/draft-owner` (the draft-record kernel's owner, so a listing can filter by it);
 *   - `apiVersion` normalized to the kind's real coordinates;
 *   - `spec.resourcesRefs.items[]`, `spec.resourcesRefsTemplate[].template` and `spec.apiRef`
 *     entries that point at OTHER drafts IN THIS SET (matched by resource/name, and by
 *     RESTAction name for apiRef) are re-pointed to the sandbox AND to the scoped name — a
 *     ref that followed the namespace but not the rename would resolve to nothing, and the
 *     page would render empty. Refs into real namespaces (e.g. reusing a live krateo-system
 *     RESTAction) are left intact; reads stay RBAC-gated per-user anyway.
 *
 * The rename exists ONLY here, in the copy that is applied. The held draft — what the Files tab
 * shows and what a publish writes — is built from the drafts as authored, never from this output.
 * Call AFTER validatePageDrafts (kinds/names are assumed well-formed here).
 */
export const rewriteDraftsForSandbox = (
  drafts: readonly Record<string, unknown>[],
  sandboxNamespace: string,
  sessionId: string,
  /** `draftOwner(username)` — the kernel's sanitized owner (draftRecord.ts). */
  owner: string,
): Record<string, unknown>[] => {
  // The set's own identities: "<plural>/<name>" for ref-items, RESTAction names for apiRef.
  const draftKeys = new Set<string>()
  const restActionNames = new Set<string>()
  for (const cr of drafts) {
    const kind = isNonEmptyString(cr.kind) ? cr.kind : ''
    const gvr = draftGvrOf(kind)
    const name = draftName(cr)
    if (gvr && name) {
      draftKeys.add(`${gvr.resource}/${name}`)
      if (kind === RESTACTION_KIND) {
        restActionNames.add(name)
      }
    }
  }

  return drafts.map((cr) => {
    const draft = structuredClone(cr)
    const kind = isNonEmptyString(draft.kind) ? draft.kind : ''
    draft.apiVersion = expectedApiVersionOf(kind)
    const metadata = asRecord(draft.metadata) ?? {}
    const labels = asRecord(metadata.labels) ?? {}
    draft.metadata = {
      ...metadata,
      labels: {
        ...labels,
        [PREVIEW_OWNER_LABEL]: owner,
        [PREVIEW_PURPOSE_LABEL]: PREVIEW_PURPOSE_VALUE,
        [PREVIEW_SESSION_LABEL]: sessionId,
      },
      ...(isNonEmptyString(metadata.name) ? { name: sandboxDraftName(metadata.name, owner) } : {}),
      namespace: sandboxNamespace,
    }
    // A ref naming a draft in this set follows it: into the sandbox, and to its scoped name.
    const repoint = (ref: Record<string, unknown> | null): void => {
      if (ref && isNonEmptyString(ref.resource) && isNonEmptyString(ref.name) && draftKeys.has(`${ref.resource}/${ref.name}`)) {
        ref.namespace = sandboxNamespace
        ref.name = sandboxDraftName(ref.name, owner)
      }
    }
    const spec = asRecord(draft.spec)
    if (spec) {
      const refs = asRecord(spec.resourcesRefs)
      if (refs && Array.isArray(refs.items)) {
        refs.items.forEach((entry) => { repoint(asRecord(entry)) })
      }
      // The per-item template is a ref too: a literal name in it resolves exactly like an item's.
      if (Array.isArray(spec.resourcesRefsTemplate)) {
        spec.resourcesRefsTemplate.forEach((entry) => { repoint(asRecord(asRecord(entry)?.template)) })
      }
      const apiRef = asRecord(spec.apiRef)
      if (apiRef && isNonEmptyString(apiRef.name) && restActionNames.has(apiRef.name)) {
        apiRef.namespace = sandboxNamespace
        apiRef.name = sandboxDraftName(apiRef.name, owner)
      }
    }

    return draft
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Op builders — applyResourceSet shapes, ≤10-op chunks, root endpoint
// ────────────────────────────────────────────────────────────────────────────

/** The apply targets of a REWRITTEN set, in order (null entries impossible post-validation). */
export const draftTargetsOf = (rewritten: readonly Record<string, unknown>[]): DraftTarget[] =>
  rewritten.flatMap((cr) => {
    const kind = isNonEmptyString(cr.kind) ? cr.kind : ''
    const gvr = draftGvrOf(kind)
    const name = draftName(cr)

    return gvr && name ? [{ gvr, kind, name }] : []
  })

/** One POST per rewritten draft, in set order (the applyResourceSet op shape). */
export const buildSandboxApplyOps = (rewritten: readonly Record<string, unknown>[], sandboxNamespace: string): ApplyResourceSetOp[] =>
  rewritten.flatMap((cr) => {
    const gvr = draftGvrOf(isNonEmptyString(cr.kind) ? cr.kind : '')
    const name = draftName(cr)

    return gvr && name ? [{ gvr, name, namespace: sandboxNamespace, payload: cr, verb: 'POST' as const }] : []
  })

/** Best-effort teardown: one DELETE per applied target (A.2.5 — drawer close / re-preview). */
export const buildSandboxTeardownOps = (targets: readonly DraftTarget[], sandboxNamespace: string): ApplyResourceSetOp[] =>
  targets.map(({ gvr, name }) => ({ gvr, name, namespace: sandboxNamespace, verb: 'DELETE' as const }))

/** Chunk the ordered ops at the fabric's ≤10-op cap (pages >10 CRs = sequential sets, A.2.3). */
export const chunkSetOps = (ops: readonly ApplyResourceSetOp[]): ApplyResourceSetOp[][] => {
  const chunks: ApplyResourceSetOp[][] = []
  for (let start = 0; start < ops.length; start += MAX_APPLY_SET_OPS) {
    chunks.push(ops.slice(start, start + MAX_APPLY_SET_OPS))
  }

  return chunks
}

/** The ROOT draft = the FIRST widget-kind entry (A.2.4; RESTActions are data, not a page root). */
/**
 * The draft the drawer mounts as THE PAGE — exactly the production model: the portal shell
 * boots from its configured INIT endpoint, and a page preview boots from the page's OWN
 * entry, the `page-<slug>` root Flex (the page identity the publish gate requires). The
 * model's draft ORDER is NOT a contract and is never used to pick the entry (picking "the
 * first widget" used to mount a lone child as the whole preview — the silent one-widget
 * page). No page-* root Flex → there is NO page entry to mount; the caller falls back to
 * the source drawer with the actionable message.
 *
 * Read on the REWRITTEN targets, so the entry is the owner-scoped `page-<slug>-<tag>` and the live
 * endpoint built from it (buildSandboxWidgetEndpoint) is this owner's page, not a colleague's. The
 * `page-` prefix is what finds it, and `sandboxDraftName` never cuts a name's head.
 */
export const rootDraftTargetOf = (targets: readonly DraftTarget[]): DraftTarget | null =>
  targets.find(({ kind, name }) => isPageRoot(kind, name)) ?? null

/**
 * The root draft's REAL served `widgetEndpoint` — built exactly the way snowplow's
 * resourcesRefs paths look (the shared getResourceEndpoint shape WidgetRenderer /
 * useWidgetQuery consume): /call?resource=…&apiVersion=…&name=…&namespace=….
 */
export const buildSandboxWidgetEndpoint = (root: DraftTarget, sandboxNamespace: string): string =>
  getResourceEndpoint({
    apiVersion: `${root.gvr.group}/${root.gvr.version}`,
    name: root.name,
    namespace: sandboxNamespace,
    resource: root.gvr.resource,
  })

/** The child ref ids the ROOT draft declares (spec.resourcesRefs.items[].id) — what the
 * A.2.35 warm-up gate requires the SERVED root to have RESOLVED before the drawer opens. */
export const rootChildRefIdsOf = (rootDraft: Record<string, unknown> | undefined): string[] => {
  const items = asRecord(asRecord(asRecord(rootDraft ?? {})?.spec)?.resourcesRefs)?.items
  if (!Array.isArray(items)) {
    return []
  }

  return items.map((item) => asRecord(item)?.id).filter(isNonEmptyString)
}

// ────────────────────────────────────────────────────────────────────────────
// The teardown session (provider-scoped, like the KOG preview gate)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Holds the CURRENTLY-applied preview's teardown ops between the apply and the
 * drawer close. Epoch-guarded: draft names repeat across iterations of the same
 * page, so a STALE drawer-close (its payload already replaced by a fresh preview)
 * must NOT delete the newly-applied drafts — `takeIf` is a no-op unless the epoch
 * matches. `take` (un-guarded) is the pre-apply sweep: whatever is still applied
 * from the previous preview is deleted before the next POST set (latest wins,
 * and a re-used name never 409s).
 */
export interface PreviewPageSession {
  /** Record the applied preview's teardown ops; returns its epoch (for the drawer's onClose). */
  record: (teardownOps: readonly ApplyResourceSetOp[]) => number
  /** Take-and-clear whatever is held (the pre-apply sweep of the PREVIOUS preview). */
  take: () => ApplyResourceSetOp[]
  /** Take-and-clear ONLY if `epoch` is still current (the drawer-close path). */
  takeIf: (epoch: number) => ApplyResourceSetOp[]
}

export const createPreviewPageSession = (): PreviewPageSession => {
  let epoch = 0
  let held: ApplyResourceSetOp[] = []
  const take = (): ApplyResourceSetOp[] => {
    const ops = held
    held = []

    return ops
  }

  return {
    record: (teardownOps) => {
      held = [...teardownOps]
      epoch += 1

      return epoch
    },
    take,
    takeIf: (at) => (at === epoch ? take() : []),
  }
}
