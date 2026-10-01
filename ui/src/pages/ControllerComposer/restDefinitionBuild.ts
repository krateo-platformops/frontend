/**
 * T7 — the `validator: kog` kernel: build the oasgen 0.25 RestDefinition for one Kind mapping,
 * and validate it twice. Pure.
 *
 * BUILD. A KindMapping (identity + resolved verbs + the resource lists) becomes the CR the live
 * github-provider-kog RestDefinitions are: `ogen.krateo.io/v1alpha1` RestDefinition with
 * spec.{oasPath, resourceGroup, resource{kind, verbsDescription, identifiers, …}}. Verbs are listed
 * create, get, findby, update, delete. Empty optional lists are omitted — except that an unresolved
 * mapping conflict refuses the build: a Kind with two candidate findby operations has no single CR.
 *
 * VALIDATE.
 *   1. The shape: #419's validateRestDefinitionDraft (the live CRD — 0.25 — CEL rules included).
 *   2. The OAS cross-check, which the CRD cannot do: every verb's path is in the spec with that
 *      method; every fieldMapping inPath is a parameter of that path, and one read from status
 *      names a field status carries; every identifier and additionalStatusField exists in the get
 *      response — or, with no get, in one findby item (dotted paths followed through nested
 *      schemas); a findby envelope with two arrays names its itemsPath. A RestDefinition that
 *      passes (1) and fails (2) is accepted by the apiserver and then fails at oasgen processing or
 *      at the first reconcile — the reason to catch it here.
 *   3. Security: schemes oasgen skips are WARNINGS (the vendor's document declares them, the author
 *      did not), and "no scheme is supported" is its own warning — the resource then has no
 *      credentials field at all.
 *   4. Notices — warnings, never errors (controllerNotices): a jq valueMapping on a request-direction
 *      fieldMapping, which oasgen ≤0.25.1 ignores, and a Kind with findby but no get.
 */
import { REST_DEFINITION_API_VERSION, REST_DEFINITION_KIND, validateRestDefinitionDraft } from '../../components/Autopilot/kogMapping'
import { asRecord, isNonEmptyString } from '../../components/Autopilot/kogRestDefSchema'
import { restDefinitionWarnings } from '../../components/Autopilot/kogRestDefVerbs'

import { OAS_METHODS, type OasDocument, securitySchemeSupport, type SecuritySchemeSupport, deref } from './oasImport'
import {
  findbyItemSchema,
  type OperationMapping,
  type RestAction,
  schemaHasField,
  statusSourceSchema,
  successResponseSchema,
  VERB_ORDER,
} from './operationMapping'

export interface VerbMapping {
  method: string
  path: string
  fieldMapping?: Record<string, unknown>[]
  /** findby only: the property of an envelope response that holds the collection (`.values`). */
  itemsPath?: string
}

export interface ConfigurationFieldMapping {
  fromOpenAPI: { name: string; in: string }
  fromRestDefinition: { actions: string[] }
}

/** One Kind, as the inspector holds it. */
export interface KindMapping {
  /** metadata.name / namespace of the RestDefinition. */
  name: string
  namespace: string
  oasPath: string
  resourceGroup: string
  kind: string
  verbs: Partial<Record<RestAction, VerbMapping>>
  identifiers?: string[]
  additionalStatusFields?: string[]
  excludedSpecFields?: string[]
  configurationFields?: ConfigurationFieldMapping[]
  compareScope?: 'fullSpec' | 'identifiersAndStatus' | 'updatable'
  labels?: Record<string, string>
}

export type BuildResult =
  | { ok: true; restDefinition: Record<string, unknown> }
  | { ok: false; errors: string[] }

/** The verbs of an inferred mapping, with its fieldMapping suggestions attached — or its unresolved conflicts. */
export const verbsFromInference = (mapping: OperationMapping): { ok: true; verbs: Partial<Record<RestAction, VerbMapping>> } | { ok: false; errors: string[] } => {
  if (mapping.conflicts.length > 0 || mapping.overrideErrors.length > 0) {
    return { errors: [...mapping.conflicts.map((conflict) => conflict.sentence), ...mapping.overrideErrors], ok: false }
  }
  const verbs: Partial<Record<RestAction, VerbMapping>> = {}
  for (const action of VERB_ORDER) {
    const choice = mapping.verbs[action]
    if (!choice) {
      continue
    }
    const fieldMapping = mapping.fieldMappingSuggestions
      .filter((suggestion) => suggestion.action === action)
      .map((suggestion) => ({ inCustomResource: suggestion.inCustomResource, inPath: suggestion.inPath }))
    verbs[action] = { method: choice.method, path: choice.path, ...(fieldMapping.length > 0 ? { fieldMapping } : {}) }
  }
  return { ok: true, verbs }
}

