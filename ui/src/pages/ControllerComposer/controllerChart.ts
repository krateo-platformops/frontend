/**
 * T8 — a controller DRAFT as the files it is (frontend#412). Pure: no React, no network.
 *
 * A CONTROLLER IS A CHART (frontend#405): N RestDefinitions and the OpenAPI document they read, in
 * a ConfigMap, registered by a CompositionDefinition — the shape github-provider-kog already has.
 * The held tree is exactly what a publish commits, less the registration file the publish writes:
 *
 *   Chart.yaml                               name, version, and two annotations: the API group the
 *                                            Kinds are served in and the base URL the controller calls
 *   values.yaml, values.schema.json          nothing to parameterise; the schema declares `global`
 *                                            only, closed, and with no `default:` anywhere
 *   templates/configmap-oas-<name>.yaml      the OpenAPI document, verbatim (servers set to the base URL)
 *   templates/restdefinition-<kind>.yaml ×N  one ogen.krateo.io/v1alpha1 RestDefinition per Kind
 *   compositiondefinition.yaml               written at PUBLISH (it names the destination owner)
 *
 * NOTHING ABOUT THE COMPOSER LIVES OUTSIDE THOSE FILES. What a Kind is — its verbs, identifiers,
 * status fields, configuration fields — is its RestDefinition. The two facts a RestDefinition cannot
 * say ride on it as annotations: which resource group of the document it was placed from (so a verb
 * conflict the inference found is recomputed on every read, and a resumed draft shows the same
 * conflict it was saved with), and which verbs the person chose to leave out (so an omitted findby
 * is not mistaken for an unresolved one). A draft record therefore restores the composer exactly.
 *
 * NEVER RESOLVED BEHIND THE PERSON'S BACK. A verb two operations both look like is left OUT of the
 * RestDefinition and named as a conflict; only a person's choice (or omission) puts it in or settles
 * it. The lint (`lintControllerDraft`) names every unresolved conflict and every error T7's validator
 * finds, so a draft carrying either cannot be published.
 *
 * EVERY EDIT IS A MUTATION OF THE PARSED OBJECT, not a rebuild: a hand edit in Chart files (a
 * pagination block, a requestTransform) survives the next click in the inspector.
 */
import { dump, load } from 'js-yaml'

import { CHART_YAML_PATH, chartYamlName, chartYamlVersion } from '../../components/Autopilot/blueprintDraft'
import { BLUEPRINT_DRAFT_MAX_BYTES } from '../../components/Autopilot/blueprintDraftStore'
import { REST_DEFINITION_KIND } from '../../components/Autopilot/kogMapping'
import { asRecord, isNonEmptyString } from '../../components/Autopilot/kogRestDefSchema'

import { IMMUTABLE_REST_DEF_FIELDS, immutableFieldDiff } from './immutableDiff'
import { OAS_METHODS, type OasDocument, type OasFormat, type OasImport, parseOas } from './oasImport'
import { inferOperationMapping, type OperationMapping, type RestAction, VERB_ORDER, type VerbConflict } from './operationMapping'
import { operationsInGroup } from './paletteModel'
import { buildRestDefinition, type ControllerValidation, validateControllerRestDefinition } from './restDefinitionBuild'

export const VALUES_YAML_PATH = 'values.yaml'
/** The first version of every controller: Chart.yaml's, literally, and what its release is tagged. */
export const CONTROLLER_START_VERSION = '0.1.0'

/** The Chart.yaml annotations that carry what a Kind is served as and whom it calls. */
export const GROUP_ANNOTATION = 'controller.builders.krateo.io/api-group'
export const BASE_URL_ANNOTATION = 'controller.builders.krateo.io/base-url'
/** On a RestDefinition: the document's resource group it was placed from, and the verbs left out on purpose. */
export const OPERATIONS_ANNOTATION = 'controller.builders.krateo.io/operations'
export const OMITTED_ANNOTATION = 'controller.builders.krateo.io/omitted-verbs'

/** Helm resolves it at install: a chart that baked the author's namespace would install only there. */
export const RELEASE_NAMESPACE = '{{ .Release.Namespace }}'
/** What `{{ .Release.Namespace }}` is read as when a RestDefinition is validated before any install. */
const VALIDATION_NAMESPACE = 'release-namespace'

