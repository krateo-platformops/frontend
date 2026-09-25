/**
 * P1 applySet — the SCOPED, human-gated `applyResourceSet` mutating portal-verb for
 * builder/fleet flows: apply ONE ORDERED set of up to MAX_APPLY_SET_OPS Krateo objects
 * through the W0-4 fabric (`runRestSet`), which replaces the vetoed snowplow /callset
 * with N sequential calls to the EXISTING endpoint — zero snowplow changes.
 *
 * GOVERNING INVARIANT (unchanged, mirrors `patchField`): Autopilot never mutates
 * directly and never reimplements behaviour — it drives the REAL portal by compiling a
 * proposal into the canonical write path. Like `patchField`, this is deliberately NOT a
 * read-only registry verb (READONLY_VERB_REGISTRY is read-only by construction): it is
 * a DISTINCT mutating branch owned by the bridge. Two independent safety layers gate it:
 *   1. `isApplySetAllowed` (below) — a pure, defense-in-depth scoping kernel, BROADER
 *      than patchField's composition-only rule because builder/fleet flows write
 *      CompositionDefinitions / config, but still NEVER an arbitrary cluster
 *      resource: (a) at most MAX_APPLY_SET_OPS ops, (b) every op's group must
 *      END with `.krateo.io`, OR be the core group ('') for ConfigMaps ONLY, AND
 *      (c) the NEVER-HAND-APPLY rule (Addendum A.3): widget CRs
 *      (`widgets.templates.krateo.io`) and `restactions` are DENIED — production
 *      widget CRs reach the cluster ONLY via the chart (GitOps), a hand-applied one
 *      orphans from Helm and wedges the next composition render — EXCEPT when the
 *      op's namespace EXACTLY equals the configured preview sandbox
 *      (config api.PREVIEW_SANDBOX_NAMESPACE; absent config ⇒ no exception). The
 *      sandbox is BY DESIGN outside every Helm release, quota-bounded and
 *      TTL-swept, so the carve-out never widens the fabric. And (d) NEVER-WRITE-GIT:
 *      github.krateo.io gitrefs / repocontents / pullrequests are DENIED everywhere —
 *      publishing is one BuilderPublish claim. Anything else is
 *      REJECTED here — the branch returns null, exactly like an unknown verb.
 *   2. The W0-4 gate — the compiled ops are dispatched via `deps.handleActionSet` →
 *      `runRestSet`, whose aggregated set-level BlastRadiusConfirm (ordered op list,
 *      per-op irreversible flag) ALWAYS blocks on ONE human confirm for the WHOLE set.
 *      Decline = nothing dispatched. This module NEVER bypasses that gate; the scoping
 *      kernel is purely additive on top of it.
 */

import type { MutatingVerb } from '../../hooks/blastRadius.types'
import { buildCallWritePath } from '../../hooks/callPath'
import type { WriteOp, WriteOpResult } from '../../hooks/runRestSet'
import { isMutatingVerb } from '../BlastRadius/buildBlastRadius'

/** The GVR (group/version/resource) one op targets. Core group is the empty string. */
export interface ApplyResourceSetGvr {
  group: string
  version: string
  resource: string
}

/** One ordered op of an `applyResourceSet` proposal (index order = dispatch order). */
export interface ApplyResourceSetOp {
  verb: MutatingVerb
  gvr: ApplyResourceSetGvr
  namespace: string
  /** Object name — REQUIRED for PUT/PATCH/DELETE (a named target); optional for POST (collection create). */
  name?: string
  /** Request body for POST/PUT/PATCH; a DELETE carries none. */
  payload?: unknown
}

/** The mutating `applyResourceSet` proposal shape (a superset of PortalActionProposal fields). */
export interface ApplyResourceSetProposal {
  verb: 'applyResourceSet'
  /** The ORDERED write ops — executed sequentially, stop on first error. */
  ops: ApplyResourceSetOp[]
  label?: string
}

/** Hard op-count cap: a builder/fleet set is small by design; anything larger is denied outright. */
export const MAX_APPLY_SET_OPS = 10

/**
 * The Krateo-owned group suffix. Every Krateo API group ENDS with `.krateo.io`
 * (core.krateo.io, <name>.composition.krateo.io, widgets.templates.krateo.io, …) —
 * scoping to this suffix (plus core ConfigMaps) is what confines the set fabric to
 * Krateo objects, NEVER an arbitrary cluster resource (a Deployment, a Secret, RBAC, …).
 */
export const KRATEO_GROUP_SUFFIX = '.krateo.io'

/** The widget-CR group — the never-hand-apply surface (chart/GitOps delivery ONLY). */
export const WIDGETS_TEMPLATES_GROUP = 'widgets.templates.krateo.io'

/** The RESTAction plural — same never-hand-apply rule (matched on ANY group, defensive). */
export const RESTACTIONS_RESOURCE = 'restactions'