/** Build the RestDefinition CR for one Kind. */
export const buildRestDefinition = (mapping: KindMapping): Record<string, unknown> => {
  const verbsDescription = VERB_ORDER.flatMap((action) => {
    const verb = mapping.verbs[action]
    if (!verb) {
      return []
    }
    return [{
      action,
      method: verb.method.toUpperCase(),
      path: verb.path,
      ...(verb.fieldMapping && verb.fieldMapping.length > 0 ? { fieldMapping: verb.fieldMapping } : {}),
      ...(action === 'findby' && verb.itemsPath ? { itemsPath: verb.itemsPath } : {}),
    }]
  })
  const list = <T>(field: string, value: T[] | undefined): Record<string, T[]> => (value && value.length > 0 ? { [field]: value } : {})
  return {
    apiVersion: REST_DEFINITION_API_VERSION,
    kind: REST_DEFINITION_KIND,
    metadata: {
      name: mapping.name,
      namespace: mapping.namespace,
      ...(mapping.labels && Object.keys(mapping.labels).length > 0 ? { labels: { ...mapping.labels } } : {}),
    },
    spec: {
      oasPath: mapping.oasPath,
      resource: {
        kind: mapping.kind,
        verbsDescription,
        ...list('identifiers', mapping.identifiers),
        ...list('additionalStatusFields', mapping.additionalStatusFields),
        ...list('excludedSpecFields', mapping.excludedSpecFields),
        ...list('configurationFields', mapping.configurationFields),
        ...(mapping.compareScope ? { compareScope: mapping.compareScope } : {}),
      },
      resourceGroup: mapping.resourceGroup,
    },
  }
}

export interface ControllerValidation {
  /** Empty = publishable. */
  errors: string[]
  warnings: string[]
  security: SecuritySchemeSupport[]
}

/** The findby's ENVELOPE, checked the way oasgen reads it: two array properties and no itemsPath is refused, and a declared itemsPath must name an array. */
const findbyEnvelopeErrors = (doc: OasDocument, findby: { method: string; path: string; itemsPath: unknown }): string[] => {
  const response = successResponseSchema(doc, findby.method, findby.path)
  if (!response) { return [] }
  const itemsPath = isNonEmptyString(findby.itemsPath) ? findby.itemsPath : null
  const item = findbyItemSchema(doc, response, itemsPath)
  return item.ok ? [] : [`findby (${findby.method} ${findby.path}): ${item.reason}${item.candidates.length && itemsPath ? ` (its arrays: ${item.candidates.join(', ')})` : ''}`]
}

