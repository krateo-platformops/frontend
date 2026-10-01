/**
 * What a PUBLISHED controller may no longer change (split from controllerChart.ts): the snapshot a
 * publish takes of every RestDefinition's CEL-immutable fields and of the served version, and the
 * refusal sentences a change to one earns. Pure. Re-exported by controllerChart.ts.
 */
import { load } from 'js-yaml'

import { asRecord } from '../../components/Autopilot/kogRestDefSchema'

import { RESTDEFINITION_PATH } from './controllerModel'
import { IMMUTABLE_REST_DEF_FIELDS, immutableFieldDiff } from './immutableDiff'
import { parseOas } from './oasImport'
import { CONFIGMAP_PATH, specInfoVersion, unescapeHelm } from './servedVersion'

// ── locked once published ─────────────────────────────────────────────────────────────────────────

/**
 * What a PUBLISHED controller's RestDefinitions said about their CEL-immutable fields
 * (immutableDiff.ts: kind, resourceGroup, identifiers, configurationFields, additionalStatusFields,
 * excludedSpecFields), by path — and, under the OAS ConfigMap's path, the version its Kinds are
 * served under (servedVersion.ts: a change would serve a new version and prune the published one).
 * Taken when a publish lands and kept on the draft record, so a resumed draft still knows what it may
 * no longer change.
 */
export type LockedSnapshot = Record<string, Record<string, unknown>>

/** The held document's info.version, read from a ConfigMap's text (null when it does not read). */
const configMapVersion = (text: string | undefined): string | null => {
  try {
    const data = asRecord(asRecord(load(text ?? ''))?.data) ?? {}
    const raw = Object.values(data).find((value): value is string => typeof value === 'string')
    const read = raw ? parseOas(unescapeHelm(raw)) : null
    return read?.ok ? specInfoVersion(read.documents[0].doc) : null
  } catch {
    return null
  }
}

const LOCKED_RESOURCE_FIELDS = IMMUTABLE_REST_DEF_FIELDS.filter((field) => field !== 'resourceGroup')

export const lockedSnapshot = (files: Readonly<Record<string, string>>): LockedSnapshot => {
  const snapshot: LockedSnapshot = {}
  for (const path of Object.keys(files).filter((entry) => CONFIGMAP_PATH.test(entry))) {
    const servedVersion = configMapVersion(files[path])
    if (servedVersion) { snapshot[path] = { servedVersion } }
  }
  for (const path of Object.keys(files).filter((entry) => RESTDEFINITION_PATH.test(entry))) {
    try {
      const spec = asRecord(asRecord(load(files[path]))?.spec)
      const resource = asRecord(spec?.resource) ?? {}
      snapshot[path] = {
        resourceGroup: spec?.resourceGroup,
        ...Object.fromEntries(LOCKED_RESOURCE_FIELDS.filter((field) => resource[field] !== undefined).map((field) => [field, resource[field]])),
      }
    } catch {
      // A file that does not read locks nothing it could be compared against.
    }
  }
  return snapshot
}

/** The published RestDefinition as immutableFieldDiff reads it, rebuilt from the snapshot. */
const publishedSkeleton = (locked: Record<string, unknown>): Record<string, unknown> => ({
  spec: {
    resource: Object.fromEntries(LOCKED_RESOURCE_FIELDS.filter((field) => locked[field] !== undefined).map((field) => [field, locked[field]])),
    resourceGroup: locked.resourceGroup,
  },
})

export const show = (value: unknown): string => (value === undefined ? 'unset' : JSON.stringify(value))

/** The sentence a change to a locked field is refused with (the mockup's screen 11). */
export const lockedSentence = (kind: string, field: string, before: unknown, after: unknown): string =>
  `cannot update ${kind} in place: ${field} is locked once published (${show(before)} → ${show(after)}). Changing it means deleting the RestDefinition — and every ${kind} it serves — and recreating it; undo the change, or place a new Kind instead.`

/** Each locked field a held RestDefinition changed since it was published, as refusal sentences. */
export const lockedChangesOf = (path: string, restDefinition: Record<string, unknown>, locked: LockedSnapshot | null | undefined): string[] => {
  const baseline = locked?.[path]
  if (!baseline) { return [] }
  const published = publishedSkeleton(baseline)
  const held = asRecord(asRecord(restDefinition.spec)?.resource)?.kind
  let kind = typeof held === 'string' ? held : 'this Kind'
  if (typeof baseline.kind === 'string') { kind = baseline.kind }
  return immutableFieldDiff(published, restDefinition).map((change) => lockedSentence(kind, change.field, change.before, change.after))
}

/** Every locked-field change the held draft carries, one sentence each. */
export const lockedChanges = (files: Readonly<Record<string, string>>, locked: LockedSnapshot | null | undefined): string[] => {
  if (!locked) { return [] }
  return Object.keys(locked).flatMap((path) => {
    if (!Object.prototype.hasOwnProperty.call(files, path)) { return [] }
    if (CONFIGMAP_PATH.test(path)) {
      const before = locked[path].servedVersion
      const after = configMapVersion(files[path])
      return before !== undefined && after !== before
        ? [`cannot update the controller in place: the version its Kinds are served under is locked once published (${show(before)} → ${show(after ?? undefined)}). oasgen-provider would serve a new version and prune the published one, breaking every manifest written against it — set ${path}'s info.version back to ${typeof before === 'string' ? before : JSON.stringify(before)}.`]
        : []
    }
    try {
      const restDefinition = asRecord(load(files[path]))
      return restDefinition ? lockedChangesOf(path, restDefinition, locked) : []
    } catch {
      return []
    }
  })
}