/** The spec may take the tree's cap less this — the chart files and the RestDefinitions need the rest. */
export const SPEC_HEADROOM_BYTES = 32 * 1024
export const SPEC_BUDGET_BYTES = BLUEPRINT_DRAFT_MAX_BYTES - SPEC_HEADROOM_BYTES

export const oasConfigMapPath = (name: string): string => `templates/configmap-oas-${name}.yaml`
export const oasConfigMapName = (name: string): string => `${name}-oas`
export const oasConfigMapKey = (format: OasFormat): string => (format === 'json' ? 'openapi.json' : 'openapi.yaml')
export const restDefinitionPath = (kind: string): string => `templates/restdefinition-${kind.toLowerCase()}.yaml`
export const RESTDEFINITION_PATH = /^templates\/restdefinition-[a-z0-9-]+\.yaml$/
export const CONFIGMAP_PATH = /^templates\/configmap-oas-[a-z0-9-]+\.yaml$/

export const toYaml = (value: unknown): string => dump(value, { lineWidth: -1, noRefs: true, sortKeys: false })

/**
 * `{{` in a document is text, not a template action — escaped the way Go templates spell a literal,
 * so Helm renders the document byte for byte. `}}` outside an action is already literal.
 */
const HELM_LITERAL_OPEN = '{{`{{`}}'
export const escapeHelm = (text: string): string => text.split('{{').join(HELM_LITERAL_OPEN)
export const unescapeHelm = (text: string): string => text.split(HELM_LITERAL_OPEN).join('{{')

// ── naming ──────────────────────────────────────────────────────────────────────────────────────

/** A Kind for a resource group: `pet` → Pet, `store-orders` → StoreOrder, `{tenant}` → Tenant. */
export const kindForGroup = (group: string): string => {
  const words = group.replace(/[{}]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean)
  const joined = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('') || 'Resource'
  const singular = /ies$/.test(joined) ? joined.replace(/ies$/, 'y') : joined.replace(/([^s])s$/, '$1')
  return /^[0-9]/.test(singular) ? `R${singular}` : singular
}

/** The plural the generated CRD serves a Kind under (flect's rules, for the words APIs name things). */
export const pluralOf = (kind: string): string => {
  const lower = kind.toLowerCase()
  if (/[^aeiou]y$/.test(lower)) { return `${lower.slice(0, -1)}ies` }
  if (/(s|x|z|ch|sh)$/.test(lower)) { return `${lower}es` }
  return `${lower}s`
}

// ── servers ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Every `servers` list the document carries — the root one, and each path item's and operation's.
 * rest-dynamic-controller lets an operation's (or its path's) `servers[0]` override the root, so a
 * base URL written only at the root would send those requests, and the credential with them, to
 * whatever host the document names. Each is listed by where it is: `servers`, `paths./x.servers`,
 * `paths./x.get.servers`.
 */
export const serverLocations = (doc: OasDocument): string[] => {
  const found: string[] = []
  if (doc.servers !== undefined) { found.push('servers') }
  for (const [path, value] of Object.entries(asRecord(doc.paths) ?? {})) {
    const item = asRecord(value)
    if (!item) { continue }
    if (item.servers !== undefined) { found.push(`paths.${path}.servers`) }
    for (const method of OAS_METHODS) {
      if (asRecord(item[method])?.servers !== undefined) { found.push(`paths.${path}.${method}.servers`) }
    }
  }
  return found
}

/** The document with EVERY servers list — root, path, operation — set to the base URL alone. */
export const withServers = (doc: OasDocument, baseUrl: string): OasDocument => {
  const url = baseUrl.trim()
  if (!url) { return doc }
  const servers = [{ url }]
  const paths = Object.fromEntries(Object.entries(asRecord(doc.paths) ?? {}).map(([path, value]) => {
    const item = asRecord(value)
    if (!item) { return [path, value] }
    const next: Record<string, unknown> = { ...item }
    if (item.servers !== undefined) { next.servers = servers }
    for (const method of OAS_METHODS) {
      const operation = asRecord(item[method])
      if (operation?.servers !== undefined) { next[method] = { ...operation, servers } }
    }
    return [path, next]
  }))
  return { ...doc, ...(doc.paths !== undefined ? { paths } : {}), servers }
}

// ── reading a held draft ────────────────────────────────────────────────────────────────────────