/** The cross-check of a RestDefinition against the OAS document it points at. */
export const oasCrossCheckErrors = (restDefinition: Record<string, unknown>, doc: OasDocument): string[] => {
  const resource = asRecord(asRecord(restDefinition.spec)?.resource)
  const verbs = Array.isArray(resource?.verbsDescription) ? resource.verbsDescription.map(asRecord) : []
  const paths = asRecord(doc.paths) ?? {}
  const errors: string[] = []
  const found: Partial<Record<'get' | 'findby', { method: string; path: string; itemsPath: unknown }>> = {}
  const statusMappings: { at: string; field: string }[] = []
  verbs.forEach((verb, index) => {
    if (!verb || !isNonEmptyString(verb.path) || !isNonEmptyString(verb.method)) {
      return
    }
    const at = `verbsDescription[${index}] (${String(verb.action)})`
    const pathItem = deref(doc, paths[verb.path])
    if (!pathItem) {
      errors.push(`${at}: path ${verb.path} is not in the OAS document`)
      return
    }
    const method = verb.method.toLowerCase()
    if (!(OAS_METHODS as readonly string[]).includes(method) || !asRecord(pathItem[method])) {
      const has = OAS_METHODS.filter((entry) => asRecord(pathItem[entry])).map((entry) => entry.toUpperCase())
      errors.push(`${at}: ${verb.path} has no ${verb.method} operation in the OAS document (it has ${has.join(', ') || 'none'})`)
      return
    }
    if (verb.action === 'get' || verb.action === 'findby') {
      found[verb.action] = { itemsPath: verb.itemsPath, method: verb.method, path: verb.path }
    }
    const operation = asRecord(pathItem[method]) ?? {}
    const pathParams = [pathItem.parameters, operation.parameters]
      .flatMap((list): unknown[] => (Array.isArray(list) ? list as unknown[] : []))
      .map((entry) => deref(doc, entry))
      .filter((parameter) => parameter?.in === 'path')
      .map((parameter) => String(parameter?.name))
    const verbPath = verb.path
    const mappings = Array.isArray(verb.fieldMapping) ? verb.fieldMapping.map(asRecord) : []
    mappings.forEach((entry, mappingIndex) => {
      if (isNonEmptyString(entry?.inPath) && !pathParams.includes(entry.inPath)) {
        errors.push(`${at}.fieldMapping[${mappingIndex}]: inPath ${entry.inPath} is not a path parameter of ${verbPath}`)
      }
      if (isNonEmptyString(entry?.inPath) && isNonEmptyString(entry.inCustomResource) && entry.inCustomResource.startsWith('status.')) {
        statusMappings.push({ at: `${at}.fieldMapping[${mappingIndex}]`, field: entry.inCustomResource.slice('status.'.length) })
      }
    })
  })

  const listOf = (field: string): string[] => (Array.isArray(resource?.[field]) ? (resource[field] as unknown[]).filter(isNonEmptyString) : [])
  const identifiers = listOf('identifiers')
  const statusFields = listOf('additionalStatusFields')
  // A path parameter read from status needs status to CARRY that field: oasgen builds status from
  // identifiers and additionalStatusFields only, so anything else is never there to read.
  for (const { at, field } of statusMappings) {
    const carried = [...identifiers, ...statusFields].some((entry) => field === entry || field.startsWith(`${entry}.`))
    if (!carried) {
      errors.push(`${at}: reads status.${field}, which is not a status field — add ${field} to identifiers or additionalStatusFields, or the request never has it`)
    }
  }
  if (found.findby) {
    errors.push(...findbyEnvelopeErrors(doc, found.findby))
  }
  // Status is built from the get response — or, with no get, from one item of the findby response.
  const source = statusSourceSchema(doc, {
    ...(found.get ? { get: { method: found.get.method, path: found.get.path } } : {}),
    ...(found.findby ? { findby: { ...found.findby, itemsPath: isNonEmptyString(found.findby.itemsPath) ? found.findby.itemsPath : null } } : {}),
  })
  const sourceVerb = found.get ?? found.findby
  if (!sourceVerb) {
    if (identifiers.length > 0) {
      errors.push('identifiers cannot be checked: there is no get or findby verb whose response declares them')
    }
    return errors
  }
  const label = found.get ? 'the get response' : 'the findby item'
  if (!source) {
    if (found.get) {
      errors.push(`the get verb (${found.get.method} ${found.get.path}) declares no JSON success response, so no identifier can be found in it`)
    }
    return errors
  }
  for (const field of identifiers) {
    if (!schemaHasField(doc, source.schema, field)) {
      errors.push(`identifier ${field} is not a field of ${label} (${sourceVerb.method} ${sourceVerb.path})`)
    }
  }
  for (const field of statusFields) {
    if (!schemaHasField(doc, source.schema, field)) {
      errors.push(`additionalStatusField ${field} is not a field of ${label} (${sourceVerb.method} ${sourceVerb.path})`)
    }
  }
  return errors
}

/**
 * What the RestDefinition does that a person should know, though nothing refuses it: a jq valueMapping
 * on a request-direction fieldMapping (oasgen ≤0.25.1 drops it), and a Kind with findby but no get —
 * oasgen then builds status from the findby envelope's item (oasgen#146).
 */
export const controllerNotices = (restDefinition: Record<string, unknown>): string[] => {
  const resource = asRecord(asRecord(restDefinition.spec)?.resource)
  const actions = Array.isArray(resource?.verbsDescription) ? resource.verbsDescription.map((verb) => asRecord(verb)?.action) : []
  return [
    ...restDefinitionWarnings(restDefinition),
    ...(actions.includes('findby') && !actions.includes('get')
      ? [`${typeof resource?.kind === 'string' ? resource.kind : 'This Kind'} has no get verb: oasgen builds its status from the findby response — one item of its envelope — and every observe walks the findby list (oasgen#146).`]
      : []),
  ]
}

/** Validate a built RestDefinition: the 0.25 CRD shape, the OAS cross-check, the security schemes, and the notices. */
export const validateControllerRestDefinition = (restDefinition: Record<string, unknown>, doc: OasDocument): ControllerValidation => {
  const security = securitySchemeSupport(doc)
  const warnings = security
    .filter((scheme) => !scheme.supported)
    .map((scheme) => `security scheme ${scheme.name} (${scheme.type}) is skipped: ${scheme.reason}`)
  if (security.length > 0 && security.every((scheme) => !scheme.supported)) {
    warnings.push('no security scheme in the spec is supported, so the generated Configuration has no credentials field')
  }
  return {
    errors: [...validateRestDefinitionDraft(restDefinition), ...oasCrossCheckErrors(restDefinition, doc)],
    security,
    warnings: [...warnings, ...controllerNotices(restDefinition)],
  }
}
/** Build and validate in one step (what the inspector's "check" calls). */
export const buildAndValidate = (mapping: KindMapping, doc: OasDocument): ControllerValidation & { restDefinition: Record<string, unknown> } => {
  const restDefinition = buildRestDefinition(mapping)
  return { ...validateControllerRestDefinition(restDefinition, doc), restDefinition }
}
