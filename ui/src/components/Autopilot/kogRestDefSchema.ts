/**
 * T11b — the oasgen-provider 0.23.0 RestDefinition schema primitives shared by kogMapping
 * and kogRestDefVerbs: the CRD enums, the keys each object level names, the spec.oasPath /
 * jq-ref URI parser, and the field-level error helpers (enums, strings, integer lists, jq
 * programs, {name, value} lists). Mirrors the live `restdefinitions.ogen.krateo.io` CRD
 * dumped from krateo-057 (oasgen-provider 0.23.0) — the contract is spelled out in
 * kogMapping.ts's header. Pure: no React, no network.
 */

/** The live CRD enums for verbsDescription entries. */
export const REST_DEF_ACTIONS = ['create', 'update', 'get', 'delete', 'findby'] as const
export const REST_DEF_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const
/** The live CRD enums of the 0.23 fields. */
export const REST_DEF_COMPARE_SCOPES = ['fullSpec', 'identifiersAndStatus', 'updatable'] as const
export const REST_DEF_ASYNC_MODES = ['blocking', 'requeue'] as const
export const REST_DEF_VALUE_MAPPING_TYPES = ['alias', 'jq'] as const
/** The RESTAction delegations on spec.resource (each an ApiRef). */
export const REST_DEF_API_REFS = ['observeApiRef', 'createApiRef', 'updateApiRef', 'deleteApiRef'] as const

/**
 * The keys each object level of the live CRD names. Anything else is pruned by the
 * apiserver (the schema has no preserve-unknown-fields there), so a draft carrying one
 * would publish with that setting silently gone — reject it instead.
 */
export const KNOWN_KEYS = {
  apiRef: ['name', 'namespace', 'extras', 'notFoundExpr', 'upToDateExpr'],
  async: ['mode', 'operationRef', 'poll', 'postGet'],
  configurationField: ['fromOpenAPI', 'fromRestDefinition'],
  continuationToken: ['request', 'response'],
  fieldMapping: ['inPath', 'inQuery', 'inBody', 'inResponse', 'inCustomResource', 'valueMapping', 'resolver', 'defaultIfAbsent'],
  fromOpenAPI: ['name', 'in'],
  fromRestDefinition: ['actions'],
  jq: ['inline', 'ref', 'entrypoint'],
  nameValue: ['name', 'value'],
  operationRef: ['in', 'path', 'jq'],
  pagination: ['type', 'continuationToken'],
  poll: ['method', 'path', 'handleParam', 'statusPath', 'successValues', 'failureValues', 'intervalSeconds', 'maxAttempts', 'timeoutSeconds'],
  requestFieldMapping: ['inPath', 'inQuery', 'inBody', 'inCustomResource'],
  resolver: ['type', 'secretRef'],
  resource: [
    'kind', 'verbsDescription', 'identifiers', 'additionalStatusFields', 'compareScope', 'configurationFields',
    'excludedSpecFields', ...REST_DEF_API_REFS,
  ],
  secretRef: ['nameFromCustomResource', 'keyFromCustomResource'],
  spec: ['oasPath', 'resourceGroup', 'resource'],
  tokenLocation: ['tokenIn', 'tokenPath'],
  valueAlias: ['customResourceValue', 'apiValue'],
  valueMapping: ['type', 'aliases', 'jq'],
  verb: [
    'action', 'method', 'path', 'requestFieldMapping', 'fieldMapping', 'requestTransform', 'responseTransform',
    'identifiersMatchPolicy', 'pagination', 'successCodes', 'headers', 'queries', 'tolerateCodes', 'notFoundCodes',
    'notFoundBody', 'async',
  ],
} as const satisfies Record<string, readonly string[]>

/** The parsed forms of a valid spec.oasPath. */
export interface OasPathConfigMapRef { form: 'configmap'; namespace: string; name: string; key: string }
export interface OasPathUrlRef { form: 'url'; url: string }
export type OasPathRef = OasPathConfigMapRef | OasPathUrlRef

/** The namespace / name segments of a configmap:// URI — the live CRD pattern's `[a-z0-9-]+` (no dots). */
const OAS_SEGMENT = /^[a-z0-9-]+$/
/** The ConfigMap KEY of a configmap:// URI — the live CRD pattern's `[a-zA-Z0-9._-]+`. */
const OAS_KEY = /^[a-zA-Z0-9._-]+$/
/** http(s):// — BOTH schemes are first-class per the live CRD pattern (`https?://\S+`). */
const OAS_URL = /^https?:\/\/\S+$/

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null)

export const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/**
 * Parse a spec.oasPath into its configmap:// or http(s):// form. Null = neither form
 * (the ONLY two the live CRD pattern admits — anything else is rejected).
 */