export interface ControllerKind {
  path: string
  kind: string
  /** The RestDefinition as held — `{{ .Release.Namespace }}` and all. */
  restDefinition: Record<string, unknown>
  /** The document's resource group it was placed from. */
  group: string
  omitted: RestAction[]
  /** The inference over the group's operations — what the verbs are measured against. */
  inference: OperationMapping | null
  /** Inferred conflicts the person has not settled: the verb is neither set nor omitted. */
  conflicts: VerbConflict[]
  /** T7's validator on the RestDefinition as it will be installed (namespace resolved). */
  validation: ControllerValidation | null
}

export interface ControllerModel {
  name: string | null
  version: string | null
  group: string
  baseUrl: string
  /** The ConfigMap's path, its key, and the document it carries. */
  spec: { path: string; key: string; oas: OasImport } | null
  /** Why there is no document to read, or null. */
  specProblem: string | null
  kinds: ControllerKind[]
  /** Files that should be RestDefinitions and do not read as one. */
  unreadable: { path: string; reason: string }[]
}

const annotationsOf = (record: Record<string, unknown>): Record<string, unknown> =>
  asRecord(asRecord(record.metadata)?.annotations) ?? {}

const chartAnnotation = (chartText: string | undefined, key: string): string => {
  try {
    const value = asRecord(asRecord(load(chartText ?? ''))?.annotations)?.[key]
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

const readSpecConfigMap = (files: Readonly<Record<string, string>>): { spec: ControllerModel['spec']; problem: string | null } => {
  const paths = Object.keys(files).filter((path) => CONFIGMAP_PATH.test(path)).sort()
  if (!paths.length) {
    return { problem: 'No templates/configmap-oas-<name>.yaml holds the OpenAPI document, so no operation can be mapped.', spec: null }
  }
  const [path] = paths
  let parsed: Record<string, unknown> | null
  try {
    parsed = asRecord(load(files[path]))
  } catch (error) {
    return { problem: `${path} is not YAML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`, spec: null }
  }
  const data = asRecord(parsed?.data) ?? {}
  const key = ['openapi.json', 'openapi.yaml'].find((entry) => typeof data[entry] === 'string') ?? Object.keys(data).find((entry) => typeof data[entry] === 'string')
  if (!key) {
    return { problem: `${path} carries no document under data.`, spec: null }
  }
  const read = parseOas(unescapeHelm(data[key] as string))
  if (!read.ok) {
    return { problem: `${path}: ${read.error}`, spec: null }
  }
  return { problem: null, spec: { key, oas: read.documents[0], path } }
}

/** A RestDefinition with the release namespace resolved to a placeholder name — what the validator reads. */
const resolvedForValidation = (restDefinition: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(restDefinition).split(RELEASE_NAMESPACE).join(VALIDATION_NAMESPACE)) as Record<string, unknown>

const verbsOf = (restDefinition: Record<string, unknown>): Record<string, unknown>[] => {
  const list = asRecord(asRecord(restDefinition.spec)?.resource)?.verbsDescription
  return Array.isArray(list) ? list.map((entry) => asRecord(entry) ?? {}) : []
}

export const heldVerb = (restDefinition: Record<string, unknown>, action: RestAction): { method: string; path: string } | null => {
  const entry = verbsOf(restDefinition).find((verb) => verb.action === action)
  return entry && isNonEmptyString(entry.method) && isNonEmptyString(entry.path) ? { method: entry.method.toUpperCase(), path: entry.path } : null
}

const omittedOf = (restDefinition: Record<string, unknown>): RestAction[] => {
  const raw = annotationsOf(restDefinition)[OMITTED_ANNOTATION]
  return typeof raw === 'string'
    ? raw.split(',').map((entry) => entry.trim()).filter((entry): entry is RestAction => (VERB_ORDER as readonly string[]).includes(entry))
    : []
}

const readKind = (path: string, text: string, spec: ControllerModel['spec']): ControllerKind | { path: string; reason: string } => {
  let restDefinition: Record<string, unknown> | null
  try {
    restDefinition = asRecord(load(text))
  } catch (error) {
    return { path, reason: `not YAML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` }
  }
  const kind = asRecord(asRecord(restDefinition?.spec)?.resource)?.kind
  if (!restDefinition || restDefinition.kind !== REST_DEFINITION_KIND || !isNonEmptyString(kind)) {
    return { path, reason: 'not a RestDefinition with a spec.resource.kind' }
  }
  const annotated = annotationsOf(restDefinition)[OPERATIONS_ANNOTATION]
  const firstPath = verbsOf(restDefinition).map((verb) => verb.path).find(isNonEmptyString)
  const group = typeof annotated === 'string' && annotated ? annotated : (firstPath?.split('/').find(Boolean) ?? '')
  const omitted = omittedOf(restDefinition)
  const inference = spec ? inferOperationMapping(spec.oas.doc, operationsInGroup(spec.oas.operations, group)) : null
  const conflicts = (inference?.conflicts ?? []).filter((conflict) => !heldVerb(restDefinition, conflict.action) && !omitted.includes(conflict.action))
  const validation = spec ? validateControllerRestDefinition(resolvedForValidation(restDefinition), spec.oas.doc) : null
  return { conflicts, group, inference, kind, omitted, path, restDefinition, validation }
}

export const readController = (files: Readonly<Record<string, string>>): ControllerModel => {
  const chartText = files[CHART_YAML_PATH]
  const { problem, spec } = readSpecConfigMap(files)
  const kinds: ControllerKind[] = []
  const unreadable: ControllerModel['unreadable'] = []
  for (const path of Object.keys(files).filter((entry) => RESTDEFINITION_PATH.test(entry)).sort()) {
    const read = readKind(path, files[path], spec)
    if ('kind' in read) {
      kinds.push(read)
    } else {
      unreadable.push(read)
    }
  }
  return {
    baseUrl: chartAnnotation(chartText, BASE_URL_ANNOTATION),
    group: chartAnnotation(chartText, GROUP_ANNOTATION),
    kinds,
    name: chartYamlName(chartText),
    spec,
    specProblem: problem,
    unreadable,
    version: chartYamlVersion(chartText),
  }
}

// ── locked once published ─────────────────────────────────────────────────────────────────────────

/**
 * What a PUBLISHED controller's RestDefinitions said about their CEL-immutable fields
 * (immutableDiff.ts: kind, resourceGroup, identifiers, configurationFields, additionalStatusFields,
 * excludedSpecFields), by path. Taken when a publish lands and kept on the draft record, so a
 * resumed draft still knows what it may no longer change.
 */
export type LockedSnapshot = Record<string, Record<string, unknown>>

const LOCKED_RESOURCE_FIELDS = IMMUTABLE_REST_DEF_FIELDS.filter((field) => field !== 'resourceGroup')

export const lockedSnapshot = (files: Readonly<Record<string, string>>): LockedSnapshot => {
  const snapshot: LockedSnapshot = {}
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

const show = (value: unknown): string => (value === undefined ? 'unset' : JSON.stringify(value))

/** The sentence a change to a locked field is refused with (the mockup's screen 11). */
export const lockedSentence = (kind: string, field: string, before: unknown, after: unknown): string =>
  `cannot update ${kind} in place: ${field} is locked once published (${show(before)} → ${show(after)}). Changing it means deleting the RestDefinition — and every ${kind} it serves — and recreating it; undo the change, or place a new Kind instead.`

/** Each locked field a held RestDefinition changed since it was published, as refusal sentences. */
const lockedChangesOf = (path: string, restDefinition: Record<string, unknown>, locked: LockedSnapshot | null | undefined): string[] => {
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
    try {
      const restDefinition = asRecord(load(files[path]))
      return restDefinition ? lockedChangesOf(path, restDefinition, locked) : []
    } catch {
      return []
    }
  })
}

/**
 * Every servers entry the HELD document names that is not the base URL — a hand edit in Chart files
 * that would send some operation's requests, and its credential, to another host.
 */
const foreignServers = (model: ControllerModel): string[] => {
  if (!model.spec) { return [] }
  const { doc } = model.spec.oas
  const urlsAt = (where: string): unknown => {
    if (where === 'servers') { return doc.servers }
    const [, path, method] = /^paths\.(.+?)\.(?:(get|put|post|delete|options|head|patch|trace)\.)?servers$/.exec(where) ?? []
    const item = asRecord(asRecord(doc.paths)?.[path ?? ''])
    return method ? asRecord(item?.[method])?.servers : item?.servers
  }
  return serverLocations(doc).flatMap((where) => {
    const list = urlsAt(where)
    const urls = Array.isArray(list) ? list.map((entry) => asRecord(entry)?.url) : []
    const foreign = urls.filter((url) => url !== model.baseUrl)
    return foreign.length || !urls.length
      ? [`${model.spec?.path ?? 'the document'}: ${where} names ${foreign.map((url) => String(url)).join(', ') || 'no URL'}, not the base URL ${model.baseUrl || '(unset)'} — the controller would send those requests, and their credential, elsewhere.`]
      : []
  })
}

/**
 * The chart lint's controller half: the document reads, every Kind reads, no Kind is left with a
 * conflict nobody settled, and T7's validator passes every RestDefinition. Never throws — it runs
 * inside the draft broadcast.
 */
export const lintControllerDraft = (files: Readonly<Record<string, string>>, locked?: LockedSnapshot | null): string[] => {
  try {
    const model = readController(files)
    return [
      ...lockedChanges(files, locked),
      ...(model.specProblem ? [model.specProblem] : []),
      ...foreignServers(model),
      ...model.unreadable.map(({ path, reason }) => `${path}: ${reason}`),
      ...model.kinds.flatMap((entry) => [
        ...entry.conflicts.map((conflict) => `${entry.kind}: ${conflict.sentence.replace(/ — choose one\.$/, '')} — choose one in the inspector, or leave ${conflict.action} out.`),
        ...(entry.validation?.errors ?? []).map((error) => `${entry.kind} (${entry.path}): ${error}`),
      ]),
    ]
  } catch (error) {
    return [`the controller could not be read — ${error instanceof Error ? error.message : String(error)}`]
  }
}

// ── edits, each a plan for one files batch ──────────────────────────────────────────────────────

export type ControllerPlan =
  | { ok: true; add?: Record<string, string>; edit?: Record<string, string>; remove?: string[]; expect?: Record<string, string>; path: string }
  | { ok: false; reason: string }

/** Place a resource group of the document as a Kind: its RestDefinition, verbs inferred, conflicts left out. */
export const planPlaceGroup = (files: Readonly<Record<string, string>>, group: string): ControllerPlan => {
  const model = readController(files)
  if (!model.spec) {
    return { ok: false, reason: model.specProblem ?? 'There is no OpenAPI document to place from.' }
  }
  if (!model.name || !model.group) {
    return { ok: false, reason: 'Chart.yaml names no controller or no API group, so a Kind cannot be named or served.' }
  }
  const placed = model.kinds.find((entry) => entry.group === group)
  if (placed) {
    return { ok: false, reason: `${group} is already placed as ${placed.kind}.` }
  }
  const operations = operationsInGroup(model.spec.oas.operations, group)
  if (!operations.length) {
    return { ok: false, reason: `The document has no operations under ${group}.` }
  }
  const kind = kindForGroup(group)
  const path = restDefinitionPath(kind)
  if (Object.prototype.hasOwnProperty.call(files, path) || model.kinds.some((entry) => entry.kind === kind)) {
    return { ok: false, reason: `A Kind named ${kind} is already placed.` }
  }
  const mapping = inferOperationMapping(model.spec.oas.doc, operations)
  const verbs: Parameters<typeof buildRestDefinition>[0]['verbs'] = {}
  for (const action of VERB_ORDER) {
    const choice = mapping.verbs[action]
    if (!choice) { continue }
    const fieldMapping = mapping.fieldMappingSuggestions
      .filter((suggestion) => suggestion.action === action)
      .map((suggestion) => ({ inCustomResource: suggestion.inCustomResource, inPath: suggestion.inPath }))
    verbs[action] = { method: choice.method, path: choice.path, ...(fieldMapping.length ? { fieldMapping } : {}) }
  }
  if (!Object.keys(verbs).length && !mapping.conflicts.length) {
    return { ok: false, reason: `No operation under ${group} reads as a create, get, findby, update or delete — nothing to map.` }
  }
  const identifier = mapping.identifierCandidates[0]?.field
  const restDefinition = buildRestDefinition({
    identifiers: identifier ? [identifier] : [],
    kind,
    name: `${model.name}-${kind.toLowerCase()}`,
    namespace: RELEASE_NAMESPACE,
    oasPath: `configmap://${RELEASE_NAMESPACE}/${oasConfigMapName(model.name)}/${model.spec.key}`,
    resourceGroup: model.group,
    verbs,
  })
  const metadata = asRecord(restDefinition.metadata) ?? {}
  restDefinition.metadata = { ...metadata, annotations: { [OPERATIONS_ANNOTATION]: group } }
  // A Kind whose every verb is in conflict still has to be written: an empty list would be refused
  // by the CRD, so the file says what is missing — and the lint says it louder.
  return { add: { [path]: toYaml(restDefinition) }, ok: true, path }
}

/** Mutate one held RestDefinition: the plan edits its file, pinned to the bytes it was read from. */
const planMutation = (
  files: Readonly<Record<string, string>>,
  path: string,
  mutate: (restDefinition: Record<string, unknown>, resource: Record<string, unknown>) => string | null,
  locked?: LockedSnapshot | null,
): ControllerPlan => {
  if (!Object.prototype.hasOwnProperty.call(files, path)) {
    return { ok: false, reason: `${path} is not held any more.` }
  }
  let restDefinition: Record<string, unknown> | null
  try {
    restDefinition = asRecord(load(files[path]))
  } catch {
    restDefinition = null
  }
  const spec = asRecord(restDefinition?.spec)
  const resource = asRecord(spec?.resource)
  if (!restDefinition || !resource) {
    return { ok: false, reason: `${path} does not read as a RestDefinition — fix it in Chart files first.` }
  }
  const refused = mutate(restDefinition, resource)
  if (refused) {
    return { ok: false, reason: refused }
  }
  // Published: a change to a locked field is REFUSED, not merely labelled — the apiserver would.
  const [lockedRefusal] = lockedChangesOf(path, restDefinition, locked)
  if (lockedRefusal) {
    return { ok: false, reason: lockedRefusal }
  }
  return { edit: { [path]: toYaml(restDefinition) }, expect: { [path]: files[path] }, ok: true, path }
}

/** The record without `key` — a list or map left empty is dropped, never written as `[]` or `{}`. */
const without = (record: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key))

