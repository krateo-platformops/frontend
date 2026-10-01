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
 *   templates/configmap-oas-<name>.yaml      the OpenAPI document, verbatim but for its servers (the base
 *                                            URL) and info.version (pinned to v1alpha1 — servedVersion.ts)
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
 *
 * Reading a held draft lives in controllerModel.ts and the published locks in controllerLocks.ts; both
 * are re-exported here, so this module stays the one callers import.
 */
import { dump, load } from 'js-yaml'

import { CHART_YAML_PATH } from '../../components/Autopilot/blueprintDraft'
import { BLUEPRINT_DRAFT_MAX_BYTES } from '../../components/Autopilot/blueprintDraftStore'
import { asRecord, isNonEmptyString } from '../../components/Autopilot/kogRestDefSchema'

import { lockedChangesOf, lockedChanges, type LockedSnapshot } from './controllerLocks'
import {
  CONFIRMED_ANNOTATION,
  confirmedOf,
  type ControllerKind,
  type ControllerModel,
  heldMapping,
  heldVerb,
  OMITTED_ANNOTATION,
  omittedOf,
  OPERATIONS_ANNOTATION,
  readController,
  RELEASE_NAMESPACE,
  RESTDEFINITION_PATH,
  verbsOf,
} from './controllerModel'
import { OAS_METHODS, type OasDocument, type OasFormat } from './oasImport'
import {
  type FieldMappingSuggestion,
  inferOperationMapping,
  requestBodySchema,
  type RestAction,
  scalarLeaves,
  schemaHasField,
  schemaProperties,
  VERB_ORDER,
} from './operationMapping'
import { operationsInGroup } from './paletteModel'
import { buildRestDefinition } from './restDefinitionBuild'
import {
  CONFIGMAP_PATH,
  escapeHelm,
  HELM_LITERAL_OPEN,
  SERVED_VERSION,
  lockedServedVersion,
  servedVersionProblems,
  servedVersionUnknown,
  unescapeHelm,
} from './servedVersion'
import { shownUrl, urlCredentialProblem } from './urlCredential'

export { CONFIGMAP_PATH, escapeHelm, SERVED_VERSION, unescapeHelm }
export * from './controllerModel'
export * from './controllerLocks'

export const VALUES_YAML_PATH = 'values.yaml'
/** The first version of every controller: Chart.yaml's, literally, and what its release is tagged. */
export const CONTROLLER_START_VERSION = '0.1.0'

/** The spec may take the tree's cap less this — the chart files and the RestDefinitions need the rest. */
export const SPEC_HEADROOM_BYTES = 32 * 1024
export const SPEC_BUDGET_BYTES = BLUEPRINT_DRAFT_MAX_BYTES - SPEC_HEADROOM_BYTES

export const oasConfigMapPath = (name: string): string => `templates/configmap-oas-${name}.yaml`
export const oasConfigMapName = (name: string): string => `${name}-oas`
export const oasConfigMapKey = (format: OasFormat): string => (format === 'json' ? 'openapi.json' : 'openapi.yaml')
export const restDefinitionPath = (kind: string): string => `templates/restdefinition-${kind.toLowerCase()}.yaml`

export const toYaml = (value: unknown): string => dump(value, { lineWidth: -1, noRefs: true, sortKeys: false })

/**
 * True when a document text still carries a Helm action once its escaped literals are set aside —
 * a hand edit like `{{ fail "boom" }}`. Helm would evaluate it at install, while the preview sends the
 * text as it is, so what the preview rendered would not be what installs.
 */
export const carriesHelmAction = (text: string): boolean => text.split(HELM_LITERAL_OPEN).join('').includes('{{')

/** The registration file a publish writes at the repository root (publishDraft.ts REGISTRATION_PATH). */
const REGISTRATION_FILE = 'compositiondefinition.yaml'

/**
 * The files a controller chart is made of. Anything else would be committed and installed without
 * ever going through the preview's render — so it is refused, by path, instead.
 */
export const isControllerChartPath = (path: string): boolean =>
  path === CHART_YAML_PATH || /^values[^/]*$/.test(path) || RESTDEFINITION_PATH.test(path) || CONFIGMAP_PATH.test(path) || path === REGISTRATION_FILE

