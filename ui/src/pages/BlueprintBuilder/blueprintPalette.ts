/**
 * What the palette may place, read from the cluster AS THE PERSON — the portal's `blueprint-palette`
 * RESTAction over snowplow `/call`.
 *
 * WHY A RESTACTION. `/call` cannot list a collection (it needs a `name`), so the two collection
 * reads — the CRDs installed here, the CompositionDefinitions and how many of each are running — are
 * the RESTAction's api steps. Every step carries NO `endpointRef` and NO `userAccessFilter`, so
 * snowplow dispatches each one with the caller's own bearer (`userAccessFilter` would dispatch as
 * snowplow's ServiceAccount — a service identity the composer must never read through). What comes
 * back is exactly what THIS user may list; a class they may not list comes back as its error.
 *
 * A PLAIN FETCH, like callBlueprintRenderRA and placeableWidgets: failure is CONTENT, never a throw.
 * Each class is answered on its own — the custom kinds can be denied while the compositions list —
 * and a failure of the RESTAction itself (not installed on an older portal chart, not runnable,
 * snowplow down) is one sentence for the whole pane, with the native kinds still placeable.
 */
import { getAccessToken } from '../../utils/getAccessToken'

/** One placeable custom-resource kind, as the RESTAction projects its CRD. */
export interface CustomKind {
  group: string
  version: string
  kind: string
  plural: string
  scope: 'Namespaced' | 'Cluster'
  /** The RestDefinition (KOG) or composition that installed it, when its CRD says. */
  owner: string | null
  /** The top-level `status` properties its schema declares. */
  statusFields: string[]
  /** Whether `status.conditions` is declared. */
  conditions: boolean
}

/** One installed blueprint: its CompositionDefinition and the Kind it serves. */
export interface InstalledBlueprint {
  name: string
  namespace: string
  kind: string
  apiVersion: string
  plural: string
  chartVersion: string
  /** The `status` paths its `statusDataTemplate` projects (S12). */
  projects: string[]
  /** How many compositions of it run — null when that could not be counted. */
  running: number | null
}

export type ClassRead<T> = { state: 'ok'; items: T[] } | { state: 'denied' | 'error'; sentence: string }

export interface PaletteRead {
  custom: ClassRead<CustomKind>
  compositions: ClassRead<InstalledBlueprint>
  /**
   * Set when the RESTAction itself could not be read (or no read was made): one sentence for the
   * whole pane. Both classes then carry it too, so a reader of either still hears why.
   */
  unavailable?: string
}

export const PALETTE_NOT_CONFIGURED = 'This portal has no snowplow URL or frontend namespace configured, so only Kubernetes native kinds can be placed.'
export const PALETTE_RA_MISSING = 'This portal has no blueprint-palette RESTAction (404) — its portal chart predates this composer. Kubernetes native kinds still work.'
export const PALETTE_RA_DENIED = 'You may not run the blueprint-palette RESTAction (403) — ask a platform admin for access to it. Kubernetes native kinds still work.'
export const CUSTOM_DENIED = 'This portal may not list custom resource kinds for your user (403). Ask a platform admin for read access to CustomResourceDefinitions to place them — nothing here is hidden silently.'
export const COMPOSITIONS_DENIED = 'You may not list installed blueprints across namespaces (403 on CompositionDefinitions). Ask a platform admin for access to place one — nothing here is hidden silently.'

const asRecord = (value: unknown): Record<string, unknown> | null =>
  ((typeof value === 'object' && value !== null && !Array.isArray(value)) ? value as Record<string, unknown> : null)

const isString = (value: unknown): value is string => typeof value === 'string'

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isString) : [])

/** The whole pane is unavailable: one sentence, carried by both classes too. */
const unavailable = (sentence: string): PaletteRead => ({
  compositions: { sentence, state: 'error' },
  custom: { sentence, state: 'error' },
  unavailable: sentence,
})

/** A class's error record, as the RESTAction's `firstErr` shapes it, in words. */
const classFailure = <T, >(error: unknown, noun: string, denied: string): ClassRead<T> => {
  const record = asRecord(error) ?? {}
  const code = typeof record.code === 'number' ? record.code : 0
  const reason = isString(record.reason) ? record.reason : ''
  const message = isString(record.message) ? record.message : ''
  if (code === 403 || reason === 'Forbidden') {
    return { sentence: denied, state: 'denied' }
  }
  const answered = [code || null, reason || null].filter(Boolean).join(' ') || message || 'an error with no code'
  return { sentence: `Could not list ${noun} — the cluster answered ${answered}.`, state: 'error' }
}