/**
 * NEVER-WRITE-GIT: the github.krateo.io objects that write to a repository — a branch, a file, a
 * pull request. The frontend publishes through ONE BuilderPublish claim (git-provider commits the
 * files, the builder-publish composition opens the change request); the host-built GitHub op set
 * that wrote these directly was removed 2026-09-25. So no set the agent proposes may write them
 * either — otherwise the legacy path survives as a model-emitted back door, outside the preview
 * gate's publish flow. The prompt already says never to hand-write them; this makes it true.
 */
export const GITHUB_GIT_WRITE_GROUP = 'github.krateo.io'
export const GIT_WRITE_RESOURCES: readonly string[] = ['gitrefs', 'repocontents', 'pullrequests']

/** True when the op would write a branch, file or pull request through github.krateo.io. */
export const isGitWriteTarget = (gvr: ApplyResourceSetGvr): boolean =>
  gvr.group === GITHUB_GIT_WRITE_GROUP && GIT_WRITE_RESOURCES.includes(gvr.resource)

/**
 * True when the op targets the NEVER-HAND-APPLY surface (widget CRs / RESTActions —
 * the objects the portal composition renders from the chart). These are writable
 * through the set fabric ONLY into the configured preview sandbox namespace (A.3).
 */
export const isSandboxOnlyTarget = (gvr: ApplyResourceSetGvr): boolean =>
  gvr.group === WIDGETS_TEMPLATES_GROUP || gvr.resource === RESTACTIONS_RESOURCE

/**
 * Group allowlist: a Krateo-owned group (ends with `.krateo.io`) OR the core group ('')
 * for ConfigMaps ONLY (portal/blueprint config rides in ConfigMaps; no other core kind
 * — never a Secret, Pod, ServiceAccount, … — is writable through this verb). The
 * widgets/restactions deny is NAMESPACE-dependent, so it lives in `isSetOpAllowed`
 * (this predicate cannot see the op's namespace).
 */
export const isSetOpGroupAllowed = (gvr: ApplyResourceSetGvr | undefined): boolean => {
  if (typeof gvr?.group !== 'string' || typeof gvr.resource !== 'string') {
    return false
  }
  if (gvr.group.endsWith(KRATEO_GROUP_SUFFIX)) {
    return true
  }

  return gvr.group === '' && gvr.resource === 'configmaps'
}

/**
 * DNS-1123-ish path-segment guard: name/namespace are interpolated into the op's
 * apiserver URL by buildSetOpPath, so they must be single clean segments — a `/`
 * would re-target a SUBRESOURCE (e.g. `foo/status`) and `?#%` would smuggle query
 * or encoding tricks past the confirm. Mirrors patchField's rejection of path
 * characters in field keys (same defense-in-depth posture).
 */
const isPathSegment = (value: string): boolean => /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(value)

/**
 * One op's shape + scope check: a mutating verb, a complete GVR + namespace, a name
 * unless it is a collection POST, clean path segments, the group allowlist, and the
 * A.3 sandbox carve-out. Pure predicate.
 *
 * `sandboxNamespace` is config api.PREVIEW_SANDBOX_NAMESPACE (or undefined when the
 * install has no sandbox). The A.3 rule, verbatim:
 *   DENY   gvr.group == 'widgets.templates.krateo.io' || gvr.resource == 'restactions'
 *   EXCEPT op.namespace === sandboxNamespace   // absent config ⇒ no exception
 * EXACT string equality — no prefix, no glob. The carve-out never widens the fabric.
 */
export const isSetOpAllowed = (op: ApplyResourceSetOp | undefined, sandboxNamespace?: string): boolean => {
  if (!op || !isMutatingVerb(op.verb)) {
    return false
  }
  const { gvr, name, namespace } = op
  if (!gvr || typeof gvr.version !== 'string' || !gvr.version || typeof gvr.resource !== 'string' || !gvr.resource) {
    return false
  }
  if (typeof namespace !== 'string' || !isPathSegment(namespace)) {
    return false
  }
  // Only a POST may omit the name (create into the collection); PUT/PATCH/DELETE target a named object.
  if (op.verb !== 'POST' && (typeof name !== 'string' || !name)) {
    return false
  }
  // A present name must be a clean segment even on POST (it rides into the payload/path).
  if (name !== undefined && (typeof name !== 'string' || !isPathSegment(name))) {
    return false
  }
  if (!isSetOpGroupAllowed(gvr) || isGitWriteTarget(gvr)) {
    return false
  }

  // NEVER-HAND-APPLY (A.3): widget CRs / restactions only ever reach the cluster
  // through this fabric inside the preview sandbox. `namespace === undefined-config`
  // can never hold (namespace is a validated string), so no config ⇒ total deny.
  return !isSandboxOnlyTarget(gvr) || namespace === sandboxNamespace
}

/** Runtime array guard that keeps the element type (Array.isArray alone widens to any[]). */
const isOpArray = (value: unknown): value is readonly ApplyResourceSetOp[] => Array.isArray(value)

