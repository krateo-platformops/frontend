/**
 * T7 — what a republish would change that the live CRD forbids changing. Pure.
 *
 * The oasgen 0.23.0 RestDefinition CRD marks six fields CEL-immutable (`self == oldSelf`):
 * spec.resourceGroup, spec.resource.kind, identifiers, configurationFields,
 * additionalStatusFields and excludedSpecFields. An update touching any of them is rejected by the
 * apiserver, so the only way through is delete + recreate — which orphans every CR of the Kind. The
 * diff names each locked field whose value would change, before the publish is attempted.
 *
 * EQUALITY is the apiserver's: lists compare in order (`["a","b"] != ["b","a"]`), and an absent
 * list equals an empty one (the live github-provider-kog CRs carry `configurationFields: []` where
 * the builder omits the key).
 */
import { asRecord } from '../../components/Autopilot/kogRestDefSchema'

export const IMMUTABLE_REST_DEF_FIELDS = [
  'kind',
  'resourceGroup',
  'identifiers',
  'configurationFields',
  'additionalStatusFields',
  'excludedSpecFields',
] as const
export type ImmutableRestDefField = typeof IMMUTABLE_REST_DEF_FIELDS[number]

export interface ImmutableChange {
  field: ImmutableRestDefField
  before: unknown
  after: unknown
  sentence: string
}

const LIST_FIELDS: readonly ImmutableRestDefField[] = ['identifiers', 'configurationFields', 'additionalStatusFields', 'excludedSpecFields']

const valueOf = (restDefinition: Record<string, unknown>, field: ImmutableRestDefField): unknown => {
  const spec = asRecord(restDefinition.spec)
  if (field === 'resourceGroup') {
    return spec?.resourceGroup
  }
  const value = asRecord(spec?.resource)?.[field]
  return LIST_FIELDS.includes(field) && value === undefined ? [] : value
}

/** Structural equality, key-order-insensitive for objects, order-sensitive for arrays. */
const equal = (left: unknown, right: unknown): boolean => {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((entry, index) => equal(entry, right[index]))
  }
  const leftRecord = asRecord(left)
  const rightRecord = asRecord(right)
  if (leftRecord || rightRecord) {
    if (!leftRecord || !rightRecord) {
      return false
    }
    const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])
    return [...keys].every((key) => equal(leftRecord[key], rightRecord[key]))
  }
  return left === right
}

const show = (value: unknown): string => (value === undefined ? 'unset' : JSON.stringify(value))

/**
 * The locked fields whose value differs between the published RestDefinition and the draft.
 * Empty = the draft can be applied as an update.
 */
export const immutableFieldDiff = (published: Record<string, unknown>, draft: Record<string, unknown>): ImmutableChange[] =>
  IMMUTABLE_REST_DEF_FIELDS.flatMap((field) => {
    const before = valueOf(published, field)
    const after = valueOf(draft, field)
    if (equal(before, after)) {
      return []
    }
    return [{
      after,
      before,
      field,
      sentence: `${field} is immutable once published: ${show(before)} → ${show(after)} would be rejected; changing it means deleting the RestDefinition (and every resource of the Kind) and recreating it.`,
    }]
  })
