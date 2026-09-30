/**
 * W4 KOG-BUILDER (FE-K1) — the PURE RestDefinition mapper/validation module.
 *
 * Mirrors the LIVE `restdefinitions.ogen.krateo.io` v1alpha1 CRD (the binding
 * contract, dumped from krateo-057 — deployed oasgen-provider 0.23.0):
 *   - spec.oasPath (required), pattern `configmap://<ns>/<name>/<key>` OR `http(s)://…`
 *     (ns/name `[a-z0-9-]+`, key `[a-zA-Z0-9._-]+`)
 *   - spec.resourceGroup (required, CEL-immutable `self == oldSelf`)
 *   - spec.resource.kind (required, CEL-immutable) + spec.resource.verbsDescription[]
 *     (required): each {action ∈ create|update|get|delete|findby, method ∈ GET|POST|
 *     PUT|DELETE|PATCH, path required}; identifiersMatchPolicy (enum AND|OR) and
 *     pagination{type continuationToken, continuationToken{request{tokenIn query},
 *     response{tokenIn header}}} are findby-only (CEL); requestFieldMapping[] (deprecated)
 *     entries require inCustomResource plus EXACTLY ONE of inPath|inQuery|inBody (CEL);
 *     fieldMapping[] entries require EXACTLY ONE of inPath|inQuery|inBody|inResponse, with
 *     an optional valueMapping{type alias|jq}, a request-only resolver{type secretRef} and
 *     defaultIfAbsent (CEL); requestTransform / responseTransform / notFoundBody are jq
 *     programs; async{mode, operationRef{in body|header, path, jq}, poll{path, statusPath,
 *     successValues ≥1, …}, postGet} — poll.path must carry the {handleParam} token
 *     (oasgen rejects it at processing time otherwise); headers[] / queries[] {name, value};
 *     successCodes[] / tolerateCodes[] / notFoundCodes[] integers.
 *   - jq programs everywhere: EXACTLY ONE of inline|ref, entrypoint only with ref, ref in
 *     the same URI scheme as oasPath (CEL).
 *   - resource.compareScope (enum fullSpec|identifiersAndStatus|updatable, CEL-gated on
 *     identifiers/additionalStatusFields and on an update verb) and the RESTAction
 *     delegations observeApiRef / createApiRef / updateApiRef / deleteApiRef
 *     {name, namespace required, extras, notFoundExpr, upToDateExpr} — createApiRef needs a
 *     get|findby verb, and with observeApiRef needs observeApiRef.notFoundExpr (CEL).
 *   - identifiers[], additionalStatusFields[], excludedSpecFields[],
 *     configurationFields[]{fromOpenAPI{name,in}, fromRestDefinition{actions minItems 1}}
 *     — ALL CEL-immutable.
 *   - The CRD has no preserve-unknown-fields outside apiRef.extras and
 *     fieldMapping.defaultIfAbsent, so the apiserver PRUNES any other unknown key — a
 *     silent loss. Every object level therefore rejects keys the schema does not name.
 *
 * Three pure surfaces, no React and no network:
 *   1. validateRestDefinitionDraft — error lines for the preview drawer (empty = the
 *      draft matches the live CRD shape and is publishable).
 *   2. restDefImmutabilityWarnings — the CEL-immutable fields PRESENT in the draft,
 *      as warning lines (a wrong first publish means delete + recreate).
 *   3. buildKogPublishOps — LEGACY the URL-first DIRECT-WRITE publish plan: ONE op (POST
 *      restdefinitions, oasPath = http(s) URL) or TWO ordered ops (POST configmaps carrying
 *      the `{"$oasAttachment": true}` substitution token, then POST restdefinitions with
 *      oasPath = configmap://…) in the applyResourceSet ops[] shape. The OAS document
 *      itself is NEVER built here — FE-K2 substitutes the held verbatim bytes at
 *      publish-payload compile time, so the doc never round-trips the model.
 *
 * NOTE ON buildKogPublishOps (item #30): the KOG builder's PRIMARY publish path is the
 * `publishRestDef` verb, which commits the controller chart through the same BuilderPublish claim
 * as the blueprint/page builders (kogPublish.ts / publishDraft.ts) — the generated kind waits
 * for a change request to merge, it does not land live. buildKogPublishOps (this direct 2-op cluster write) is RETAINED as a defense-in-depth
 * fallback: the model is now prompted to emit `publishRestDef`, but if it still emits the old
 * direct-write applyResourceSet on restdefinitions, finalize's applyResourceSet branch (KOG
 * preview gate + hydrateRestDefinitionOps) still handles it correctly. It is no longer the
 * demoed path. Its unit tests stay green as a shape contract.
 */

import type { ApplyResourceSetOp } from './applyResourceSet'
import { asRecord, isNonEmptyString, KNOWN_KEYS, type OasPathRef, parseOasPath, unknownFieldErrors } from './kogRestDefSchema'
import { resourceRuleErrors, validateVerbEntry } from './kogRestDefVerbs'
import { OAS_ATTACHMENT_KEY } from './oasAttachment'

