/**
 * Day-2 ops part B — the SCOPED, human-gated `patchField` mutating portal-action.
 *
 * GOVERNING INVARIANT (unchanged): Agentiko never mutates directly and never
 * reimplements behaviour — it drives the REAL portal by compiling a proposal into a
 * canonical `WidgetAction` and dispatching it through the SAME `useHandleAction`
 * dispatcher a Button/row-action uses. `patchField` is the FIRST mutating verb: it
 * lets the agent propose changing ONE spec field of the composition on THIS page as a
 * merge-patch, routed through the EXISTING W0-2 blast-radius gate (which renders the
 * diff and requires the human to confirm before anything runs).
 *
 * `patchField` is deliberately NOT a read-only registry verb (READONLY_VERB_REGISTRY is
 * read-only by construction). It is a DISTINCT mutating branch owned by the bridge, like
 * `runAction`. Two independent safety layers gate it:
 *   1. `isPatchAllowed(gvr, field)` (below) — a pure, defense-in-depth scoping kernel:
 *      ONLY a composition/instance kind (group ends with `composition.krateo.io`) and
 *      ONLY a single simple spec field (a bare key, or a `spec.`-prefixed dotted path).
 *      Anything else (a non-composition GVR, metadata/status/deletion paths, '*', empty)
 *      is REJECTED here — the branch returns null, exactly like an unknown verb.
 *   2. The W0-2 gate — the built PATCH is dispatched as a `rest` WidgetAction whose ref
 *      carries verb 'PATCH', so `runRest`'s `isMutatingVerb` chokepoint ALWAYS renders
 *      the BlastRadiusConfirm diff and blocks on the human's confirm. This module NEVER
 *      bypasses that gate; the scoping kernel is purely additive on top of it.
 */

import { buildCallWritePath } from '../../hooks/callPath'
import type { ResourceRef, ResourcesRefs, WidgetAction } from '../../types/Widget'

/** The GVR (group/version/resource) the proposal targets — the on-page composition's, from context. */
export interface PatchFieldGvr {
  group: string
  version: string
  resource: string
}

/** The mutating `patchField` proposal shape (a superset of PortalActionProposal fields). */
export interface PatchFieldProposal {
  verb: 'patchField'
  gvr: PatchFieldGvr
  namespace: string
  name: string
  /** A single simple key ("size") or a `spec.`-prefixed dotted path ("spec.size"). */
  field: string
  /** The new value for that field (any JSON scalar/object the merge-patch will set). */
  value: unknown
  label?: string
}

/**
 * The composition/instance group suffix. Krateo composition (and per-instance) kinds are
 * served under a group ENDING in `composition.krateo.io` (e.g. `<name>.composition.krateo.io`).
 * Scoping to this suffix is what confines patchField to compositions — NEVER an arbitrary
 * cluster resource (a Deployment, a Secret, a Node, …).
 */
export const COMPOSITION_GROUP_SUFFIX = 'composition.krateo.io'

/** A GVR is a composition/instance kind iff its group ends with the composition suffix. */
export const isCompositionGvr = (gvr: PatchFieldGvr | undefined): boolean =>
  typeof gvr?.group === 'string' && gvr.group.endsWith(COMPOSITION_GROUP_SUFFIX)

