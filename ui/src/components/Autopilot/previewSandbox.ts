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

import Ajv, { type ValidateFunction } from 'ajv'

import { getResourceEndpoint } from '../../utils/utils'

import { type ApplyResourceSetGvr, type ApplyResourceSetOp, MAX_APPLY_SET_OPS } from './applyResourceSet'
import { pluralOf, primeKinds } from './kindResolver'

/** The widget-CR coordinates every draft is normalized to (the live CRD group/version). */
export const WIDGETS_GROUP = 'widgets.templates.krateo.io'
export const WIDGETS_VERSION = 'v1beta1'
export const WIDGETS_API_VERSION = `${WIDGETS_GROUP}/${WIDGETS_VERSION}`

/** RESTAction drafts (a page's data source) ride in the same preview set. */
export const RESTACTION_KIND = 'RESTAction'
export const RESTACTION_GROUP = 'templates.krateo.io'
export const RESTACTION_VERSION = 'v1'
export const RESTACTION_API_VERSION = `${RESTACTION_GROUP}/${RESTACTION_VERSION}`
export const RESTACTIONS_PLURAL = 'restactions'

/** The A.2.2 draft labels: purpose marker + the per-thread session id (teardown/TTL keys). */
export const PREVIEW_PURPOSE_LABEL = 'krateo.io/purpose'
export const PREVIEW_PURPOSE_VALUE = 'preview-draft'
export const PREVIEW_SESSION_LABEL = 'krateo.io/preview-session'

/** DNS-1123 name (same class applyResourceSet's path-segment guard enforces). */
const DNS1123 = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/

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

/** The apiVersion a draft of this kind MUST carry (normalized in the rewrite). */
export const expectedApiVersionOf = (kind: string): string =>
  (kind === RESTACTION_KIND ? RESTACTION_API_VERSION : WIDGETS_API_VERSION)

const draftName = (cr: Record<string, unknown>): string | null => {
  const name = asRecord(cr.metadata)?.name

  return isNonEmptyString(name) ? name : null
}

/** "widgets[2] (Flex/page-root)" — the identity prefix of every validation line. */
const draftLabel = (cr: Record<string, unknown>, index: number): string => {
  const kind = isNonEmptyString(cr.kind) ? cr.kind : '?'

  return `widgets[${index}] (${kind}/${draftName(cr) ?? '?'})`
}

// ────────────────────────────────────────────────────────────────────────────
// Validation — ajv over the CO-LOCATED widget schemas (lazy, cached per kind)
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

// One ajv for all kinds. strict:false — the authored schemas carry doc-oriented
// keywords/defaults ajv's strict mode flags; validation semantics are unaffected.
let ajv: Ajv | null = null
const validators = new Map<string, ValidateFunction>()

const validatorFor = async (kind: string): Promise<ValidateFunction | null> => {
  const cached = validators.get(kind)
  if (cached) {
    return cached
  }
  const loader = schemaLoaderByKind.get(kind)
  if (!loader) {
    return null
  }
  const schema = await loader()
  ajv = ajv ?? new Ajv({ allErrors: true, strict: false })
  const validate = ajv.compile(schema)
  validators.set(kind, validate)

  return validate
}

/**
 * Validate ONE draft CR. The co-located schema validates the `{version, kind, spec}`
 * envelope (the shape the CRDs are generated from — metadata/apiVersion are the
 * apiserver's, not the schema's), so the draft is projected onto it. RESTActions have
 * no frontend schema (spec §7.8, honest gap) → structural checks only; the strict CRD
 * at admission and snowplow's own execution are their real gates.
 */
const validateDraft = async (cr: Record<string, unknown>, index: number): Promise<string[]> => {
  const at = draftLabel(cr, index)
  const errors: string[] = []
  const kind = isNonEmptyString(cr.kind) ? cr.kind : ''
  const gvr = draftGvrOf(kind)
  if (!gvr) {
    return [`${at}: unknown kind — not a registered widget kind or ${RESTACTION_KIND}`]
  }
  const name = draftName(cr)
  if (!name || !DNS1123.test(name)) {
    errors.push(`${at}: metadata.name is required and must be a DNS-1123 name`)
  }
  const expected = expectedApiVersionOf(kind)
  if (cr.apiVersion !== undefined && cr.apiVersion !== expected) {
    errors.push(`${at}: apiVersion must be ${expected}`)
  }
  const spec = asRecord(cr.spec)
  if (!spec) {
    errors.push(`${at}: spec is required`)

    return errors
  }
  if (kind === RESTACTION_KIND) {
    return errors
  }
  const validate = await validatorFor(kind)
  if (!validate) {
    // A kind in the plural table but with no co-located schema would be a build-time
    // drift bug (validate-schemas guards it); fail CLOSED — never apply unvalidated.
    errors.push(`${at}: no co-located schema found for kind ${kind} — draft not validated, refusing to apply`)

    return errors
  }
  if (!validate({ kind, spec, version: WIDGETS_VERSION })) {
    for (const error of validate.errors ?? []) {
      errors.push(`${at}: ${error.instancePath || '(root)'} ${error.message ?? 'invalid'}`)
    }
  }

  return errors
}