/** The RestDefinition GVK/GVR the builder emits (the live CRD's coordinates). */
export const REST_DEFINITION_API_VERSION = 'ogen.krateo.io/v1alpha1'
export const REST_DEFINITION_KIND = 'RestDefinition'
export const REST_DEFINITION_GVR = { group: 'ogen.krateo.io', resource: 'restdefinitions', version: 'v1alpha1' } as const

/** The label stamped on the builder's ConfigMap so an orphan (op-2 failure) is findable. */
export const KOG_MANAGED_BY_LABEL: Record<string, string> = { 'krateo.io/managed-by': 'kog-builder' }

/** The CRD enums, oasPath parser and 0.23 validators live beside this module (split for size). */
export {
  type OasPathConfigMapRef,
  type OasPathRef,
  type OasPathUrlRef,
  parseOasPath,
  REST_DEF_ACTIONS,
  REST_DEF_API_REFS,
  REST_DEF_ASYNC_MODES,
  REST_DEF_COMPARE_SCOPES,
  REST_DEF_METHODS,
  REST_DEF_VALUE_MAPPING_TYPES,
} from './kogRestDefSchema'

/** DNS-1123 label/name (also what applyResourceSet's isPathSegment enforces). */
const DNS1123 = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/
/** DNS-1123 subdomain — what the apiserver requires of the GENERATED CRD's group. */
const DNS1123_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/

/** configurationFields entries: fromOpenAPI{name,in} + fromRestDefinition{actions ≥1}. */
const validateConfigurationFields = (value: unknown): string[] => {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    return ['resource.configurationFields must be an array']
  }
  const errors: string[] = []
  value.forEach((entry: unknown, index: number) => {
    const at = `configurationFields[${index}]`
    const record = asRecord(entry)
    if (record) {
      errors.push(...unknownFieldErrors(record, KNOWN_KEYS.configurationField, at))
    }
    const fromOpenAPI = asRecord(record?.fromOpenAPI)
    const fromRestDefinition = asRecord(record?.fromRestDefinition)
    if (fromOpenAPI) {
      errors.push(...unknownFieldErrors(fromOpenAPI, KNOWN_KEYS.fromOpenAPI, `${at}.fromOpenAPI`))
    }
    if (fromRestDefinition) {
      errors.push(...unknownFieldErrors(fromRestDefinition, KNOWN_KEYS.fromRestDefinition, `${at}.fromRestDefinition`))
    }
    if (!fromOpenAPI || !isNonEmptyString(fromOpenAPI.name) || !isNonEmptyString(fromOpenAPI.in)) {
      errors.push(`${at}: fromOpenAPI{name, in} is required`)
    }
    if (!fromRestDefinition || !Array.isArray(fromRestDefinition.actions) || fromRestDefinition.actions.length === 0) {
      errors.push(`${at}: fromRestDefinition.actions requires at least one entry (use ["*"] for all)`)
    }
  })
  return errors
}

/** An optional list-of-strings field (identifiers / additionalStatusFields / excludedSpecFields). */
const validateStringList = (value: unknown, field: string): string[] => {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.some((entry) => !isNonEmptyString(entry))) {
    return [`resource.${field} must be a list of non-empty strings`]
  }
  return []
}

/**
 * Validate a draft RestDefinition CR object against the LIVE CRD shape. Returns
 * error lines for the preview drawer — EMPTY means the draft is publishable
 * (envelope + required fields + enums + CEL-expressible constraints all hold).
 */
export const validateRestDefinitionDraft = (draft: Record<string, unknown>): string[] => {
  const errors: string[] = []
  if (draft.apiVersion !== REST_DEFINITION_API_VERSION) {
    errors.push(`apiVersion must be ${REST_DEFINITION_API_VERSION}`)
  }
  if (draft.kind !== REST_DEFINITION_KIND) {
    errors.push(`kind must be ${REST_DEFINITION_KIND}`)
  }
  const metadata = asRecord(draft.metadata)
  if (!isNonEmptyString(metadata?.name) || !DNS1123.test(metadata.name)) {
    errors.push('metadata.name is required and must be a DNS-1123 name (lowercase alphanumerics, -, .)')
  }
  if (!isNonEmptyString(metadata?.namespace) || !DNS1123.test(metadata.namespace)) {
    errors.push('metadata.namespace is required (RestDefinition is namespaced) and must be a DNS-1123 name')
  }
  const spec = asRecord(draft.spec)
  if (!spec) {
    errors.push('spec is required ({oasPath, resourceGroup, resource})')
    return errors
  }
  errors.push(...unknownFieldErrors(spec, KNOWN_KEYS.spec, 'spec'))
  if (!isNonEmptyString(spec.oasPath)) {
    errors.push('spec.oasPath is required')
  } else if (!parseOasPath(spec.oasPath)) {
    errors.push('spec.oasPath must be configmap://<namespace>/<name>/<key> or http(s)://… — no other form is accepted')
  }
  if (!isNonEmptyString(spec.resourceGroup)) {
    errors.push('spec.resourceGroup is required (the API group of the generated kind)')
  } else if (!DNS1123_SUBDOMAIN.test(spec.resourceGroup)) {
    errors.push('spec.resourceGroup must be a DNS subdomain (e.g. mlflow.example.org) — the generated CRD is rejected otherwise')
  }
  const resource = asRecord(spec.resource)
  if (!resource) {
    errors.push('spec.resource is required ({kind, verbsDescription})')
    return errors
  }
  errors.push(...unknownFieldErrors(resource, KNOWN_KEYS.resource, 'spec.resource'))
  if (!isNonEmptyString(resource.kind)) {
    errors.push('spec.resource.kind is required (the CamelCase kind to generate)')
  }
  if (!Array.isArray(resource.verbsDescription) || resource.verbsDescription.length === 0) {
    errors.push('spec.resource.verbsDescription requires at least one {action, method, path} entry')
  } else {
    resource.verbsDescription.forEach((entry: unknown, index: number) => errors.push(...validateVerbEntry(entry, index)))
  }
  errors.push(
    ...validateStringList(resource.identifiers, 'identifiers'),
    ...validateStringList(resource.additionalStatusFields, 'additionalStatusFields'),
    ...validateStringList(resource.excludedSpecFields, 'excludedSpecFields'),
    ...validateConfigurationFields(resource.configurationFields),
    ...resourceRuleErrors(resource),
  )
  return errors
}