export const parseOasPath = (value: unknown): OasPathRef | null => {
  if (!isNonEmptyString(value)) {
    return null
  }
  if (OAS_URL.test(value)) {
    return { form: 'url', url: value }
  }
  const configMap = /^configmap:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(value)
  if (configMap) {
    const [, namespace, name, key] = configMap
    if (OAS_SEGMENT.test(namespace) && OAS_SEGMENT.test(name) && OAS_KEY.test(key)) {
      return { form: 'configmap', key, name, namespace }
    }
  }
  return null
}

/** Error lines for every key of `record` the live CRD does not name at this level. */
export const unknownFieldErrors = (record: Record<string, unknown>, known: readonly string[], at: string): string[] =>
  Object.keys(record)
    .filter((key) => !known.includes(key))
    .map((key) => `${at}: unknown field "${key}" (not in the oasgen 0.23.0 RestDefinition schema; the apiserver would drop it)`)

/** Error lines for a value that must be one of `values` (absent is fine unless `required`). */
export const enumErrors = (value: unknown, values: readonly string[], at: string, required = false): string[] => {
  if (value === undefined && !required) {
    return []
  }
  return isNonEmptyString(value) && values.includes(value) ? [] : [`${at} must be one of ${values.join('|')}`]
}

/** Error lines for a required non-empty string field. */
export const requiredStringErrors = (record: Record<string, unknown>, field: string, at: string): string[] =>
  (isNonEmptyString(record[field]) ? [] : [`${at}.${field} is required`])

/** Error lines for an optional string field of the wrong type. */
export const optionalStringErrors = (record: Record<string, unknown>, field: string, at: string): string[] =>
  (record[field] === undefined || typeof record[field] === 'string' ? [] : [`${at}.${field} must be a string`])

/** Error lines for an optional list of integers (successCodes / tolerateCodes / notFoundCodes / …). */
export const integerListErrors = (value: unknown, at: string): string[] => {
  if (value === undefined) {
    return []
  }
  return Array.isArray(value) && value.every((entry) => Number.isInteger(entry)) ? [] : [`${at} must be a list of integers`]
}

/** Error lines for an optional integer. */
export const optionalIntegerErrors = (record: Record<string, unknown>, field: string, at: string): string[] =>
  (record[field] === undefined || Number.isInteger(record[field]) ? [] : [`${at}.${field} must be an integer`])

/** Error lines for a list of strings; `minItems` 1 makes it non-empty. */
export const stringListErrors = (value: unknown, at: string, minItems = 0): string[] => {
  if (value === undefined) {
    return minItems > 0 ? [`${at} requires at least ${minItems} entry`] : []
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return [`${at} must be a list of strings`]
  }
  return value.length < minItems ? [`${at} requires at least ${minItems} entry`] : []
}

/**
 * A jq program (requestTransform / responseTransform / notFoundBody / valueMapping.jq /
 * operationRef.jq / apiRef notFoundExpr + upToDateExpr): EXACTLY ONE of inline|ref,
 * entrypoint only with ref, ref in the oasPath URI scheme (all CEL on the live CRD).
 */
export const jqProgramErrors = (value: unknown, at: string): string[] => {
  if (value === undefined) {
    return []
  }
  const program = asRecord(value)
  if (!program) {
    return [`${at}: must be an object ({inline} or {ref, entrypoint})`]
  }
  const errors = unknownFieldErrors(program, KNOWN_KEYS.jq, at)
  if ((program.inline !== undefined) === (program.ref !== undefined)) {
    errors.push(`${at}: exactly one of inline|ref must be set`)
  }
  if (program.entrypoint !== undefined && program.ref === undefined) {
    errors.push(`${at}: entrypoint is only valid together with ref`)
  }
  if (program.ref !== undefined && !parseOasPath(program.ref)) {
    errors.push(`${at}.ref must be configmap://<namespace>/<name>/<key> or http(s)://…`)
  }
  errors.push(
    ...optionalStringErrors(program, 'inline', at),
    ...optionalStringErrors(program, 'entrypoint', at),
  )
  return errors
}

/** A list of {name, value} string pairs (verb headers / queries). */
export const nameValueListErrors = (value: unknown, at: string): string[] => {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    return [`${at} must be an array`]
  }
  return value.flatMap((entry: unknown, index: number) => {
    const entryAt = `${at}[${index}]`
    const record = asRecord(entry)
    if (!record) {
      return [`${entryAt}: must be an object ({name, value})`]
    }
    return [
      ...unknownFieldErrors(record, KNOWN_KEYS.nameValue, entryAt),
      ...requiredStringErrors(record, 'name', entryAt),
      ...(typeof record.value === 'string' ? [] : [`${entryAt}.value is required`]),
    ]
  })
}
