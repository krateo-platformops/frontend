/**
 * T7 — the `inspector: restdef-mapping` kernel: which operation of the imported spec is each verb
 * of one Kind. Pure.
 *
 * INFERENCE, by the shape of the path. The ITEM paths are the selected paths that end in a parameter
 * (`/pet/{petId}`); the COLLECTION paths are their parents (`/pet`). Parameter NAMES do not count when
 * paths are compared — `/db/{databaseName}` and `/db/{name}` are one item path:
 *   POST      the collection path, exactly        → create
 *   GET       the item path                       → get
 *   PUT|PATCH the item path, exactly              → update
 *   DELETE    the item path                       → delete
 *   GET       the collection, or a findBy* or search → findby
 * With no item path selected, a POST / GET on a non-item path is still read as create / findby (an
 * org-scoped create beside a repo-scoped get, as github's are).
 *
 * ACTIONS ARE NEVER VERBS. Any path that goes on past an item path (`/servers/{id}/poweron`,
 * `/users/{id}/password`, `/pet/{petId}/uploadImage`) is an action on that item, whatever its method.
 * A literal segment under the collection (`/user/createWithList`, `/user/login`) is an action on the
 * collection, unless it is a findBy* or search GET. Both are listed as "not a verb: action". A POST on
 * an item is left unmapped with its reason — an override maps one when that is how the API works. A PUT
 * or PATCH on the collection (petstore's `PUT /pet`) is no update by rule either, but when the Kind has
 * no item update and its body carries the id it is OFFERED as one, a conflict the person confirms.
 *
 * NEVER SILENTLY RESOLVED. Two operations that both look like one verb (GET /pet/findByStatus and
 * GET /pet/findByTags) are a CONFLICT, listed with every candidate. The kernel does not pick; an
 * override does. Overrides apply on top of the inference: `{action, method, path}` sets a verb
 * (and settles its conflict), `{action, omit: true}` drops it. The same path parameter named
 * differently across verbs (`{databaseName}` on get, `{name}` on delete) is treated as ONE identifier
 * and flagged for the person to confirm (paramAliases).
 *
 * IDS COME FROM STATUS — the KOG baseline. The id a create returns lands in the CR's status, and every
 * get/update/delete needs it in its path. For the item's own path parameter (the last one of the item
 * path; a parameter the collection path also has is a scope, filled from spec by its name):
 *   - the create RESPONSE is searched for the field it stands for (`{petId}` → `id`, `{keyId}` →
 *     `keyId` or `id`), nested fields included (`metadata.id`), and only ever a scalar LEAF;
 *   - the id is USER-CHOSEN — `spec.<field>` — when the create body REQUIRES that field (or names the
 *     parameter itself); otherwise it is server-assigned and read from `status.<field>`;
 *   - two candidate fields (`keyId` and `id`) are AMBIGUOUS: the first is suggested and the binding
 *     waits for the person to confirm it (FieldMappingSuggestion.alternatives).
 *
 * FROM THE SCHEMAS, once the verbs are known. The STATUS SOURCE is what oasgen builds status from: the
 * get response, or — with no get — one item of the findby response (its envelope unwrapped):
 *   - identifier candidates — the source's scalar fields, the ones the get path addresses first, then
 *     the one a renamed path parameter stands for, then nested id/name-like leaves (`metadata.name`);
 *   - status field candidates — source fields the create body does not send (the server assigned them),
 *     plus any declared readOnly, plus nested id/name-like leaves the create body does not send.
 */
import { asRecord } from '../../components/Autopilot/kogRestDefSchema'
import type { REST_DEF_ACTIONS } from '../../components/Autopilot/kogRestDefSchema'

