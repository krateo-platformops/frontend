/**
 * A held controller draft, READ (split from controllerChart.ts, which edits it): the annotations a
 * RestDefinition carries beside what the CRD can say, and `readController` — the document in its
 * ConfigMap, each Kind's RestDefinition, the inference over its resource group and over the verbs as
 * held, the id bindings that wait for a confirm, and T7's validation. Pure: no React, no network.
 * Everything here is re-exported by controllerChart.ts, which is what callers import.
 */
import { load } from 'js-yaml'

import { CHART_YAML_PATH, chartYamlName, chartYamlVersion } from '../../components/Autopilot/blueprintDraft'
import { REST_DEFINITION_KIND } from '../../components/Autopilot/kogMapping'
import { asRecord, isNonEmptyString } from '../../components/Autopilot/kogRestDefSchema'

import { deref, type OasDocument, type OasImport, type OasOperation, parseOas } from './oasImport'
import {
  inferOperationMapping,
  type MappingOverride,
  type OperationMapping,
  requestBodySchema,
  type RestAction,
  schemaHasField,
  VERB_ORDER,
  type VerbConflict,
} from './operationMapping'
import { operationsInGroup } from './paletteModel'
import { type ControllerValidation, validateControllerRestDefinition } from './restDefinitionBuild'
import { CONFIGMAP_PATH, sourceSpecVersion, specInfoVersion, unescapeHelm } from './servedVersion'

/** The Chart.yaml annotations that carry what a Kind is served as and whom it calls. */
export const GROUP_ANNOTATION = 'controller.builders.krateo.io/api-group'
export const BASE_URL_ANNOTATION = 'controller.builders.krateo.io/base-url'
/** On a RestDefinition: the document's resource group it was placed from, and the verbs left out on purpose. */
export const OPERATIONS_ANNOTATION = 'controller.builders.krateo.io/operations'
export const OMITTED_ANNOTATION = 'controller.builders.krateo.io/omitted-verbs'
/** On a RestDefinition: the path parameters whose id binding a person confirmed (an ambiguous one waits for this). */
export const CONFIRMED_ANNOTATION = 'controller.builders.krateo.io/confirmed-bindings'

/** Helm resolves it at install: a chart that baked the author's namespace would install only there. */
export const RELEASE_NAMESPACE = '{{ .Release.Namespace }}'
/** What `{{ .Release.Namespace }}` is read as when a RestDefinition is validated before any install. */
const VALIDATION_NAMESPACE = 'release-namespace'

export const RESTDEFINITION_PATH = /^templates\/restdefinition-[a-z0-9-]+\.yaml$/

// ── reading a held draft ────────────────────────────────────────────────────────────────────────

/** A held id binding that waits for a person: the parameter, what it is bound to, and what else it could be. */
export interface UnconfirmedBinding {
  param: string
  /** The CR field the held fieldMapping reads it from. */
  current: string
  /** Every field it could be bound to, the current one first. */
  choices: string[]
  sentence: string
}

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
  /**
   * The same kernel over the verbs AS HELD (a person's choices, a dropped operation, the held findby
   * itemsPath): what the pickers offer and where each id binding comes from.
   */
  held: OperationMapping | null
  /** Inferred conflicts the person has not settled: the verb is neither set nor omitted. */
  conflicts: VerbConflict[]
  /** Path-parameter bindings the held fieldMapping carries that are ambiguous and not yet confirmed. */
  unconfirmed: UnconfirmedBinding[]
  /** The parameters whose binding a person confirmed. */
  confirmed: string[]
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
  /** The held document's info.version — v1alpha1, the version every Kind is served under (servedVersion.ts). */
  servedVersion: string | null
  /** The info.version the vendor's document came with (Chart.yaml's source-spec-version), or null. */
  sourceVersion: string | null
  kinds: ControllerKind[]
  /** Files that should be RestDefinitions and do not read as one. */
  unreadable: { path: string; reason: string }[]
}

export const annotationsOf = (record: Record<string, unknown>): Record<string, unknown> =>
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

export const verbsOf = (restDefinition: Record<string, unknown>): Record<string, unknown>[] => {
  const list = asRecord(asRecord(restDefinition.spec)?.resource)?.verbsDescription
  return Array.isArray(list) ? list.map((entry) => asRecord(entry) ?? {}) : []
}

export const heldVerb = (restDefinition: Record<string, unknown>, action: RestAction): { method: string; path: string } | null => {
  const entry = verbsOf(restDefinition).find((verb) => verb.action === action)
  return entry && isNonEmptyString(entry.method) && isNonEmptyString(entry.path) ? { method: entry.method.toUpperCase(), path: entry.path } : null
}

/** The held findby's itemsPath, or null. */
export const heldItemsPath = (restDefinition: Record<string, unknown>): string | null => {
  const value = verbsOf(restDefinition).find((verb) => verb.action === 'findby')?.itemsPath
  return isNonEmptyString(value) ? value : null
}