/** Set `key` on the record, or drop it when the value is empty. Mutates, like every plan here. */
const setOrDrop = (record: Record<string, unknown>, key: string, value: unknown): void => {
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
  const next = empty ? without(record, key) : { ...record, [key]: value }
  for (const entry of Object.keys(record)) {
    if (!(entry in next)) { Reflect.deleteProperty(record, entry) }
  }
  Object.assign(record, next)
}

const setAnnotation = (restDefinition: Record<string, unknown>, key: string, value: string | null): void => {
  const metadata = { ...(asRecord(restDefinition.metadata) ?? {}) }
  const annotations = { ...(asRecord(metadata.annotations) ?? {}) }
  setOrDrop(annotations, key, value)
  setOrDrop(metadata, 'annotations', Object.keys(annotations).length ? annotations : null)
  restDefinition.metadata = metadata
}

const ordered = (verbs: Record<string, unknown>[]): Record<string, unknown>[] =>
  [...verbs].sort((left, right) => VERB_ORDER.indexOf(left.action as RestAction) - VERB_ORDER.indexOf(right.action as RestAction))

/**
 * Set one verb to one operation — a conflict's choice, a dropped operation, or the verbs table — or
 * leave it OUT on purpose (`null`). The fieldMapping the inference suggests for that operation rides
 * along; a hand-written entry for the same verb is replaced, since it was about another operation.
 */
