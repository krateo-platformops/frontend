/**
 * T7 — the `inspector: restdef-mapping` kernel: which operation of the imported spec is each verb
 * of one Kind. Pure.
 *
 * INFERENCE, by the shape of the path (the last segment decides item vs collection):
 *   POST   /x                → create
 *   GET    /x/{id}           → get
 *   PUT|PATCH /x or /x/{id}  → update
 *   DELETE /x/{id}           → delete
 *   GET    /x, GET /x/findBy* → findby
 * A literal segment under an item that the selection also holds (`POST /pet/{petId}/uploadImage`)
 * is an ACTION on that item, not a verb of the Kind — it is left unmapped, with that reason.
 *
 * NEVER SILENTLY RESOLVED. Two operations that both look like one verb (GET /pet/findByStatus and
 * GET /pet/findByTags) are a CONFLICT, listed with every candidate. The kernel does not pick; an
 * override does. Overrides apply on top of the inference: `{action, method, path}` sets a verb
 * (and settles its conflict), `{action, omit: true}` drops it.
 *
 * FROM THE SCHEMAS, once the verbs are known:
 *   - identifier candidates — the GET response's scalar fields, the ones the get path addresses
 *     first (Label's `name`), then the one a renamed path parameter stands for (petId → `id`);
 *   - status field candidates — GET response fields the create body does not send (the server
 *     assigned them: Label's id/node_id/url/default), plus any declared readOnly;
 *   - fieldMapping suggestions — a path parameter the CR has no field for, whose name says which
 *     response field it is (petId ↔ id): `{inPath: petId, inCustomResource: spec.id|status.id}`.
 */
import { asRecord } from '../../components/Autopilot/kogRestDefSchema'
import type { REST_DEF_ACTIONS } from '../../components/Autopilot/kogRestDefSchema'

import { deref, type OasDocument, type OasOperation } from './oasImport'

export type RestAction = typeof REST_DEF_ACTIONS[number]

/** The order verbs are listed in (the order the live github-provider-kog RestDefinitions use). */
export const VERB_ORDER: readonly RestAction[] = ['create', 'get', 'findby', 'update', 'delete']

export interface VerbChoice {
  action: RestAction
  method: string
  path: string
  operationId: string | null
  /** Why this operation is this verb: the inference rule, or `override`. */
  reason: string
}

export interface VerbConflict {
  action: RestAction
  candidates: VerbChoice[]
  sentence: string
}

export interface UnmappedOperation {
  key: string
  method: string
  path: string
  reason: string
}

export type MappingOverride =
  | { action: RestAction; method: string; path: string }
  | { action: RestAction; omit: true }

export interface FieldCandidate {
  field: string
  reason: string
}

export interface FieldMappingSuggestion {
  action: RestAction
  inPath: string
  inCustomResource: string
  reason: string
}

export interface OperationMapping {
  verbs: Partial<Record<RestAction, VerbChoice>>
  conflicts: VerbConflict[]
  unmapped: UnmappedOperation[]
  overrideErrors: string[]
  identifierCandidates: FieldCandidate[]
  statusFieldCandidates: FieldCandidate[]
  fieldMappingSuggestions: FieldMappingSuggestion[]
}

const segmentsOf = (path: string): string[] => path.split('/').filter((segment) => segment.length > 0)
const isParam = (segment: string | undefined): boolean => !!segment && /^\{[^}]+\}$/.test(segment)
const pathParamsOf = (path: string): string[] => segmentsOf(path).filter(isParam).map((segment) => segment.slice(1, -1))

type Classification = { action: RestAction; reason: string } | { action: null; reason: string }