/**
 * The SET SAFETY KERNEL. Pure predicate: is this ordered op list allowed to dispatch?
 *   ALLOW  — a non-empty list of at most MAX_APPLY_SET_OPS ops, EVERY op passing
 *            isSetOpAllowed (mutating verb, complete target, allowlisted group, and
 *            the widgets/restactions sandbox carve-out — see isSetOpAllowed).
 *   REJECT — empty, oversized, or ANY op out of scope (all-or-nothing: one bad op
 *            denies the whole set — never a silent partial dispatch).
 * Defense-in-depth ON TOP of the human W0-4 set confirm — never a substitute for it.
 */
export const isApplySetAllowed = (ops: readonly ApplyResourceSetOp[] | undefined, sandboxNamespace?: string): boolean =>
  isOpArray(ops) && ops.length > 0 && ops.length <= MAX_APPLY_SET_OPS && ops.every((op) => isSetOpAllowed(op, sandboxNamespace))

/**
 * Build the op's write path in snowplow's `/call` query shape — the ONLY route snowplow
 * serves writes on (it has NO raw /apis route; a raw apiserver path 404s). apiVersion is
 * `<group>/<version>` (URL-encoded), or the bare version for the core group — exactly how
 * snowplow encodes its own widget-action refs. `parseTargetFromPath` (the W0-4 confirm)
 * parses this shape too, so the set confirm still shows the real objects each call hits.
 * Mirrors patchField's buildPatchRefPath; a POST targets the collection — its name is
 * omitted here and the builder substitutes snowplow's required-but-ignored placeholder.
 */
export const buildSetOpPath = (op: ApplyResourceSetOp): string => {
  const { gvr, name, namespace, verb } = op

  return buildCallWritePath({
    group: gvr.group,
    namespace,
    resource: gvr.resource,
    version: gvr.version,
    ...(verb === 'POST' || !name ? {} : { name }),
  })
}

/** The runtime handler injected by the bridge — the hook's REAL set dispatcher (→ runRestSet). */
export interface ApplyResourceSetDeps {
  handleActionSet: (ops: readonly WriteOp[]) => Promise<WriteOpResult[] | null>
  /** config api.PREVIEW_SANDBOX_NAMESPACE — the ONLY namespace where widget-CR /
   * restactions ops are allowed (A.3 carve-out). Absent = those ops are always denied. */
  sandboxNamespace?: string
}

/** The chip a dispatched applyResourceSet returns (readOnly:false — it is a mutation). */
export interface ApplyResourceSetChip {
  verb: 'applyResourceSet'
  label: string
  readOnly: false
  /**
   * Why the set did not land — the first op the apiserver refused (or that never reached it).
   * Absent when every op landed. DISPATCHED IS NOT LANDED: a chip without this field used to mean
   * both, so a composer read a 403 on its BuilderPublish claim as "published".
   */
  failure?: string
}

/** The first refused op, in words: `HTTP 403 — …`, or the transport error when there was no response. */
const failureOf = (results: readonly WriteOpResult[]): string | undefined => {
  const failed = results.find((result) => !result.ok)
  if (!failed) {
    return undefined
  }
  return failed.status ? `HTTP ${failed.status} — ${failed.message}` : failed.message
}

/**
 * Compile + dispatch an `applyResourceSet` proposal. Returns null when the set fails the
 * scoping kernel (denied, exactly like an unknown verb — nothing dispatched) OR when the
 * human declines the ONE aggregated W0-4 confirm (handleActionSet returns null — nothing
 * dispatched). Dispatch is via `deps.handleActionSet` → `runRestSet`, so the whole set
 * ALWAYS flows through the blast-radius gate and NEVER bypasses ctx.confirm.
 */
export const applyResourceSet = async (
  proposal: ApplyResourceSetProposal,
  deps: ApplyResourceSetDeps,
): Promise<ApplyResourceSetChip | null> => {
  const { ops } = proposal
  // SET SAFETY KERNEL (layer 1): op-count cap + per-op scope, else deny the WHOLE set.
  if (!isApplySetAllowed(ops, deps.sandboxNamespace)) {
    return null
  }

  // Compile to the fabric's ordered WriteOps (path shaped for the W0-4 confirm's parser).
  const writeOps: WriteOp[] = ops.map((op) => ({
    path: buildSetOpPath(op),
    verb: op.verb,
    ...(op.payload === undefined ? {} : { payload: op.payload }),
  }))

  // THE GATE (layer 2): runRestSet confirms the WHOLE set once; decline → null → no chip.
  const results = await deps.handleActionSet(writeOps)
  if (results === null) {
    return null
  }

  const label = proposal.label ?? `apply ${ops.length} object${ops.length === 1 ? '' : 's'}`
  // runRestSet stops at the first error, so a refused op is the last result — and every op after
  // it was never sent. The chip says so, rather than reading as a set that landed.
  const failure = failureOf(results)

  return failure ? { failure, label, readOnly: false, verb: 'applyResourceSet' } : { label, readOnly: false, verb: 'applyResourceSet' }
}