/** Each OAS ConfigMap data key that carries a Helm action, as a sentence naming the file and key. */
export const helmActionProblems = (files: Readonly<Record<string, string>>): string[] =>
  Object.keys(files).filter((path) => CONFIGMAP_PATH.test(path)).sort()
    .flatMap((path) => {
      let data: Record<string, unknown>
      try {
        data = asRecord(asRecord(load(files[path]))?.data) ?? {}
      } catch {
        return []
      }
      return Object.entries(data)
        .filter(([, text]) => typeof text === 'string' && carriesHelmAction(text))
        .map(([key]) => `${path}: data.${key} carries a Helm template action ({{ … }}) — the document must be literal, since Helm would evaluate it at install and the preview does not. Write a literal {{ as {{\`{{\`}}.`)
    })

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
      ? [`${model.spec?.path ?? 'the document'}: ${where} names ${foreign.map(shownUrl).join(', ') || 'no URL'}, not the base URL ${model.baseUrl ? shownUrl(model.baseUrl) : '(unset)'} — the controller would send those requests, and their credential, elsewhere.`]
      : []
  })
}

/**
 * The chart lint's controller half: the document reads and says info.version v1alpha1, every Kind
 * reads, no Kind is left with a conflict — or an ambiguous id binding — nobody settled, and T7's
 * validator passes every RestDefinition. Never throws — it runs inside the draft broadcast.
 */