/** A single simple key: non-empty, no wildcard, no reserved apiserver roots, no path chars. */
const isSimpleKey = (key: string): boolean => {
  if (!key || key === '*') {
    return false
  }
  // Reject the reserved/forbidden roots even when given as a bare key (defense-in-depth:
  // a bare "metadata"/"status"/"apiVersion"/"kind"/"deletionTimestamp" must never pass).
  const FORBIDDEN = new Set(['metadata', 'status', 'apiversion', 'kind', 'deletiontimestamp', 'deletiongraceperiodseconds'])
  if (FORBIDDEN.has(key.toLowerCase())) {
    return false
  }
  // A simple key contains none of the path/wildcard/separator characters.
  return !/[.[\]/*]/.test(key)
}

/**
 * Normalize an allowed field path to its top-level spec KEY.
 *   "size"        → "size"      (a bare simple key is patched under spec)
 *   "spec.size"   → "size"      (a `spec.`-prefixed path, one segment under spec)
 * Returns null for any path this function does not consider a single simple spec field —
 * a nested path ("spec.a.b"), a non-spec root ("metadata.name"), '*', or empty.
 *
 * SCOPE (intentionally strict): only a SINGLE segment under spec is allowed, so the
 * merge-patch body is always the minimal `{ spec: { <key>: <value> } }`. A deeper path
 * would need a nested merge-patch we deliberately do not synthesize here.
 */
export const specKeyOf = (field: string | undefined): string | null => {
  if (typeof field !== 'string') {
    return null
  }
  const trimmed = field.trim()
  if (!trimmed || trimmed === '*') {
    return null
  }
  const segments = trimmed.split('.')
  const [first, second] = segments
  // A bare simple key: exactly one segment, and not a reserved/wildcard token.
  if (segments.length === 1) {
    return isSimpleKey(first) ? first : null
  }
  // A `spec.`-prefixed path: exactly `spec.<key>` (two segments, first is `spec`).
  if (segments.length === 2 && first === 'spec') {
    return isSimpleKey(second) ? second : null
  }
  // Anything else (metadata.* / status.* / deeper spec path / more segments) is rejected.
  return null
}

/**
 * The SAFETY KERNEL. Pure predicate: is this (gvr, field) allowed to be patched?
 *   ALLOW  — gvr is a composition/instance kind AND field is a single simple spec field.
 *   REJECT — any other group (no arbitrary cluster resource), or any field outside a
 *            single simple `spec.` key (metadata/status/deletion paths, '*', empty, nested).
 * This is defense-in-depth ON TOP of the human W0-2 gate — never a substitute for it.
 */
export const isPatchAllowed = (gvr: PatchFieldGvr | undefined, field: string | undefined): boolean =>
  isCompositionGvr(gvr) && specKeyOf(field) !== null

/**
 * Build the ResourceRef `path` for the target composition, in snowplow's `/call` query
 * shape — /call?apiVersion=<group>%2F<version>&resource=<plural>&name=<name>&namespace=<ns>
 * — the ONLY route snowplow serves writes on (it has NO raw /apis route; a raw apiserver
 * path 404s). This is the SAME shape every real widget-action ref carries (snowplow's
 * resourcesrefs resolver builds it server-side), and `parseTargetFromPath` (W0-2 gate)
 * ALSO parses it, so the blast-radius diff still shows the real object (GVR + namespace +
 * name) the PATCH will hit.
 */
export const buildPatchRefPath = (gvr: PatchFieldGvr, namespace: string, name: string): string =>
  buildCallWritePath({ group: gvr.group, name, namespace, resource: gvr.resource, version: gvr.version })

/** The runtime handler injected by the bridge — the SAME real dispatcher a hand-clicked control uses. */
export interface PatchFieldDeps {
  handleAction: (action: WidgetAction, resourcesRefs: ResourcesRefs) => Promise<void>
}

/** The chip a successfully-dispatched patchField returns (readOnly:false — it is a mutation). */
export interface PatchFieldChip {
  verb: 'patchField'
  label: string
  readOnly: false
}

/**
 * Compile + dispatch a `patchField` proposal. Returns the chip on dispatch, or null when
 * the proposal is malformed OR fails the `isPatchAllowed` scoping kernel (denied, exactly
 * like an unknown verb). Dispatch is via `deps.handleAction` — so the built PATCH `rest`
 * action flows through `runRest`'s W0-2 blast-radius gate and NEVER bypasses ctx.confirm.
 */
export const applyPatchField = async (
  proposal: PatchFieldProposal,
  deps: PatchFieldDeps,
): Promise<PatchFieldChip | null> => {
  const { field, gvr, name, namespace, value } = proposal
  // Shape guard: all identity fields present + a value key on the proposal.
  if (!gvr || typeof namespace !== 'string' || !namespace || typeof name !== 'string' || !name) {
    return null
  }
  if (!('value' in proposal)) {
    return null
  }
  // SAFETY KERNEL (layer 1): composition-only + single simple spec field, else deny.
  const specKey = specKeyOf(field)
  if (!isCompositionGvr(gvr) || specKey === null) {
    return null
  }

  // Shallow merge-patch body: exactly the one spec field. `${field}` accepts "spec.size" or
  // "size" — both normalize to the single spec key, so the body is always minimal.
  const payload = { spec: { [specKey]: value } }

  // The apiserver PATCH target, in the shape the W0-2 gate parses for its GVR/ns/name diff.
  const path = buildPatchRefPath(gvr, namespace, name)

  // The ResourceRef carries the verb (runRest reads verb from the REF, not the action) and the
  // merge-patch body (buildPayload merges action.payload then ref.payload; putting it on the ref
  // guarantees it survives). Mirrors the shape of an existing create/install POST ref.
  const resourceRef: ResourceRef = {
    allowed: true,
    id: 'agentiko-patch-field',
    path,
    payload,
    verb: 'PATCH',
  }
  const resourcesRefs: ResourcesRefs = { items: [resourceRef] }

  // A merge-patch `rest` action referencing that ref. The Content-Type header tells the
  // apiserver this is a strategic/merge merge-patch (application/merge-patch+json). No
  // requireConfirmation opt-in is needed: runRest's isMutatingVerb chokepoint ALWAYS gates
  // a PATCH through the W0-2 BlastRadiusConfirm regardless.
  const action: WidgetAction = {
    headers: ['Content-Type: application/merge-patch+json'],
    id: 'agentiko-patch-field',
    payload: {},
    resourceRefId: resourceRef.id,
    type: 'rest',
  }

  await deps.handleAction(action, resourcesRefs)

  const label = proposal.label ?? `patch ${gvr.resource}/${name} spec.${specKey}`
  return { label, readOnly: false, verb: 'patchField' }
}