export const omittedOf = (restDefinition: Record<string, unknown>): RestAction[] => {
  const raw = annotationsOf(restDefinition)[OMITTED_ANNOTATION]
  return typeof raw === 'string'
    ? raw.split(',').map((entry) => entry.trim()).filter((entry): entry is RestAction => (VERB_ORDER as readonly string[]).includes(entry))
    : []
}

export const confirmedOf = (restDefinition: Record<string, unknown>): string[] => {
  const raw = annotationsOf(restDefinition)[CONFIRMED_ANNOTATION]
  return typeof raw === 'string' ? raw.split(',').map((entry) => entry.trim()).filter(Boolean) : []
}

/** The group's operations plus any held verb's operation from another group (a dropped one). */
const operationsFor = (spec: NonNullable<ControllerModel['spec']>, group: string, extra: readonly { method: string; path: string }[]): OasOperation[] => {
  const inGroup = operationsInGroup(spec.oas.operations, group)
  const others = extra.flatMap((choice) => {
    const found = spec.oas.operations.find((entry) => entry.method === choice.method.toUpperCase() && entry.path === choice.path)
    return found && !inGroup.includes(found) ? [found] : []
  })
  return [...inGroup, ...others]
}

/** The kernel over the verbs a RestDefinition HOLDS (and leaves out), with `change` on top. */
export const heldMapping = (
  spec: NonNullable<ControllerModel['spec']>,
  group: string,
  restDefinition: Record<string, unknown>,
  change?: { action: RestAction; choice: { method: string; path: string } | null },
): OperationMapping => {
  const omitted = omittedOf(restDefinition)
  const overrides: MappingOverride[] = []
  const extra: { method: string; path: string }[] = []
  for (const action of VERB_ORDER) {
    const choice = change?.action === action ? change.choice : heldVerb(restDefinition, action)
    if (choice) {
      overrides.push({ action, method: choice.method, path: choice.path })
      extra.push(choice)
    } else if (change?.action === action || omitted.includes(action)) {
      overrides.push({ action, omit: true })
    }
  }
  return inferOperationMapping(spec.oas.doc, operationsFor(spec, group, extra), overrides, heldItemsPath(restDefinition))
}

/** The held fieldMapping's path bindings that are ambiguous (or name one segment twice) and nobody confirmed. */
const unconfirmedOf = (restDefinition: Record<string, unknown>, held: OperationMapping | null, confirmed: readonly string[]): UnconfirmedBinding[] => {
  if (!held) { return [] }
  const found = new Map<string, UnconfirmedBinding>()
  for (const verb of verbsOf(restDefinition)) {
    const mappings = Array.isArray(verb.fieldMapping) ? verb.fieldMapping.map((entry) => asRecord(entry) ?? {}) : []
    for (const mapping of mappings) {
      const param = mapping.inPath
      const current = mapping.inCustomResource
      if (!isNonEmptyString(param) || !isNonEmptyString(current) || confirmed.includes(param) || found.has(param)) { continue }
      const suggestion = held.fieldMappingSuggestions.find((entry) => entry.inPath === param && entry.action === verb.action)
      if (!suggestion?.confirm) { continue }
      const choices = [...new Set([current, suggestion.inCustomResource, ...suggestion.alternatives])]
      found.set(param, { choices, current, param, sentence: suggestion.confirm })
    }
  }
  return [...found.values()]
}

/** One path parameter the held verbs read from the resource, as the inspector and the agent are both told it. */
export interface PathIdBinding {
  param: string
  /** The CR field it is read from (`status.metadata.id`). */
  field: string
  /** The verbs whose path carries it. */
  actions: string[]
  /** Why it is read from there (the kernel's reason), or `set in the file`. */
  reason: string
  /** Why it waits for a confirm, or null once confirmed / unambiguous. */
  confirm: string | null
  /** Every field it could be bound to, the held one first. */
  choices: string[]
}

/** Each fieldMapping path binding the held verbs carry — what the inspector's Path ids and the agent's summary show. */
export const pathIdBindings = (kind: ControllerKind): PathIdBinding[] => {
  const found = new Map<string, PathIdBinding>()
  for (const verb of verbsOf(kind.restDefinition)) {
    const mappings = Array.isArray(verb.fieldMapping) ? verb.fieldMapping.map((entry) => asRecord(entry) ?? {}) : []
    for (const mapping of mappings) {
      const param = mapping.inPath
      const field = mapping.inCustomResource
      if (!isNonEmptyString(param) || !isNonEmptyString(field)) { continue }
      const known = found.get(param)
      if (known) {
        known.actions.push(String(verb.action))
        continue
      }
      const suggestion = kind.held?.fieldMappingSuggestions.find((entry) => entry.inPath === param)
      const unconfirmed = kind.unconfirmed.find((entry) => entry.param === param)
      found.set(param, {
        actions: [String(verb.action)],
        choices: [...new Set([field, ...(unconfirmed?.choices ?? []), ...(suggestion ? [suggestion.inCustomResource, ...suggestion.alternatives] : [])])],
        confirm: unconfirmed?.sentence ?? null,
        field,
        param,
        reason: suggestion && suggestion.inCustomResource === field ? suggestion.reason : 'set in the file',
      })
    }
  }
  return [...found.values()]
}