/** Classify one operation by its path shape, relative to the other operations selected with it. */
export const classifyOperation = (operation: OasOperation, itemPaths: ReadonlySet<string>): Classification => {
  const segments = segmentsOf(operation.path)
  const last = segments[segments.length - 1]
  const item = isParam(last)
  const parent = `/${segments.slice(0, -1).join('/')}`
  if (!item && segments.length > 1 && itemPaths.has(parent)) {
    return { action: null, reason: `an action on the item ${parent}, not a verb of the Kind` }
  }
  switch (operation.method) {
    case 'POST':
      return item
        ? { action: null, reason: 'POST on an item path is neither a create nor an update by rule — map it with an override' }
        : { action: 'create', reason: 'POST on a collection path' }
    case 'GET':
      if (item) {
        return { action: 'get', reason: 'GET on an item path' }
      }
      return /^findby/i.test(last ?? '')
        ? { action: 'findby', reason: 'GET on a findBy* path' }
        : { action: 'findby', reason: 'GET on a collection path' }
    case 'PUT':
    case 'PATCH':
      return { action: 'update', reason: `${operation.method} on ${item ? 'an item' : 'a collection'} path` }
    case 'DELETE':
      return item
        ? { action: 'delete', reason: 'DELETE on an item path' }
        : { action: null, reason: 'DELETE on a collection path would delete more than one resource' }
    default:
      return { action: null, reason: `${operation.method} is not a RestDefinition method` }
  }
}

// ── schema helpers ──────────────────────────────────────────────────────────

/** The top-level properties of a schema ($ref followed, allOf merged). */
export const schemaProperties = (doc: OasDocument, node: unknown, depth = 0): Record<string, Record<string, unknown>> => {
  const schema = deref(doc, node)
  if (!schema || depth > 16) {
    return {}
  }
  const merged: Record<string, Record<string, unknown>> = {}
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      Object.assign(merged, schemaProperties(doc, part, depth + 1))
    }
  }
  for (const [name, value] of Object.entries(asRecord(schema.properties) ?? {})) {
    merged[name] = deref(doc, value) ?? {}
  }
  return merged
}

/** Does a dotted field path (`metadata.name`) exist in a schema? */
export const schemaHasField = (doc: OasDocument, schema: unknown, dotted: string): boolean => {
  let node: unknown = schema
  for (const segment of dotted.split('.')) {
    const properties = schemaProperties(doc, node)
    if (!(segment in properties)) {
      return false
    }
    node = properties[segment]
  }
  return true
}

/** The JSON schema of a media-type map: application/json first, then any *json, then the first. */
const jsonSchemaOf = (doc: OasDocument, content: unknown): unknown => {
  const media = asRecord(content) ?? {}
  const key = 'application/json' in media ? 'application/json' : Object.keys(media).find((type) => type.includes('json')) ?? Object.keys(media)[0]
  return key ? deref(doc, media[key])?.schema ?? null : null
}

const operationObject = (doc: OasDocument, method: string, path: string): Record<string, unknown> | null =>
  asRecord(deref(doc, asRecord(doc.paths)?.[path])?.[method.toLowerCase()])

/** The schema of an operation's success response (200, else the lowest 2xx). Null when it declares none. */
export const successResponseSchema = (doc: OasDocument, method: string, path: string): unknown => {
  const responses = asRecord(operationObject(doc, method, path)?.responses) ?? {}
  const code = '200' in responses ? '200' : Object.keys(responses).filter((status) => /^2\d\d$/.test(status)).sort()[0]
  return code ? jsonSchemaOf(doc, deref(doc, responses[code])?.content) : null
}

/** The schema of an operation's JSON request body. Null when it has none. */
export const requestBodySchema = (doc: OasDocument, method: string, path: string): unknown =>
  jsonSchemaOf(doc, deref(doc, operationObject(doc, method, path)?.requestBody)?.content)

const isScalar = (schema: Record<string, unknown>): boolean =>
  ['string', 'integer', 'number', 'boolean'].includes(String(schema.type))

/** The response field a renamed path parameter stands for (petId → id, userName → name), or null. */
const standInFor = (param: string, responseFields: readonly string[]): string | null => {
  const match = /^(.+?)(Id|_id|ID|Name|_name)$/.exec(param)
  if (!match) {
    return null
  }
  const field = /name/i.test(match[2]) ? 'name' : 'id'
  return responseFields.includes(field) ? field : null
}

// ── the kernel ──────────────────────────────────────────────────────────────

/**
 * Infer the verbs of ONE Kind from the operations selected for it, then apply the overrides.
 * `operations` is the selection (e.g. one palette group); `doc` is the document they came from.
 */