export const planSetVerb = (
  files: Readonly<Record<string, string>>,
  path: string,
  action: RestAction,
  choice: { method: string; path: string } | null,
  locked?: LockedSnapshot | null,
): ControllerPlan => {
  const model = readController(files)
  const held = model.kinds.find((entry) => entry.path === path)
  return planMutation(files, path, (restDefinition, resource) => {
    const others = verbsOf(restDefinition).filter((verb) => verb.action !== action)
    const omitted = omittedOf(restDefinition).filter((entry) => entry !== action)
    if (choice === null) {
      resource.verbsDescription = ordered(others)
      setAnnotation(restDefinition, OMITTED_ANNOTATION, [...omitted, action].sort().join(','))
      return null
    }
    const operation = model.spec?.oas.operations.find((entry) => entry.method === choice.method.toUpperCase() && entry.path === choice.path)
    if (model.spec && !operation) {
      return `${choice.method.toUpperCase()} ${choice.path} is not an operation of the document.`
    }
    const suggestions = model.spec && held
      ? inferOperationMapping(model.spec.oas.doc, [...operationsInGroup(model.spec.oas.operations, held.group), ...(operation && operation.group !== held.group ? [operation] : [])], [{ action, method: choice.method, path: choice.path }])
        .fieldMappingSuggestions.filter((suggestion) => suggestion.action === action)
        .map((suggestion) => ({ inCustomResource: suggestion.inCustomResource, inPath: suggestion.inPath }))
      : []
    resource.verbsDescription = ordered([...others, { action, method: choice.method.toUpperCase(), path: choice.path, ...(suggestions.length ? { fieldMapping: suggestions } : {}) }])
    setAnnotation(restDefinition, OMITTED_ANNOTATION, omitted.join(','))
    return null
  }, locked)
}

