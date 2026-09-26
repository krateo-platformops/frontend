/**
 * W4 — describeResource: CHECK THE LIVE CRD SCHEMA BEFORE GENERATING A CR.
 *
 * THE PROBLEM this closes: the model generates a custom-resource YAML from what the
 * PROMPT says the kind's fields are — and a stale/wrong prompt produces an invalid CR
 * (e.g. it guessed `authenticationRefs.bearerAuthRef` when the live CRD actually has
 * `configurationRef`). The fix: a read-only verb that fetches the ACTUAL CRD from the
 * cluster (via snowplow /call, the same transport the preview verbs use) and shows its
 * real `spec` fields, so the model generates the CR against the cluster's truth — never
 * a guess. The prompt teaches: describeResource an unfamiliar kind BEFORE proposing an
 * applyResourceSet that creates it.
 *
 * Pure module: arg parsing + CRD-name derivation + spec-field extraction + the drawer
 * payload. No React, no network (the fetch lives in previewBridge.callDescribeResourceCRD).
 */

import type { AutopilotPreviewPayload } from './previewBus'

const asRecord = (value: unknown): Record<string, unknown> | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null)

/** The coordinates needed to find + read a CRD: reuse the proposal's `gvr` verbatim. */
export interface DescribeResourceArgs {
  group: string
  version: string
  resource: string
}

/** One spec field of the live CRD: its name, JSON-schema type, and whether it is required. */
export interface CrdSpecField {
  name: string
  type: string
  required: boolean
  description?: string
}

export interface CrdSpecExtract {
  kind?: string
  fields: CrdSpecField[]
}

/**
 * Parse describeResource args from a proposal's `gvr` (the SAME gvr the model uses for the
 * applyResourceSet op it is about to generate — so it already knows the plural). Null when
 * the resource is missing (group may be '' for core; version may be absent).
 */
export const parseDescribeResourceArgs = (
  proposal: { gvr?: { group?: string; version?: string; resource?: string } },
): DescribeResourceArgs | null => {
  const { gvr } = proposal
  if (!gvr || typeof gvr.resource !== 'string' || !gvr.resource || typeof gvr.group !== 'string') {
    return null
  }
  return { group: gvr.group, resource: gvr.resource, version: typeof gvr.version === 'string' ? gvr.version : '' }
}

/** The CRD's metadata.name: `<plural>.<group>` (or just `<plural>` for the core group). */
export const crdNameFromArgs = (args: DescribeResourceArgs): string =>
  (args.group ? `${args.resource}.${args.group}` : args.resource)

/** The JSON-schema type of one property, tolerant of the int-or-string / untyped-object cases. */
const fieldType = (def: Record<string, unknown>): string => {
  if (typeof def.type === 'string') {
    return def.type
  }
  if (def['x-kubernetes-int-or-string'] === true) {
    return 'int-or-string'
  }
  return def.properties || def['x-kubernetes-preserve-unknown-fields'] ? 'object' : 'unknown'
}

/**
 * The version of a fetched CRD to read a schema at: the one named `version`; else the one both
 * served and stored; else the first served; else the first. SERVED before stored: 38 of 46 composition
 * CRDs on krateo-057 store a version they no longer serve (`vacuum`), whose schema describes an
 * object nobody can create. Null when the CRD lists no versions.
 */
export const pickCrdVersion = (crd: unknown, version?: string): Record<string, unknown> | null => {
  const versions: unknown[] = Array.isArray(asRecord(asRecord(crd)?.spec)?.versions) ? asRecord(asRecord(crd)?.spec)?.versions as unknown[] : []
  const pick = versions.find((entry) => asRecord(entry)?.name === version)
    ?? versions.find((entry) => asRecord(entry)?.served === true && asRecord(entry)?.storage === true)
    ?? versions.find((entry) => asRecord(entry)?.served === true)
    ?? versions[0]
  return asRecord(pick)
}

/**
 * Extract the `spec` field list from a fetched CRD object, at the version `pickCrdVersion` picks.
 * Null when the CRD has no usable spec schema (the caller renders an error).
 */
export const extractCrdSpecFields = (crd: unknown, version?: string): CrdSpecExtract | null => {
  const spec = asRecord(asRecord(crd)?.spec)
  const pick = pickCrdVersion(crd, version)
  if (!pick) {
    return null
  }
  const schema = asRecord(asRecord(pick.schema)?.openAPIV3Schema)
  const specSchema = asRecord(asRecord(schema?.properties)?.spec)
  if (!specSchema) {
    return null
  }
  const props = asRecord(specSchema.properties) ?? {}
  const required = new Set(Array.isArray(specSchema.required) ? specSchema.required.filter((entry): entry is string => typeof entry === 'string') : [])
  const fields: CrdSpecField[] = Object.entries(props).map(([name, def]) => {
    const record = asRecord(def) ?? {}
    const description = typeof record.description === 'string' ? record.description : undefined
    return { description, name, required: required.has(name), type: fieldType(record) }
  })
  const kind = asRecord(spec?.names)?.kind
  return { fields, kind: typeof kind === 'string' ? kind : undefined }
}

/**
 * Build the preview-drawer payload for a described resource: its live `spec` fields as
 * summary lines (name · type · required · one-line description). On a fetch/parse failure
 * the error rides AS the content (honest, never a crash).
 */
export const buildDescribeResourcePayload = (
  crdName: string,
  extract: CrdSpecExtract | null,
  error?: string,
): AutopilotPreviewPayload => {
  if (error || !extract) {
    return {
      caption: crdName,
      error: error ?? `could not read the CRD ${crdName} — it may not be installed`,
      title: `CRD schema — ${crdName}`,
    }
  }
  const summary = extract.fields.map((field) => {
    const head = `spec.${field.name}: ${field.type}${field.required ? ' (required)' : ''}`
    const desc = field.description ? ` — ${field.description.split('\n')[0].trim().slice(0, 90)}` : ''
    return head + desc
  })
  return {
    caption: `${crdName} — the LIVE cluster schema. Generate the custom resource using ONLY these spec fields.`,
    summary: summary.length ? summary : ['(this CRD declares no typed spec fields)'],
    title: `CRD schema — ${extract.kind ?? crdName}`,
  }
}