/**
 * The path parameters status supplies but oasgen would still ask spec for: each one that EVERY held
 * verb whose path carries it reads from `status.*` (petstore's `{petId}` ← status.id). oasgen injects a
 * verb's path parameters into spec — required — unless excludedSpecFields names the PARAMETER (0.25+).
 * One any verb reads from spec, or leaves unmapped (oasgen then reads spec), is not among them. Only
 * an operation's own parameters are injected: whether spec carries one is specCarriesField's question.
 */
export const statusBoundPathParams = (restDefinition: Record<string, unknown>): string[] => {
  const fromStatus = new Map<string, boolean>()
  for (const verb of verbsOf(restDefinition)) {
    const params = isNonEmptyString(verb.path) ? [...verb.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]) : []
    const mappings = Array.isArray(verb.fieldMapping) ? verb.fieldMapping.map((entry) => asRecord(entry) ?? {}) : []
    for (const param of params) {
      const field = mappings.find((mapping) => mapping.inPath === param)?.inCustomResource
      fromStatus.set(param, (fromStatus.get(param) ?? true) && isNonEmptyString(field) && field.startsWith('status.'))
    }
  }
  return [...fromStatus].filter(([, status]) => status).map(([param]) => param)
}

/**
 * Is a field in the spec oasgen builds — so excludedSpecFields may name it? oasgen starts spec from the
 * create body and adds each held verb's OPERATION-level parameters; a parameter declared only on the
 * path item is never added, and excluding it is the warning "set in excludedSpecFields not found in
 * schema". With no document there is nothing to tell by, and the answer is yes.
 */
export const specCarriesField = (doc: OasDocument | undefined, restDefinition: Record<string, unknown>, field: string): boolean => {
  if (!doc) { return true }
  const create = heldVerb(restDefinition, 'create')
  const body = create ? requestBodySchema(doc, create.method, create.path) : null
  if (body && schemaHasField(doc, body, field)) { return true }
  return verbsOf(restDefinition).some((verb) => {
    if (!isNonEmptyString(verb.method) || !isNonEmptyString(verb.path)) { return false }
    const own = asRecord(deref(doc, asRecord(doc.paths)?.[verb.path])?.[verb.method.toLowerCase()])?.parameters
    return Array.isArray(own) && own.some((entry) => deref(doc, entry)?.name === field)
  })
}

/** The sentence a PUBLISHED Kind carries for a status-bound path parameter its locked excludedSpecFields does not name. */
export const askedOnCreateSentence = (param: string): string =>
  `${param} is asked for on create because this controller was published before it was excluded; excluding it needs the RestDefinition recreated.`

/**
 * What a published Kind's spec still asks for that status supplies — one sentence per parameter, for
 * the inspector and the agent's summary alike. excludedSpecFields is CEL-immutable, so nothing is
 * changed: an unpublished draft has the parameter excluded as it is bound (settleStatusBindings).
 */
export const askedOnCreateNotes = (kind: ControllerKind, published: boolean, doc: OasDocument | undefined): string[] => {
  if (!published) { return [] }
  const resource = asRecord(asRecord(kind.restDefinition.spec)?.resource) ?? {}
  const excluded = Array.isArray(resource.excludedSpecFields) ? resource.excludedSpecFields.filter(isNonEmptyString) : []
  return statusBoundPathParams(kind.restDefinition).filter((param) => !excluded.includes(param) && specCarriesField(doc, kind.restDefinition, param))
    .map(askedOnCreateSentence)
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
  const confirmed = confirmedOf(restDefinition)
  const inference = spec ? inferOperationMapping(spec.oas.doc, operationsInGroup(spec.oas.operations, group)) : null
  const held = spec ? heldMapping(spec, group, restDefinition) : null
  const conflicts = (inference?.conflicts ?? []).filter((conflict) => !heldVerb(restDefinition, conflict.action) && !omitted.includes(conflict.action))
  const validation = spec ? validateControllerRestDefinition(resolvedForValidation(restDefinition), spec.oas.doc) : null
  return { confirmed, conflicts, group, held, inference, kind, omitted, path, restDefinition, unconfirmed: unconfirmedOf(restDefinition, held, confirmed), validation }
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
    servedVersion: spec ? specInfoVersion(spec.oas.doc) : null,
    sourceVersion: sourceSpecVersion(chartText),
    spec,
    specProblem: problem,
    unreadable,
    version: chartYamlVersion(chartText),
  }
}