/** Toggle one entry of a string list on the resource (identifiers, additionalStatusFields). */
export const planToggleField = (
  files: Readonly<Record<string, string>>,
  path: string,
  list: 'identifiers' | 'additionalStatusFields',
  field: string,
  locked?: LockedSnapshot | null,
): ControllerPlan => planMutation(files, path, (_restDefinition, resource) => {
  const current = Array.isArray(resource[list]) ? (resource[list] as unknown[]).filter(isNonEmptyString) : []
  const next = current.includes(field) ? current.filter((entry) => entry !== field) : [...current, field]
  setOrDrop(resource, list, next)
  return null
}, locked)

export type CompareScope = 'fullSpec' | 'identifiersAndStatus' | 'updatable'

export const planCompareScope = (files: Readonly<Record<string, string>>, path: string, scope: CompareScope | null, locked?: LockedSnapshot | null): ControllerPlan =>
  planMutation(files, path, (_restDefinition, resource) => {
    setOrDrop(resource, 'compareScope', scope)
    return null
  }, locked)

/**
 * Toggle a parameter as a CONFIGURATION field: read from the Kind's <Kind>Configuration instead of
 * every resource's spec, for the verbs whose operations carry it.
 */
export const planToggleConfigurationField = (
  files: Readonly<Record<string, string>>,
  path: string,
  parameter: { name: string; in: string; actions: string[] },
  locked?: LockedSnapshot | null,
): ControllerPlan => planMutation(files, path, (_restDefinition, resource) => {
  const current = Array.isArray(resource.configurationFields) ? (resource.configurationFields as unknown[]).map((entry) => asRecord(entry) ?? {}) : []
  const matches = (entry: Record<string, unknown>) => {
    const from = asRecord(entry.fromOpenAPI)
    return from?.name === parameter.name && from?.in === parameter.in
  }
  const next = current.some(matches)
    ? current.filter((entry) => !matches(entry))
    : [...current, { fromOpenAPI: { in: parameter.in, name: parameter.name }, fromRestDefinition: { actions: [...parameter.actions] } }]
  setOrDrop(resource, 'configurationFields', next)
  return null
}, locked)