export const inferOperationMapping = (
  doc: OasDocument,
  operations: readonly OasOperation[],
  overrides: readonly MappingOverride[] = [],
): OperationMapping => {
  const itemPaths = new Set(operations.filter((operation) => isParam(segmentsOf(operation.path).pop())).map((operation) => operation.path))
  const candidates = new Map<RestAction, VerbChoice[]>()
  const unmapped: UnmappedOperation[] = []
  for (const operation of operations) {
    const classification = classifyOperation(operation, itemPaths)
    if (classification.action === null) {
      unmapped.push({ key: operation.key, method: operation.method, path: operation.path, reason: classification.reason })
      continue
    }
    const choice: VerbChoice = {
      action: classification.action,
      method: operation.method,
      operationId: operation.operationId,
      path: operation.path,
      reason: classification.reason,
    }
    candidates.set(choice.action, [...(candidates.get(choice.action) ?? []), choice])
  }

  const overrideErrors: string[] = []
  for (const override of overrides) {
    if ('omit' in override) {
      candidates.delete(override.action)
      continue
    }
    const method = override.method.toUpperCase()
    const operation = operations.find((entry) => entry.method === method && entry.path === override.path)
    if (!operation) {
      overrideErrors.push(`the ${override.action} override names ${method} ${override.path}, which is not one of the selected operations`)
      continue
    }
    candidates.set(override.action, [{
      action: override.action,
      method,
      operationId: operation.operationId,
      path: operation.path,
      reason: 'override',
    }])
  }

  const verbs: Partial<Record<RestAction, VerbChoice>> = {}
  const conflicts: VerbConflict[] = []
  for (const action of VERB_ORDER) {
    const list = candidates.get(action) ?? []
    if (list.length === 1) {
      verbs[action] = list[0]
    } else if (list.length > 1) {
      conflicts.push({
        action,
        candidates: list,
        sentence: `${list.length} operations look like ${action} (${list.map((choice) => `${choice.method} ${choice.path}`).join(', ')}) — choose one.`,
      })
    }
  }

  // Schema-derived candidates, from the resolved get (and create) verbs.
  const { get } = verbs
  const responseProps = get ? schemaProperties(doc, successResponseSchema(doc, get.method, get.path)) : {}
  const responseFields = Object.keys(responseProps)
  const { create } = verbs
  const createFields = new Set(create ? Object.keys(schemaProperties(doc, requestBodySchema(doc, create.method, create.path))) : [])

  const identifierCandidates: FieldCandidate[] = []
  const addIdentifier = (field: string, reason: string): void => {
    if (!identifierCandidates.some((candidate) => candidate.field === field)) {
      identifierCandidates.push({ field, reason })
    }
  }
  if (get) {
    const getParams = pathParamsOf(get.path)
    for (const param of getParams) {
      if (responseFields.includes(param)) {
        addIdentifier(param, `the get path addresses it as {${param}}`)
      }
    }
    for (const param of getParams) {
      const field = responseFields.includes(param) ? null : standInFor(param, responseFields)
      if (field) {
        addIdentifier(field, `the get path's {${param}} stands for it`)
      }
    }
    for (const field of ['id', 'name']) {
      if (responseFields.includes(field)) {
        addIdentifier(field, 'a conventional identifier in the get response')
      }
    }
    for (const field of responseFields) {
      if (isScalar(responseProps[field])) {
        addIdentifier(field, 'a scalar field of the get response')
      }
    }
  }

  const statusFieldCandidates: FieldCandidate[] = responseFields
    .filter((field) => responseProps[field].readOnly === true || (create && !createFields.has(field)))
    .map((field) => ({
      field,
      reason: responseProps[field].readOnly === true ? 'readOnly in the get response' : 'returned by get, never sent by create (the server assigns it)',
    }))

  const fieldMappingSuggestions: FieldMappingSuggestion[] = []
  if (get) {
    for (const action of VERB_ORDER) {
      const verb = verbs[action]
      if (!verb) {
        continue
      }
      for (const param of pathParamsOf(verb.path)) {
        if (responseFields.includes(param)) {
          continue
        }
        const field = standInFor(param, responseFields)
        if (field) {
          const side = createFields.has(field) ? 'spec' : 'status'
          fieldMappingSuggestions.push({
            action,
            inCustomResource: `${side}.${field}`,
            inPath: param,
            reason: `{${param}} is not a field of the get response; ${field} is, and the CR carries it in ${side}`,
          })
        }
      }
    }
  }

  return { conflicts, fieldMappingSuggestions, identifierCandidates, overrideErrors, statusFieldCandidates, unmapped, verbs }
}