export const lintControllerDraft = (files: Readonly<Record<string, string>>, locked?: LockedSnapshot | null): string[] => {
  try {
    const model = readController(files)
    return [
      ...lockedChanges(files, locked),
      ...(model.baseUrl && urlCredentialProblem(model.baseUrl) ? [`Chart.yaml: the base URL — ${urlCredentialProblem(model.baseUrl) ?? ''}`] : []),
      ...Object.keys(files).filter((path) => !isControllerChartPath(path)).sort()
        .map((path) => `${path}: a controller chart holds only Chart.yaml, values*, templates/restdefinition-<kind>.yaml and templates/configmap-oas-<name>.yaml — this file would be published without the preview ever rendering it. Remove it.`),
      ...helmActionProblems(files),
      ...(model.specProblem ? [model.specProblem] : []),
      ...(model.spec ? servedVersionProblems(model.spec.path, model.spec.oas.doc, lockedServedVersion(locked, model.spec.path) !== null || servedVersionUnknown(locked, model.spec.path)) : []),
      ...foreignServers(model),
      ...model.unreadable.map(({ path, reason }) => `${path}: ${reason}`),
      ...model.kinds.flatMap((entry) => [
        ...entry.conflicts.map((conflict) => `${entry.kind}: ${conflict.sentence.replace(/ — choose one\.$/, '')} — choose one in the inspector, or leave ${conflict.action} out.`),
        ...entry.unconfirmed.map((binding) => `${entry.kind}: ${binding.sentence} Confirm {${binding.param}} → ${binding.current} in the inspector, or bind it to ${binding.choices.filter((choice) => choice !== binding.current).join(' or ') || 'another field'}.`),
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

/** The fieldMapping entries the kernel suggests for one verb (inPath → the CR field it is read from). */
const suggestedFieldMapping = (suggestions: readonly FieldMappingSuggestion[], action: RestAction): Record<string, unknown>[] =>
  suggestions.filter((suggestion) => suggestion.action === action).map((suggestion) => ({ inCustomResource: suggestion.inCustomResource, inPath: suggestion.inPath }))

/** The create body's schema for a held RestDefinition, or null (no create verb, no document). */
const createBodyOf = (doc: OasDocument | undefined, restDefinition: Record<string, unknown>): unknown => {
  const create = heldVerb(restDefinition, 'create')
  return doc && create ? requestBodySchema(doc, create.method, create.path) : null
}

/**
 * What a status-sourced id binding needs beside the fieldMapping, applied to the resource: the field it
 * reads must BE in status (oasgen builds status from identifiers + additionalStatusFields only), and a
 * field status carries is not also asked of the person in spec — it goes to excludedSpecFields when the
 * create body has it (petstore's `id`). Fields already listed are left as they are; both lists stay
 * editable afterwards.
 */
const settleStatusBindings = (doc: OasDocument | undefined, restDefinition: Record<string, unknown>, resource: Record<string, unknown>): void => {
  const bound = verbsOf(restDefinition).flatMap((verb): unknown[] => (Array.isArray(verb.fieldMapping) ? verb.fieldMapping as unknown[] : []))
    .map((entry) => asRecord(entry)?.inCustomResource)
    .filter((field): field is string => isNonEmptyString(field) && field.startsWith('status.'))
    .map((field) => field.slice('status.'.length))
  if (!bound.length) { return }
  const list = (key: string): string[] => (Array.isArray(resource[key]) ? (resource[key] as unknown[]).filter(isNonEmptyString) : [])
  const identifiers = list('identifiers')
  const statusFields = list('additionalStatusFields')
  const missing = bound.filter((field) => !identifiers.includes(field) && !statusFields.includes(field))
  setOrDrop(resource, 'additionalStatusFields', [...statusFields, ...new Set(missing)])
  const body = createBodyOf(doc, restDefinition)
  const excluded = list('excludedSpecFields')
  const exclude = bound.filter((field) => !excluded.includes(field) && !!doc && !!body && schemaHasField(doc, body, field))
  setOrDrop(resource, 'excludedSpecFields', [...excluded, ...new Set(exclude)])
}

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
    const fieldMapping = suggestedFieldMapping(mapping.fieldMappingSuggestions, action)
    verbs[action] = { method: choice.method, path: choice.path, ...(fieldMapping.length ? { fieldMapping } : {}) }
  }
  if (!Object.keys(verbs).length && !mapping.conflicts.length) {
    return { ok: false, reason: `No operation under ${group} reads as a create, get, findby, update or delete — nothing to map.` }
  }
  // The identifier is the field the id is read from when status carries it (KOG's baseline), else the
  // first candidate the get response offers.
  const identifier = mapping.boundStatusFields[0] ?? mapping.identifierCandidates[0]?.field
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
  const resource = asRecord(asRecord(restDefinition.spec)?.resource)
  if (resource) { settleStatusBindings(model.spec.oas.doc, restDefinition, resource) }
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

/**
 * Set one verb to one operation — a conflict's choice, a dropped operation, or the verbs table — or
 * leave it OUT on purpose (`null`). The fieldMapping the inference suggests for that operation rides
 * along — computed over the verbs as held, so a status-sourced id finds the held create's response —
 * and a hand-written entry for the same verb is replaced, since it was about another operation. A
 * status binding it brings is settled (status carries the field; spec does not ask for it).
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
    let suggestions = model.spec && held
      ? suggestedFieldMapping(heldMapping(model.spec, held.group, restDefinition, { action, choice }).fieldMappingSuggestions, action)
      : []
    // PUBLISHED: the lists a status binding would add to are locked, so nothing is added to them. The
    // binding the verb already had is kept for every parameter the chosen path still carries — a
    // re-pick of the same operation changes nothing — and only a parameter it never bound is suggested.
    const published = !!locked?.[path]
    if (published) {
      const previous = verbsOf(restDefinition).find((verb) => verb.action === action)
      const kept = (Array.isArray(previous?.fieldMapping) ? (previous.fieldMapping as unknown[]).map((entry) => asRecord(entry) ?? {}) : [])
        .filter((entry) => typeof entry.inPath === 'string' && choice.path.includes(`{${entry.inPath}}`))
      suggestions = [...kept, ...suggestions.filter((entry) => !kept.some((have) => have.inPath === entry.inPath))]
    }
    resource.verbsDescription = ordered([...others, { action, method: choice.method.toUpperCase(), path: choice.path, ...(suggestions.length ? { fieldMapping: suggestions } : {}) }])
    setAnnotation(restDefinition, OMITTED_ANNOTATION, omitted.join(','))
    if (!published) { settleStatusBindings(model.spec?.oas.doc, restDefinition, resource) }
    return null
  }, locked)
}

/** Toggle one entry of a string list on the resource (identifiers, additionalStatusFields, excludedSpecFields). */
export const planToggleField = (
  files: Readonly<Record<string, string>>,
  path: string,
  list: 'identifiers' | 'additionalStatusFields' | 'excludedSpecFields',
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
 * BIND a path parameter to the CR field it is read from — the inspector's confirm step for an
 * ambiguous id (`{keyId}`: `status.keyId` or `status.id`), or a parameter named differently across
 * verbs. Every held verb whose path carries the parameter (or a name the kernel reads as the same
 * segment) gets `{inPath, inCustomResource: field}`; the parameter is recorded as CONFIRMED; a status
 * field is settled (status carries it; spec does not ask for it). `field` is `spec.<path>` or
 * `status.<path>` — a leaf, never an object.
 */
export const planBindPathParam = (
  files: Readonly<Record<string, string>>,
  path: string,
  param: string,
  field: string,
  locked?: LockedSnapshot | null,
): ControllerPlan => {
  const model = readController(files)
  const held = model.kinds.find((entry) => entry.path === path)
  return planMutation(files, path, (restDefinition, resource) => {
    if (!/^(spec|status)\.[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/.test(field)) {
      return `${field} is not a field of the resource — bind {${param}} to spec.<field> or status.<field>.`
    }
    const names = new Set([param, ...(held?.held?.paramAliases.find((alias) => alias.names.includes(param))?.names ?? [])])
    const verbs = verbsOf(restDefinition)
    let bound = 0
    resource.verbsDescription = verbs.map((verb) => {
      const params = isNonEmptyString(verb.path) ? [...verb.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]) : []
      const here = params.filter((name) => names.has(name))
      if (!here.length) { return verb }
      bound += here.length
      const kept = (Array.isArray(verb.fieldMapping) ? (verb.fieldMapping as unknown[]).map((entry) => asRecord(entry) ?? {}) : [])
        .filter((entry) => !here.includes(String(entry.inPath)))
      return { ...verb, fieldMapping: [...kept, ...here.map((name) => ({ inCustomResource: field, inPath: name }))] }
    })
    if (!bound) {
      return `No verb of ${held?.kind ?? 'this Kind'} has {${param}} in its path.`
    }
    const doc = model.spec?.oas.doc
    if (doc && field.startsWith('status.') && held?.held) {
      const source = field.slice('status.'.length)
      const offered = held.held.fieldMappingSuggestions.flatMap((entry) => [entry.inCustomResource, ...entry.alternatives])
      const known = [...held.held.identifierCandidates, ...held.held.statusFieldCandidates].map((entry) => entry.field)
      if (!offered.includes(field) && !known.includes(source)) {
        return `${source} is not a field the ${held.held.verbs.get ? 'get response' : 'findby item'} returns, so status would never carry it.`
      }
    }
    const confirmed = [...new Set([...confirmedOf(restDefinition), ...names])].sort()
    setAnnotation(restDefinition, CONFIRMED_ANNOTATION, confirmed.join(','))
    // Published: identifiers, status and excluded fields are locked — a binding that needs one of them
    // changed is refused by the validator's own sentence, never by a list change the person did not make.
    if (!locked?.[path]) { settleStatusBindings(doc, restDefinition, resource) }
    return null
  }, locked)
}

/**
 * Set (or clear, with null) the findby's itemsPath — the property of an ENVELOPE response that holds
 * the collection. oasgen refuses to guess between two array properties; this is the person saying which.
 */
export const planSetItemsPath = (
  files: Readonly<Record<string, string>>,
  path: string,
  itemsPath: string | null,
  locked?: LockedSnapshot | null,
): ControllerPlan => planMutation(files, path, (restDefinition, held) => {
  const verbs = verbsOf(restDefinition)
  if (!verbs.some((verb) => verb.action === 'findby')) {
    return 'There is no findby verb to set an itemsPath on — map findby first.'
  }
  const trimmed = itemsPath?.trim() ?? ''
  let value: string | null = null
  if (trimmed) { value = trimmed.startsWith('.') ? trimmed : `.${trimmed}` }
  held.verbsDescription = verbs.map((verb) => {
    if (verb.action !== 'findby') { return verb }
    const next = { ...verb }
    setOrDrop(next, 'itemsPath', value)
    return next
  })
  return null
}, locked)

/**
 * What spec may leave out (excludedSpecFields) — the inspector's checkboxes and the only fields
 * controllerSetExcludedFields takes: what a status binding reads, then the create body's fields
 * (top-level, and nested leaves).
 */
export const exclusionCandidates = (kind: ControllerKind, model: ControllerModel): { field: string; reason: string }[] => {
  const doc = model.spec?.oas.doc
  const create = heldVerb(kind.restDefinition, 'create')
  const body = doc && create ? requestBodySchema(doc, create.method, create.path) : null
  const bound = (kind.held?.boundStatusFields ?? []).map((field) => ({ field, reason: 'status carries it — the id is read from there' }))
  const fields = doc && body
    ? [...Object.keys(schemaProperties(doc, body)), ...scalarLeaves(doc, body).map((leaf) => leaf.path).filter((path) => path.includes('.'))]
    : []
  return [...bound, ...fields.filter((field) => !bound.some((entry) => entry.field === field)).map((field) => ({ field, reason: 'sent by create' }))]
}

/** One header or query parameter of a Kind's verbs that may move to its Configuration, and the verbs that carry it. */
export interface ConfigurationCandidate {
  name: string
  in: string
  /** `['*']` when every held verb carries it, else the verbs that do. */
  actions: string[]
  /** True when no security scheme of the document is this parameter — an ordinary configuration value (api-version, a page size). */
  nonAuth: boolean
}

/** The header and query parameters of a Kind's held verbs — what may be read from its Configuration instead of every resource's spec. */
export const configurationCandidates = (model: ControllerModel, kind: ControllerKind): ConfigurationCandidate[] => {
  const found = new Map<string, { name: string; in: string; actions: string[] }>()
  const held = VERB_ORDER.filter((action) => heldVerb(kind.restDefinition, action))
  for (const action of held) {
    const verb = heldVerb(kind.restDefinition, action)
    const operation = verb ? model.spec?.oas.operations.find((entry) => entry.method === verb.method && entry.path === verb.path) : undefined
    for (const parameter of operation?.parameters ?? []) {
      if (parameter.in !== 'header' && parameter.in !== 'query') { continue }
      const key = `${parameter.in}:${parameter.name}`
      const entry = found.get(key) ?? { actions: [], in: parameter.in, name: parameter.name }
      entry.actions.push(action)
      found.set(key, entry)
    }
  }
  const schemes = asRecord(asRecord(model.spec?.oas.doc.components)?.securitySchemes) ?? {}
  const authNames = new Set(Object.values(schemes).map((scheme) => asRecord(scheme)).filter((scheme) => scheme?.type === 'apiKey')
    .map((scheme) => `${String(scheme?.in)}:${String(scheme?.name)}`))
  return [...found.values()].map((entry) => ({
    ...entry,
    actions: held.length > 1 && entry.actions.length === held.length ? ['*'] : entry.actions,
    nonAuth: !authNames.has(`${entry.in}:${entry.name}`),
  }))
}

/**
 * Toggle a parameter as a CONFIGURATION field: read from the Kind's <Kind>Configuration instead of
 * every resource's spec, for the verbs whose operations carry it (`*` when every verb does).
 */
export const planToggleConfigurationField = (
  files: Readonly<Record<string, string>>,
  path: string,
  parameter: { name: string; in: string; actions: string[] },
  locked?: LockedSnapshot | null,
): ControllerPlan => planMutation(files, path, (_restDefinition, held) => {
  const current = Array.isArray(held.configurationFields) ? (held.configurationFields as unknown[]).map((entry) => asRecord(entry) ?? {}) : []
  const matches = (entry: Record<string, unknown>) => {
    const from = asRecord(entry.fromOpenAPI)
    return from?.name === parameter.name && from?.in === parameter.in
  }
  const next = current.some(matches)
    ? current.filter((entry) => !matches(entry))
    : [...current, { fromOpenAPI: { in: parameter.in, name: parameter.name }, fromRestDefinition: { actions: [...parameter.actions] } }]
  setOrDrop(held, 'configurationFields', next)
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