/**
 * The CEL-immutability warning lines for the preview surface: every immutable field
 * the draft SETS (kind + resourceGroup always — they are required), so the user knows
 * a wrong first publish means delete + recreate, BEFORE confirming.
 */
export const restDefImmutabilityWarnings = (draft: Record<string, unknown>): string[] => {
  const spec = asRecord(draft.spec)
  const resource = asRecord(spec?.resource)
  const warnings: string[] = []
  const kind = isNonEmptyString(resource?.kind) ? ` (${resource.kind})` : ''
  const group = isNonEmptyString(spec?.resourceGroup) ? ` (${spec.resourceGroup})` : ''
  warnings.push(
    `immutable once generated: resource.kind${kind} — changing it later means delete + recreate`,
    `immutable once generated: resourceGroup${group}`,
  )
  const optionalImmutables: [string, string][] = [
    ['identifiers', 'identifiers'],
    ['additionalStatusFields', 'additionalStatusFields'],
    ['excludedSpecFields', 'excludedSpecFields'],
    ['configurationFields', 'configurationFields'],
  ]
  for (const [field, label] of optionalImmutables) {
    const value = resource?.[field]
    if (Array.isArray(value) && value.length > 0) {
      const detail = value.every((entry) => typeof entry === 'string') ? ` (${value.join(', ')})` : ''
      warnings.push(`immutable once generated: ${label}${detail}`)
    }
  }
  return warnings
}

/** The publish plan: the ordered applyResourceSet ops, or the validation errors. */
export type KogPublishPlan =
  | { ok: true; ops: ApplyResourceSetOp[] }
  | { ok: false; errors: string[] }

/**
 * Build the publish ops[] for a validated draft — the applyResourceSet shapes the
 * whole KOG flow rides (ONE aggregated blast-radius confirm, sequential dispatch):
 *   - URL oasPath (URL-first, the recommended path): ONE op — POST restdefinitions.
 *     No ConfigMap at all; oasgen fetches the URL itself.
 *   - configmap:// oasPath (paste path): TWO ordered ops — POST configmaps FIRST
 *     (name/namespace/key taken from the oasPath so they can never drift apart, the
 *     kog-builder label, and `{"$oasAttachment": true}` as the data value — the
 *     FE-K2 token substituted with the held verbatim document at compile time,
 *     never model-echoed) — then POST restdefinitions.
 * An invalid draft builds NOTHING (all-or-nothing, same posture as the set kernel).
 */
export const buildKogPublishOps = (draft: Record<string, unknown>): KogPublishPlan => {
  const errors = validateRestDefinitionDraft(draft)
  if (errors.length) {
    return { errors, ok: false }
  }
  const metadata = asRecord(draft.metadata)
  const spec = asRecord(draft.spec)
  const namespace = metadata?.namespace as string
  const name = metadata?.name as string
  const oasPath = parseOasPath(spec?.oasPath) as OasPathRef
  const restDefinitionOp: ApplyResourceSetOp = {
    gvr: { ...REST_DEFINITION_GVR },
    name,
    namespace,
    payload: draft,
    verb: 'POST',
  }
  if (oasPath.form === 'url') {
    return { ok: true, ops: [restDefinitionOp] }
  }
  const configMapOp: ApplyResourceSetOp = {
    gvr: { group: '', resource: 'configmaps', version: 'v1' },
    name: oasPath.name,
    namespace: oasPath.namespace,
    payload: {
      apiVersion: 'v1',
      data: { [oasPath.key]: { [OAS_ATTACHMENT_KEY]: true } },
      kind: 'ConfigMap',
      metadata: { labels: { ...KOG_MANAGED_BY_LABEL }, name: oasPath.name, namespace: oasPath.namespace },
    },
    verb: 'POST',
  }
  return { ok: true, ops: [configMapOp, restDefinitionOp] }
}