import { deref, type OasDocument, type OasOperation } from './oasImport'
import { isParam, normalizedPath, parentOf, pathParamsOf, type PathShape, pathShapeOf, segmentsOf, standInName } from './pathShape'

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
  /** `action`: a sub-path of an item or of the collection — never a lifecycle verb. `other`: unmapped by rule. */
  category: 'action' | 'other'
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
  /** The other CR fields this parameter could be bound to — non-empty means the person must confirm. */
  alternatives: string[]
  /** Why the binding waits for a confirm (ambiguous candidates, or a parameter named differently across verbs), or null. */
  confirm: string | null
}

/** One path parameter named differently across the selected operations. */
export interface ParamAlias {
  /** The names, the get's (or the create's) first. */
  names: string[]
  /** `GET /db/{databaseName}` … — where each name is used. */
  operations: string[]
  sentence: string
}

export interface OperationMapping {
  verbs: Partial<Record<RestAction, VerbChoice>>
  conflicts: VerbConflict[]
  unmapped: UnmappedOperation[]
  overrideErrors: string[]
  identifierCandidates: FieldCandidate[]
  statusFieldCandidates: FieldCandidate[]
  fieldMappingSuggestions: FieldMappingSuggestion[]
  paramAliases: ParamAlias[]
  /** Status fields the id bindings read from (`status.metadata.id` → `metadata.id`), which status must carry. */
  boundStatusFields: string[]
}

type Classification =
  | { action: RestAction; reason: string }
  | { action: null; reason: string; category: UnmappedOperation['category'] }

const SEARCH_SEGMENT = /^(findby|search)/i