/** Remove a Kind: its RestDefinition goes. */
export const planRemoveKind = (files: Readonly<Record<string, string>>, path: string): ControllerPlan =>
  (Object.prototype.hasOwnProperty.call(files, path)
    ? { expect: { [path]: files[path] }, ok: true, path, remove: [path] }
    : { ok: false, reason: `${path} is not held any more.` })

// ── registration ────────────────────────────────────────────────────────────────────────────────

/**
 * The CompositionDefinition that REGISTERS a published controller — written at publish, because its
 * OCI url names the owner the person confirms. Null with no owner: a location with an empty owner
 * is not a location.
 */
export const controllerCompositionDefinition = (
  name: string,
  owner: string,
  repo: string,
  version: string,
  files: Readonly<Record<string, string>>,
): string | null => {
  const who = owner.trim().toLowerCase()
  if (!who || !name.trim() || !version.trim()) {
    return null
  }
  const model = readController(files)
  const kinds = model.kinds.map((entry) => entry.kind)
  const served = kinds.length ? `${kinds.join(', ')} in ${model.group || 'its API group'}` : 'the Kinds its RestDefinitions declare'
  return `# REGISTERS this controller: core-provider pulls the chart and serves it as a composition. Installing
# one creates its RestDefinitions, and oasgen-provider then generates ${served}
# (v1alpha1), each with a <Kind>Configuration that names the credential Secret.
# Once release ${version.trim()} is green, register it from the portal: Controller Builder -> your controllers
# -> Register; Install then creates a composition of it, which applies the RestDefinitions (portal#275).
# The same file is attached to https://github.com/${who}/${repo.trim()}/releases/tag/${version.trim()}.
apiVersion: core.krateo.io/v1alpha1
kind: CompositionDefinition
metadata:
  name: ${name.trim()}
  namespace: krateo-system
spec:
  chart:
    url: oci://ghcr.io/${who}/charts/${name.trim()}
    version: ${version.trim()}
`
}