/**
 * Validate the WHOLE draft set (A.2.1: any failure → the v1 source drawer with
 * verdicts; garbage is never applied). Returns problem lines for the drawer —
 * EMPTY means every draft is applyable. Also rejects duplicate (kind, name) pairs
 * (the second POST would 409 mid-set) — all-or-nothing, like the set kernel.
 */
export const validatePageDrafts = async (
  drafts: readonly Record<string, unknown>[],
  snowplowBaseUrl?: string,
): Promise<string[]> => {
  // Resolve the kinds before any of them is looked up. Without a base URL nothing resolves and
  // every widget kind reads as unknown — which is why the caller must pass it (previewPageV2 does).
  await primeDraftKinds(drafts, snowplowBaseUrl)
  const problems: string[] = []
  const seen = new Set<string>()
  for (const [index, cr] of drafts.entries()) {
    // eslint-disable-next-line no-await-in-loop -- drafts validate in order; per-kind schema loads are cached after the first hit
    problems.push(...await validateDraft(cr, index))
    const gvr = draftGvrOf(isNonEmptyString(cr.kind) ? cr.kind : '')
    const name = draftName(cr)
    if (gvr && name) {
      const key = `${gvr.resource}/${name}`
      if (seen.has(key)) {
        problems.push(`${draftLabel(cr, index)}: duplicate draft — ${key} appears twice in the set`)
      }
      seen.add(key)
    }
  }

  return problems
}

// ────────────────────────────────────────────────────────────────────────────
// The A.2.2 rewrite — namespace forced to the sandbox, labels stamped, refs fixed
// ────────────────────────────────────────────────────────────────────────────

/**
 * Rewrite every draft for the sandbox (A.2.2). Pure — returns NEW objects:
 *   - `metadata.namespace` is FORCED to the sandbox (whatever the model emitted; the
 *     agent cannot steer a draft elsewhere);
 *   - labels stamped: `krateo.io/purpose=preview-draft` + the per-thread session id;
 *   - `apiVersion` normalized to the kind's real coordinates;
 *   - `spec.resourcesRefs.items[]` and `spec.apiRef` entries that point at OTHER
 *     drafts IN THIS SET (matched by resource/name, and by RESTAction name for
 *     apiRef) are rewritten to the sandbox too — refs into real namespaces (e.g.
 *     reusing a live krateo-system RESTAction) are left intact; reads stay
 *     RBAC-gated per-user anyway.
 * Call AFTER validatePageDrafts (kinds/names are assumed well-formed here).
 */
export const rewriteDraftsForSandbox = (
  drafts: readonly Record<string, unknown>[],
  sandboxNamespace: string,
  sessionId: string,
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
      labels: { ...labels, [PREVIEW_PURPOSE_LABEL]: PREVIEW_PURPOSE_VALUE, [PREVIEW_SESSION_LABEL]: sessionId },
      namespace: sandboxNamespace,
    }
    const spec = asRecord(draft.spec)
    if (spec) {
      const refs = asRecord(spec.resourcesRefs)
      if (refs && Array.isArray(refs.items)) {
        for (const entry of refs.items) {
          const item = asRecord(entry)
          if (item && isNonEmptyString(item.resource) && isNonEmptyString(item.name) && draftKeys.has(`${item.resource}/${item.name}`)) {
            item.namespace = sandboxNamespace
          }
        }
      }
      const apiRef = asRecord(spec.apiRef)
      if (apiRef && isNonEmptyString(apiRef.name) && restActionNames.has(apiRef.name)) {
        apiRef.namespace = sandboxNamespace
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
 */
export const rootDraftTargetOf = (targets: readonly DraftTarget[]): DraftTarget | null =>
  targets.find(({ kind, name }) => kind === 'Flex' && name.startsWith('page-')) ?? null

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