/** Classify one operation by its path shape, relative to the other operations selected with it. */
export const classifyOperation = (operation: { method: string; path: string }, shape: PathShape): Classification => {
  const segments = segmentsOf(operation.path)
  const last = segments[segments.length - 1]
  const item = isParam(last)
  const normalized = normalizedPath(operation.path)
  const parent = parentOf(normalized)
  const action = (reason: string): Classification => ({ action: null, category: 'action', reason })
  const other = (reason: string): Classification => ({ action: null, category: 'other', reason })

  // Anything past an item path is an action on that item — poweron, password, uploadImage, name.
  const owner = [...shape.items.keys()].find((path) => normalized !== path && normalized.startsWith(`${path}/`))
  if (owner) {
    return action(`an action on the item ${shape.items.get(owner) ?? owner}, not a lifecycle verb`)
  }
  const isCollection = shape.collections.has(normalized)
  const underCollection = !item && !isCollection && shape.collections.has(parent)
  const collection = shape.collections.get(parent) ?? parent
  switch (operation.method.toUpperCase()) {
    case 'POST':
      if (item) {
        return other('POST on an item path is neither a create nor an update by rule — map it with an override')
      }
      if (underCollection) {
        return action(`a sub-path of the collection ${collection}, not the collection itself — an action, never a create`)
      }
      return { action: 'create', reason: isCollection ? 'POST on the collection path' : 'POST on a collection path' }
    case 'GET':
      if (item) {
        return { action: 'get', reason: 'GET on the item path' }
      }
      if (SEARCH_SEGMENT.test(last ?? '')) {
        return { action: 'findby', reason: 'GET on a findBy* path' }
      }
      if (underCollection) {
        return action(`under the collection ${collection}, neither the collection nor a findBy* search — an action`)
      }
      return { action: 'findby', reason: isCollection ? 'GET on the collection path' : 'GET on a collection path' }
    case 'PUT':
    case 'PATCH':
      return item
        ? { action: 'update', reason: `${operation.method.toUpperCase()} on the item path` }
        : other(`${operation.method.toUpperCase()} on a collection path is not an update by rule (an update addresses one item, collection/{id}) — map it with an override if this API updates that way`)
    case 'DELETE':
      return item
        ? { action: 'delete', reason: 'DELETE on the item path' }
        : other('DELETE on a collection path would delete more than one resource')
    default:
      return other(`${operation.method} is not a RestDefinition method`)
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

/** The `required` names of a schema ($ref followed, allOf merged). */
const schemaRequired = (doc: OasDocument, node: unknown, depth = 0): string[] => {
  const schema = deref(doc, node)
  if (!schema || depth > 16) { return [] }
  const own = Array.isArray(schema.required) ? schema.required.filter((entry): entry is string => typeof entry === 'string') : []
  const parts = Array.isArray(schema.allOf) ? schema.allOf.flatMap((part) => schemaRequired(doc, part, depth + 1)) : []
  return [...own, ...parts]
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

/** Is a dotted field REQUIRED at every level of the schema (what a user must send)? */
const schemaRequiresField = (doc: OasDocument, schema: unknown, dotted: string): boolean => {
  let node: unknown = schema
  for (const segment of dotted.split('.')) {
    if (!schemaRequired(doc, node).includes(segment)) { return false }
    node = schemaProperties(doc, node)[segment]
  }
  return true
}

const isScalar = (schema: Record<string, unknown>): boolean =>
  ['string', 'integer', 'number', 'boolean'].includes(String(schema.type))

const isArraySchema = (schema: Record<string, unknown>): boolean => schema.type === 'array' || schema.items !== undefined

/** How deep the pickers walk a response for nested fields (`a.b.c`), and how many nested fields they list. */
export const NESTED_FIELD_DEPTH = 3
const NESTED_FIELD_CAP = 40

/** Every scalar LEAF of a schema, top-level first, as dotted paths — objects are walked, arrays are not. */
export const scalarLeaves = (doc: OasDocument, schema: unknown, maxDepth = NESTED_FIELD_DEPTH): { path: string; schema: Record<string, unknown> }[] => {
  const found: { path: string; schema: Record<string, unknown> }[] = []
  let level: { prefix: string; node: unknown }[] = [{ node: schema, prefix: '' }]
  for (let depth = 1; depth <= maxDepth && level.length; depth++) {
    const next: { prefix: string; node: unknown }[] = []
    for (const { node, prefix } of level) {
      for (const [name, property] of Object.entries(schemaProperties(doc, node))) {
        const path = prefix ? `${prefix}.${name}` : name
        if (isScalar(property)) {
          found.push({ path, schema: property })
        } else if (!isArraySchema(property) && Object.keys(schemaProperties(doc, property)).length) {
          next.push({ node: property, prefix: path })
        }
      }
    }
    level = next
  }
  return found
}

/** A field name that reads as an identifier: id, name, uuid, key, slug, username, or *Id / *Name / *Key. */
const ID_LIKE = /^(id|name|uid|uuid|key|slug|username|login)$|(Id|ID|_id|Name|_name|Key)$/
const leafOf = (dotted: string): string => dotted.split('.').pop() ?? dotted

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

/** The array properties of an object schema — a findby ENVELOPE's candidate collections, sorted. */
export const envelopeArrays = (doc: OasDocument, schema: unknown): string[] => {
  const resolved = deref(doc, schema)
  if (!resolved || isArraySchema(resolved)) { return [] }
  return Object.entries(schemaProperties(doc, resolved)).filter(([, property]) => isArraySchema(property)).map(([name]) => name)
    .sort()
}

/** `.values` / `values` / `data.items` → its segments. */
const itemsPathSegments = (itemsPath: string): string[] => itemsPath.replace(/^\./, '').split('.').filter(Boolean)

export type FindbyItem =
  | { ok: true; schema: unknown; via: 'array' | 'itemsPath' | 'envelope' | 'object' }
  | { ok: false; reason: string; candidates: string[] }

/**
 * One ITEM of a findby response, the way oasgen finds it (envelope.go unwrapFindByItems): a bare array's
 * items; the declared itemsPath's items; the envelope's one array property's items; the object itself
 * when it has no array. Two or more arrays and no itemsPath is a refusal — oasgen never guesses.
 */
export const findbyItemSchema = (doc: OasDocument, response: unknown, itemsPath?: string | null): FindbyItem => {
  const schema = deref(doc, response)
  if (!schema) { return { candidates: [], ok: false, reason: 'the findby declares no JSON success response' } }
  if (isArraySchema(schema)) { return { ok: true, schema: schema.items, via: 'array' } }
  if (itemsPath) {
    let node: unknown = schema
    for (const segment of itemsPathSegments(itemsPath)) {
      const properties = schemaProperties(doc, node)
      if (!(segment in properties)) {
        return { candidates: envelopeArrays(doc, schema), ok: false, reason: `itemsPath ${itemsPath} names ${segment}, which is not a property of the findby response` }
      }
      node = properties[segment]
    }
    const resolved = deref(doc, node)
    return resolved && isArraySchema(resolved)
      ? { ok: true, schema: resolved.items, via: 'itemsPath' }
      : { candidates: envelopeArrays(doc, schema), ok: false, reason: `itemsPath ${itemsPath} does not name an array of the findby response` }
  }
  const arrays = envelopeArrays(doc, schema)
  if (arrays.length === 0) { return { ok: true, schema, via: 'object' } }
  if (arrays.length === 1) { return { ok: true, schema: deref(doc, schemaProperties(doc, schema)[arrays[0]])?.items, via: 'envelope' } }
  return { candidates: arrays, ok: false, reason: `the findby response is an envelope with ${arrays.length} array properties (${arrays.join(', ')}), and oasgen refuses to guess which holds the collection — set itemsPath` }
}

const standInFor = (param: string, responseFields: readonly string[]): string | null => {
  const field = standInName(param)
  return field && responseFields.includes(field) ? field : null
}

/** Of several dotted paths, only those at the shallowest depth any of them sits at (`id` over `category.id`). */
const shallowest = (paths: readonly string[]): string[] => {
  const depth = Math.min(...paths.map((path) => path.split('.').length))
  return paths.filter((path) => path.split('.').length === depth)
}

/**
 * The scalar LEAVES of `schema` a path parameter could stand for: fields named as the parameter, then
 * fields named as its stand-in (`{petId}` → `id`) — each kind at the shallowest depth it occurs, so a
 * related object's id (`category.id`) never competes with the resource's own (`id`).
 */
const idCandidates = (doc: OasDocument, schema: unknown, param: string): string[] => {
  if (!schema) { return [] }
  const leaves = scalarLeaves(doc, schema).map((leaf) => leaf.path)
  const stand = standInName(param)
  const exact = leaves.filter((path) => leafOf(path) === param)
  const standing = stand && stand !== param ? leaves.filter((path) => leafOf(path) === stand) : []
  return [...(exact.length ? shallowest(exact) : []), ...(standing.length ? shallowest(standing) : [])]
}

// ── the kernel ──────────────────────────────────────────────────────────────

/** The schema oasgen builds a Kind's status from: the get response, else one findby item. */
export const statusSourceSchema = (
  doc: OasDocument,
  verbs: Partial<Record<RestAction, { method: string; path: string; itemsPath?: string | null }>>,
): { schema: unknown; from: 'get' | 'findby' } | null => {
  if (verbs.get) {
    const schema = successResponseSchema(doc, verbs.get.method, verbs.get.path)
    return schema ? { from: 'get', schema } : null
  }
  if (verbs.findby) {
    const item = findbyItemSchema(doc, successResponseSchema(doc, verbs.findby.method, verbs.findby.path), verbs.findby.itemsPath)
    return item.ok && item.schema ? { from: 'findby', schema: item.schema } : null
  }
  return null
}

/** Each path parameter named differently at the same place across the operations — one identifier, to confirm. */
const paramAliasesOf = (operations: readonly { method: string; path: string }[]): ParamAlias[] => {
  const byPlace = new Map<string, Map<string, string[]>>()
  for (const operation of operations) {
    const segments = segmentsOf(operation.path)
    segments.forEach((segment, index) => {
      if (!isParam(segment)) { return }
      const place = normalizedPath(`/${segments.slice(0, index + 1).join('/')}`)
      const names = byPlace.get(place) ?? new Map<string, string[]>()
      const name = segment.slice(1, -1)
      names.set(name, [...(names.get(name) ?? []), `${operation.method.toUpperCase()} ${operation.path}`])
      byPlace.set(place, names)
    })
  }
  return [...byPlace.values()].filter((names) => names.size > 1).map((names) => {
    const list = [...names.keys()]
    return {
      names: list,
      operations: [...names.values()].flat(),
      sentence: `{${list.join('}, {')}} name the same path segment in different operations — treated as one identifier; confirm the binding.`,
    }
  })
}

/**
 * A PUT/PATCH on a COLLECTION path whose JSON body carries the item's id (the item path's last
 * parameter, by its own name or the field it stands for: `{petId}` → `id`) — an update that addresses
 * the item through its body. Null when there is no such operation.
 */
const collectionUpdateCandidate = (
  doc: OasDocument,
  operations: readonly OasOperation[],
  shape: PathShape,
): { choice: VerbChoice; sentence: string } | null => {
  for (const operation of operations) {
    const method = operation.method.toUpperCase()
    const normalized = normalizedPath(operation.path)
    if ((method !== 'PUT' && method !== 'PATCH') || !shape.collections.has(normalized)) { continue }
    const item = [...shape.items.values()].find((path) => parentOf(normalizedPath(path)) === normalized)
    const param = item ? pathParamsOf(item).pop() : undefined
    const body = Object.keys(schemaProperties(doc, requestBodySchema(doc, method, operation.path)))
    const field = param ? [param, standInName(param)].find((name): name is string => !!name && body.includes(name)) : undefined
    if (field) {
      return {
        choice: { action: 'update', method, operationId: operation.operationId, path: operation.path, reason: `${method} on the collection, the id (${field}) in its body — confirm` },
        sentence: `${method} ${operation.path} may be the update — a ${method} on the collection whose body carries the id (${field}), not on the item, so it needs a confirm — choose one.`,
      }
    }
  }
  return null
}

/**
 * Infer the verbs of ONE Kind from the operations selected for it, then apply the overrides.
 * `operations` is the selection (e.g. one palette group); `doc` is the document they came from.
 * `itemsPath` is the findby's held itemsPath, when the status source is a findby envelope.
 */
export const inferOperationMapping = (
  doc: OasDocument,
  operations: readonly OasOperation[],
  overrides: readonly MappingOverride[] = [],
  itemsPath: string | null = null,
): OperationMapping => {
  const shape = pathShapeOf(operations)
  const candidates = new Map<RestAction, VerbChoice[]>()
  const unmapped: UnmappedOperation[] = []
  for (const operation of operations) {
    const classification = classifyOperation(operation, shape)
    if (classification.action === null) {
      unmapped.push({ category: classification.category, key: operation.key, method: operation.method, path: operation.path, reason: classification.reason })
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

  // NO UPDATE ON THE ITEM, ONE ON THE COLLECTION: petstore's PUT /pet sends the whole Pet, id included.
  // It is not inferred — an update by rule addresses the item — but it is OFFERED, as a one-candidate
  // conflict the person confirms (or leaves out), never placed silently.
  const confirmUpdate = !candidates.has('update') && !overrides.some((override) => override.action === 'update')
    ? collectionUpdateCandidate(doc, operations, shape)
    : null
  if (confirmUpdate) {
    const index = unmapped.findIndex((entry) => entry.method === confirmUpdate.choice.method && entry.path === confirmUpdate.choice.path)
    if (index >= 0) { unmapped.splice(index, 1) }
  }

  const verbs: Partial<Record<RestAction, VerbChoice>> = {}
  const conflicts: VerbConflict[] = []
  for (const action of VERB_ORDER) {
    if (action === 'update' && confirmUpdate) {
      conflicts.push({ action, candidates: [confirmUpdate.choice], sentence: confirmUpdate.sentence })
      continue
    }
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

  // Schema-derived candidates, from the status source (get, else a findby item) and the create verb.
  const source = statusSourceSchema(doc, { ...verbs, ...(verbs.findby ? { findby: { ...verbs.findby, itemsPath } } : {}) })
  const sourceName = source?.from === 'findby' ? 'findby item' : 'get response'
  const responseProps = source ? schemaProperties(doc, source.schema) : {}
  const responseFields = Object.keys(responseProps)
  const { create, get } = verbs
  const createBody = create ? requestBodySchema(doc, create.method, create.path) : null
  const createResponse = create ? successResponseSchema(doc, create.method, create.path) : null
  const createFields = new Set(Object.keys(schemaProperties(doc, createBody)))
  const sentByCreate = (dotted: string): boolean => !!createBody && schemaHasField(doc, createBody, dotted)
  // Nested leaves (`metadata.name`): the id/name-like ones are identifier candidates; those and any
  // declared readOnly are status candidates when the create body does not send them.
  const allNested = source ? scalarLeaves(doc, source.schema).filter((leaf) => leaf.path.includes('.')) : []
  const nestedLeaves = allNested.filter((leaf) => ID_LIKE.test(leafOf(leaf.path))).slice(0, NESTED_FIELD_CAP)
  const nestedStatus = allNested.filter((leaf) => ID_LIKE.test(leafOf(leaf.path)) || leaf.schema.readOnly === true).slice(0, NESTED_FIELD_CAP)

  const identifierCandidates: FieldCandidate[] = []
  const addIdentifier = (field: string, reason: string): void => {
    if (!identifierCandidates.some((candidate) => candidate.field === field)) {
      identifierCandidates.push({ field, reason })
    }
  }
  if (source) {
    const addressing = get ? pathParamsOf(get.path) : []
    for (const param of addressing) {
      if (responseFields.includes(param)) {
        addIdentifier(param, `the get path addresses it as {${param}}`)
      }
    }
    for (const param of addressing) {
      const field = responseFields.includes(param) ? null : standInFor(param, responseFields)
      if (field) {
        addIdentifier(field, `the get path's {${param}} stands for it`)
      }
    }
    for (const field of ['id', 'name']) {
      if (responseFields.includes(field)) {
        addIdentifier(field, `a conventional identifier in the ${sourceName}`)
      }
    }
    for (const field of responseFields) {
      if (isScalar(responseProps[field])) {
        addIdentifier(field, `a scalar field of the ${sourceName}`)
      }
    }
    for (const leaf of nestedLeaves) {
      addIdentifier(leaf.path, `nested in the ${sourceName}`)
    }
  }

  const statusFieldCandidates: FieldCandidate[] = [
    ...responseFields
      .filter((field) => responseProps[field].readOnly === true || (create && !createFields.has(field)))
      .map((field) => ({
        field,
        reason: responseProps[field].readOnly === true ? `readOnly in the ${sourceName}` : `returned by ${source?.from ?? 'get'}, never sent by create (the server assigns it)`,
      })),
    ...nestedStatus
      .filter((leaf) => leaf.schema.readOnly === true || (create && !sentByCreate(leaf.path)))
      .map((leaf) => ({
        field: leaf.path,
        reason: leaf.schema.readOnly === true ? `readOnly, nested in the ${sourceName}` : `nested in the ${sourceName}, never sent by create`,
      })),
  ]

  // ── the item's id: where each get/update/delete reads its path parameter from ──
  const paramAliases = paramAliasesOf(VERB_ORDER.flatMap((action) => (verbs[action] ? [verbs[action]] : [])))
  const scopeParams = new Set(create ? pathParamsOf(create.path) : [])
  const aliasOf = (param: string): ParamAlias | undefined => paramAliases.find((alias) => alias.names.includes(param))
  const bindings = new Map<string, { field: string; reason: string; alternatives: string[]; confirm: string | null } | null>()
  const bindingOf = (param: string): { field: string; reason: string; alternatives: string[]; confirm: string | null } | null => {
    if (bindings.has(param)) { return bindings.get(param) ?? null }
    const alias = aliasOf(param)
    // An alias binds to what its first name binds to, or — when that one needs no mapping — to the first name itself.
    if (alias && alias.names[0] !== param) {
      const [first] = alias.names
      // A scope parameter (one the create path shares) is filled from spec by its name, never searched for.
      const head = scopeParams.has(first) ? null : bindingOf(first)
      const headInSpec = createFields.has(first) || scopeParams.has(first) || !responseFields.includes(first)
      const field = head?.field ?? `${headInSpec ? 'spec' : 'status'}.${first}`
      const result = { alternatives: head?.alternatives ?? [], confirm: alias.sentence, field, reason: `{${param}} names the same segment as {${first}}` }
      bindings.set(param, result)
      return result
    }
    let result: { field: string; reason: string; alternatives: string[]; confirm: string | null } | null = null
    if (createFields.has(param)) {
      // The create body names the parameter itself: the person chooses it, and spec carries it by name.
      result = null
    } else {
      const fromCreate = idCandidates(doc, createResponse, param)
      const found = fromCreate.length ? fromCreate : idCandidates(doc, source?.schema ?? null, param)
      const direct = !fromCreate.length && found.length === 1 && found[0] === param && responseFields.includes(param)
      if (found.length && !direct) {
        const [first, ...rest] = found
        const userChosen = !!createBody && schemaRequiresField(doc, createBody, first)
        let side: 'spec' | 'status' = 'status'
        let reason = `the get response returns ${first}; the create body never sends it, so it is read from status`
        if (userChosen) {
          side = 'spec'
          reason = `the create body requires ${first}: the person chooses the id, so it is read from spec`
        } else if (fromCreate.length) {
          reason = `the create response returns ${first} — the server assigns the id, so it is read from status`
        } else if (sentByCreate(first)) {
          side = 'spec'
          reason = `${first} is sent by create, and create returns no id to read from status`
        }
        const ambiguous = rest.length
          ? `{${param}} could be ${found.join(' or ')} — ${first} is suggested; confirm it or choose another.`
          : null
        result = { alternatives: rest.map((field) => `${side}.${field}`), confirm: ambiguous ?? aliasOf(param)?.sentence ?? null, field: `${side}.${first}`, reason }
      }
    }
    bindings.set(param, result)
    return result
  }

  const fieldMappingSuggestions: FieldMappingSuggestion[] = []
  for (const action of VERB_ORDER) {
    const verb = verbs[action]
    if (!verb || action === 'create') {
      continue
    }
    const params = pathParamsOf(verb.path)
    const itemParam = isParam(segmentsOf(verb.path).pop()) ? params[params.length - 1] : undefined
    for (const param of params) {
      const alias = aliasOf(param)
      // Only the item's own parameter is an id; a scope parameter the create path shares fills from spec by name.
      const isItem = param === itemParam && !scopeParams.has(param)
      if (!isItem && !(alias && alias.names[0] !== param)) {
        continue
      }
      const binding = bindingOf(param)
      if (binding) {
        fieldMappingSuggestions.push({ action, alternatives: binding.alternatives, confirm: binding.confirm, inCustomResource: binding.field, inPath: param, reason: binding.reason })
      }
    }
  }
  const boundStatusFields = [...new Set(fieldMappingSuggestions
    .map((suggestion) => suggestion.inCustomResource)
    .filter((field) => field.startsWith('status.'))
    .map((field) => field.slice('status.'.length)))]

  return { boundStatusFields, conflicts, fieldMappingSuggestions, identifierCandidates, overrideErrors, paramAliases, statusFieldCandidates, unmapped, verbs }
}
