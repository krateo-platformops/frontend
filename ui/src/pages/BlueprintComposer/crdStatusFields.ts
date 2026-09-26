/**
 * What a custom resource can be waited on for — the fields its CRD declares under `status`. Pure.
 *
 * NOTHING IS GUESSED. The readiness picker lists exactly the scalar fields the CRD's schema types
 * under `status` (to depth three, as `.status.a.b`), and the Ready condition only when the schema
 * declares `status.conditions` (S4 decision D3). A CRD with no status schema — 48 of the 123
 * placeable kinds on krateo-057 — lists nothing, and the picker says so.
 *
 * ONLY WHAT THE GRAMMAR TAKES (readyWhen.ts): a key that is not a Go and jq identifier cannot be a
 * segment of `.status.a.b`, so it is left out rather than offered and then refused.
 *
 * THE VERSION is describeResource's `pickCrdVersion` — the one asked for, else served-and-stored,
 * else served — never an unserved storage version.
 */
import { pickCrdVersion } from '../../components/Autopilot/describeResource'

export interface CrdStatusFields {
  /** `.status.a.b` paths of scalar leaves, in schema order. */
  fields: string[]
  /** The schema declares `status.conditions`. */
  conditions: boolean
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null)

const SCALARS = new Set(['string', 'integer', 'number', 'boolean'])
const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const MAX_DEPTH = 3

const isScalar = (schema: Record<string, unknown>): boolean =>
  (typeof schema.type === 'string' && SCALARS.has(schema.type)) || schema['x-kubernetes-int-or-string'] === true

const leaves = (properties: Record<string, unknown>, prefix: string, depth: number): string[] =>
  Object.entries(properties).flatMap(([key, value]) => {
    const schema = asRecord(value)
    if (!schema || !SEGMENT.test(key) || (depth === 1 && key === 'conditions')) { return [] }
    const path = `${prefix}.${key}`
    if (isScalar(schema)) { return [path] }
    const nested = asRecord(schema.properties)
    return nested && depth < MAX_DEPTH ? leaves(nested, path, depth + 1) : []
  })

/** The status fields of a fetched CRD at `version`, or null when it has no schema at that version at all. */
export const extractCrdStatusFields = (crd: unknown, version?: string): CrdStatusFields | null => {
  const picked = pickCrdVersion(crd, version)
  const schema = asRecord(asRecord(picked?.schema)?.openAPIV3Schema)
  if (!schema) { return null }
  const status = asRecord(asRecord(asRecord(schema.properties)?.status)?.properties) ?? {}
  return { conditions: asRecord(status.conditions) !== null, fields: leaves(status, '.status', 1) }
}