const shapeCustom = (entry: unknown): CustomKind | null => {
  const record = asRecord(entry)
  if (!record || !isString(record.group) || !isString(record.version) || !isString(record.kind) || !isString(record.plural)) {
    return null
  }
  return {
    conditions: record.conditions === true,
    group: record.group,
    kind: record.kind,
    owner: isString(record.owner) && record.owner ? record.owner : null,
    plural: record.plural,
    scope: record.scope === 'Cluster' ? 'Cluster' : 'Namespaced',
    statusFields: strings(record.statusFields),
    version: record.version,
  }
}

const shapeBlueprint = (runningPartialNullsZero: boolean, partial: boolean) => (entry: unknown): InstalledBlueprint | null => {
  const record = asRecord(entry)
  if (!record || !isString(record.name) || !isString(record.kind) || !isString(record.apiVersion) || !isString(record.plural)) {
    return null
  }
  let running = typeof record.running === 'number' ? record.running : null
  // A zero counted while some kinds could not be listed may be a zero the person cannot see past —
  // so no count is shown rather than a false "0 running".
  if (running === 0 && partial && runningPartialNullsZero) {
    running = null
  }
  return {
    apiVersion: record.apiVersion,
    chartVersion: isString(record.chartVersion) ? record.chartVersion : '',
    kind: record.kind,
    name: record.name,
    namespace: isString(record.namespace) ? record.namespace : '',
    plural: record.plural,
    projects: strings(record.projects),
    running,
  }
}

const SHAPE_UNKNOWN = 'the blueprint-palette RESTAction answered in a shape this build does not understand'
const PALETTE_SHAPE_UNKNOWN = 'The blueprint-palette RESTAction answered in a shape this build does not understand. Kubernetes native kinds still work.'

/** The RESTAction's resolved `.status`, as the pane reads it. Pure. */
export const shapePaletteStatus = (status: unknown, runningPartialNullsZero = true): PaletteRead => {
  const record = asRecord(status)
  if (!record) {
    return unavailable(PALETTE_SHAPE_UNKNOWN)
  }
  const custom = asRecord(record.custom)
  const compositions = asRecord(record.compositions)
  const partial = record.runningPartial === true
  let customRead: ClassRead<CustomKind> = { sentence: `Could not list custom resource kinds — ${SHAPE_UNKNOWN}.`, state: 'error' }
  if (custom?.error !== undefined) {
    customRead = classFailure(custom.error, 'custom resource kinds', CUSTOM_DENIED)
  } else if (Array.isArray(custom?.kinds)) {
    customRead = { items: custom.kinds.map(shapeCustom).filter((kind): kind is CustomKind => kind !== null), state: 'ok' }
  }
  let compositionsRead: ClassRead<InstalledBlueprint> = { sentence: `Could not list installed blueprints — ${SHAPE_UNKNOWN}.`, state: 'error' }
  if (compositions?.error !== undefined) {
    compositionsRead = classFailure(compositions.error, 'installed blueprints', COMPOSITIONS_DENIED)
  } else if (Array.isArray(compositions?.items)) {
    const shape = shapeBlueprint(runningPartialNullsZero, partial)
    compositionsRead = { items: compositions.items.map(shape).filter((item): item is InstalledBlueprint => item !== null), state: 'ok' }
  }
  return { compositions: compositionsRead, custom: customRead }
}

/** The logged-in session's Bearer. Best-effort — no token (or no storage in tests) is no header. */
const authHeader = (): Record<string, string> => {
  try {
    return { Authorization: `Bearer ${getAccessToken()}` }
  } catch {
    return {}
  }
}

/** Read the palette. Never throws: every failure is a PaletteRead that says why. */
export const readBlueprintPalette = async (base?: string, ns?: string): Promise<PaletteRead> => {
  if (!base || !ns) {
    return unavailable(PALETTE_NOT_CONFIGURED)
  }
  try {
    const url = new URL(`${base.replace(/\/+$/, '')}/call`)
    url.searchParams.set('resource', 'restactions')
    url.searchParams.set('apiVersion', 'templates.krateo.io/v1')
    url.searchParams.set('name', 'blueprint-palette')
    url.searchParams.set('namespace', ns)
    const response = await fetch(url.toString(), { headers: { ...authHeader() } })
    if (response.status === 404) {
      return unavailable(PALETTE_RA_MISSING)
    }
    if (response.status === 403) {
      return unavailable(PALETTE_RA_DENIED)
    }
    if (!response.ok) {
      return unavailable(`The blueprint-palette RESTAction could not run — snowplow answered ${response.status}. Kubernetes native kinds still work.`)
    }
    const cr = asRecord(await response.json().catch(() => null))
    return shapePaletteStatus(cr?.status)
  } catch (error) {
    return unavailable(`Could not reach snowplow — ${error instanceof Error ? error.message : String(error)}. Kubernetes native kinds still work.`)
  }
}
