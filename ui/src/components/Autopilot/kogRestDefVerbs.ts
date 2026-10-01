/**
 * T11b — the per-verb and resource-level validators for the oasgen-provider RestDefinition
 * fields (fieldMapping, request/responseTransform, notFoundBody, async, pagination — 0.25's
 * pageNumber included — itemsPath, a verb's oasPath, headers/queries, the status-code lists,
 * compareScope and the observe/create/update/deleteApiRef delegations), composed by
 * kogMapping's validateRestDefinitionDraft; and the WARNINGS a valid RestDefinition still earns
 * (restDefinitionWarnings). Pure: no React, no network.
 */

import {
  asRecord,
  enumErrors,
  integerListErrors,
  isNonEmptyString,
  jqProgramErrors,
  KNOWN_KEYS,
  nameValueListErrors,
  optionalIntegerErrors,
  optionalStringErrors,
  REST_DEF_ACTIONS,
  REST_DEF_API_REFS,
  REST_DEF_ASYNC_MODES,
  REST_DEF_COMPARE_SCOPES,
  REST_DEF_METHODS,
  REST_DEF_PAGINATION_TYPES,
  REST_DEF_VALUE_MAPPING_TYPES,
  parseOasPath,
  requiredStringErrors,
  stringListErrors,
  unknownFieldErrors,
} from './kogRestDefSchema'

/** The verbs async may be set on (the provider's documented contract: mutating verbs only). */
const ASYNC_ACTIONS: readonly string[] = ['create', 'update', 'delete']
/** The path parameter the async handle binds to when poll.handleParam is unset (oasgen's default). */
const DEFAULT_HANDLE_PARAM = 'operationId'

/** The deprecated request-only requestFieldMapping[]: inCustomResource + exactly one of inPath|inQuery|inBody. */
const requestFieldMappingErrors = (value: unknown, at: string): string[] => {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    return [`${at}: requestFieldMapping must be an array`]
  }
  const errors: string[] = []
  value.forEach((mapping: unknown, mappingIndex: number) => {
    const mappingAt = `${at}.requestFieldMapping[${mappingIndex}]`
    const record = asRecord(mapping)
    if (!record) {
      errors.push(`${mappingAt}: must be an object`)
      return
    }
    errors.push(...unknownFieldErrors(record, KNOWN_KEYS.requestFieldMapping, mappingAt))
    const sources = ['inPath', 'inQuery', 'inBody'].filter((key) => record[key] !== undefined)
    if (sources.length !== 1) {
      errors.push(`${mappingAt}: exactly one of inPath|inQuery|inBody must be set (got ${sources.length})`)
    }
    if (!isNonEmptyString(record.inCustomResource)) {
      errors.push(`${mappingAt}: inCustomResource is required (e.g. spec.<field>)`)
    }
  })
  return errors
}

/** valueMapping{type alias|jq}: aliases[]{customResourceValue, apiValue} when alias, a jq program when jq. */
const valueMappingErrors = (value: unknown, at: string): string[] => {
  if (value === undefined) {
    return []
  }
  const mapping = asRecord(value)
  if (!mapping) {
    return [`${at}: must be an object ({type, aliases|jq})`]
  }
  const errors = [
    ...unknownFieldErrors(mapping, KNOWN_KEYS.valueMapping, at),
    ...enumErrors(mapping.type, REST_DEF_VALUE_MAPPING_TYPES, `${at}.type`, true),
  ]
  if (mapping.type === 'alias' && mapping.aliases === undefined) {
    errors.push(`${at}: aliases must be set when type is alias`)
  }
  if (mapping.type === 'jq' && mapping.jq === undefined) {
    errors.push(`${at}: jq must be set when type is jq`)
  }
  if (mapping.aliases !== undefined) {
    if (!Array.isArray(mapping.aliases)) {
      errors.push(`${at}.aliases must be an array`)
    } else {
      mapping.aliases.forEach((entry: unknown, index: number) => {
        const aliasAt = `${at}.aliases[${index}]`
        const alias = asRecord(entry)
        if (!alias) {
          errors.push(`${aliasAt}: must be an object ({customResourceValue, apiValue})`)
          return
        }
        errors.push(
          ...unknownFieldErrors(alias, KNOWN_KEYS.valueAlias, aliasAt),
          ...requiredStringErrors(alias, 'customResourceValue', aliasAt),
          ...requiredStringErrors(alias, 'apiValue', aliasAt),
        )
      })
    }
  }
  errors.push(...jqProgramErrors(mapping.jq, `${at}.jq`))
  return errors
}

/** resolver{type secretRef, secretRef{nameFromCustomResource, keyFromCustomResource}}. */
const resolverErrors = (value: unknown, at: string): string[] => {
  if (value === undefined) {
    return []
  }
  const resolver = asRecord(value)
  if (!resolver) {
    return [`${at}: must be an object ({type, secretRef})`]
  }
  const errors = [
    ...unknownFieldErrors(resolver, KNOWN_KEYS.resolver, at),
    ...enumErrors(resolver.type, ['secretRef'], `${at}.type`, true),
  ]
  if (resolver.type === 'secretRef' && resolver.secretRef === undefined) {
    errors.push(`${at}: secretRef must be set when type is secretRef`)
  }
  if (resolver.secretRef !== undefined) {
    const secretRef = asRecord(resolver.secretRef)
    const secretAt = `${at}.secretRef`
    if (!secretRef) {
      errors.push(`${secretAt}: must be an object ({nameFromCustomResource, keyFromCustomResource})`)
    } else {
      errors.push(
        ...unknownFieldErrors(secretRef, KNOWN_KEYS.secretRef, secretAt),
        ...requiredStringErrors(secretRef, 'nameFromCustomResource', secretAt),
        ...requiredStringErrors(secretRef, 'keyFromCustomResource', secretAt),
      )
    }
  }
  return errors
}

/**
 * fieldMapping[] (supersedes requestFieldMapping): EXACTLY ONE of inPath|inQuery|inBody|
 * inResponse (the anchor sets the direction), resolver only on a request-direction entry.
 */
const fieldMappingErrors = (value: unknown, at: string): string[] => {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    return [`${at}: fieldMapping must be an array`]
  }
  const errors: string[] = []
  value.forEach((mapping: unknown, mappingIndex: number) => {
    const mappingAt = `${at}.fieldMapping[${mappingIndex}]`
    const record = asRecord(mapping)
    if (!record) {
      errors.push(`${mappingAt}: must be an object`)
      return
    }
    errors.push(...unknownFieldErrors(record, KNOWN_KEYS.fieldMapping, mappingAt))
    const anchors = ['inPath', 'inQuery', 'inBody', 'inResponse'].filter((key) => record[key] !== undefined)
    if (anchors.length !== 1) {
      errors.push(`${mappingAt}: exactly one of inPath|inQuery|inBody|inResponse must be set (got ${anchors.length})`)
    }
    if (record.resolver !== undefined && record.inResponse !== undefined) {
      errors.push(`${mappingAt}: resolver is only valid on a request-direction entry (inPath|inQuery|inBody)`)
    }
    for (const field of ['inPath', 'inQuery', 'inBody', 'inResponse', 'inCustomResource']) {
      errors.push(...optionalStringErrors(record, field, mappingAt))
    }
    errors.push(
      ...valueMappingErrors(record.valueMapping, `${mappingAt}.valueMapping`),
      ...resolverErrors(record.resolver, `${mappingAt}.resolver`),
    )
  })
  return errors
}

/** One {tokenIn, tokenPath} side of continuationToken pagination (request: query; response: header|body since 0.25). */
const tokenLocationErrors = (value: unknown, tokenIn: readonly string[], at: string): string[] => {
  const location = asRecord(value)
  if (!location) {
    return [`${at} is required ({tokenIn, tokenPath})`]
  }
  return [
    ...unknownFieldErrors(location, KNOWN_KEYS.tokenLocation, at),
    ...enumErrors(location.tokenIn, tokenIn, `${at}.tokenIn`, true),
    ...requiredStringErrors(location, 'tokenPath', at),
  ]
}

/** An optional integer with bounds (the CRD's minimum / maximum). */
const boundedIntegerErrors = (record: Record<string, unknown>, field: string, at: string, minimum: number, maximum?: number): string[] => {
  const value = record[field]
  if (value === undefined) { return [] }
  if (typeof value !== 'number' || !Number.isInteger(value)) { return [`${at}.${field} must be an integer`] }
  if (value < minimum || (maximum !== undefined && value > maximum)) {
    return [`${at}.${field} must be ${maximum === undefined ? `at least ${minimum}` : `between ${minimum} and ${maximum}`}`]
  }
  return []
}

/** pageNumber.response: header{name, matches} or body{totalPagesPath xor totalItemsPath} — never both. */
const pageNumberResponseErrors = (value: unknown, request: Record<string, unknown> | null, at: string, requestAt: string): string[] => {
  const response = asRecord(value)
  if (!response) {
    return [`${at}: must be an object ({header} or {body})`]
  }
  const errors = [...unknownFieldErrors(response, KNOWN_KEYS.pageNumberResponse, at)]
  if (response.header !== undefined && response.body !== undefined) {
    errors.push(`${at}: declare at most one of header or body — two ways to recognise the last page cannot both be authoritative`)
  }
  if (response.header !== undefined) {
    const header = asRecord(response.header)
    errors.push(...(header
      ? [...unknownFieldErrors(header, KNOWN_KEYS.pageNumberHeader, `${at}.header`), ...requiredStringErrors(header, 'name', `${at}.header`), ...requiredStringErrors(header, 'matches', `${at}.header`)]
      : [`${at}.header: must be an object ({name, matches})`]))
  }
  if (response.body !== undefined) {
    const body = asRecord(response.body)
    if (!body) {
      errors.push(`${at}.body: must be an object ({totalPagesPath} or {totalItemsPath})`)
      return errors
    }
    errors.push(
      ...unknownFieldErrors(body, KNOWN_KEYS.pageNumberBody, `${at}.body`),
      ...optionalStringErrors(body, 'totalPagesPath', `${at}.body`),
      ...optionalStringErrors(body, 'totalItemsPath', `${at}.body`),
    )
    if ((body.totalPagesPath !== undefined) === (body.totalItemsPath !== undefined)) {
      errors.push(`${at}.body: declare exactly one of totalPagesPath or totalItemsPath`)
    }
    if (body.totalItemsPath !== undefined && request && request.pageSize === undefined) {
      errors.push(`${at}.body.totalItemsPath needs ${requestAt}.pageSize — the number of pages is derived from items per page`)
    }
  }
  return errors
}

/**
 * pageNumber{maxPages 1..1000, request{pageIn query, pagePath, startPage ≥0, pageSize ≥1, sizeIn query,
 * sizePath}, response{header | body}} — the 0.25 CRD, CEL included. totalItemsPath without
 * request.pageSize is refused too: the controller fails that walk at runtime (page_number.go).
 */
const pageNumberErrors = (value: unknown, at: string): string[] => {
  const pageNumber = asRecord(value)
  if (!pageNumber) {
    return [`${at}: must be an object ({maxPages, request, response})`]
  }
  const errors = [...unknownFieldErrors(pageNumber, KNOWN_KEYS.pageNumber, at)]
  errors.push(...(pageNumber.maxPages === undefined
    ? [`${at}.maxPages is required (1–1000) — the author states how far a search may walk`]
    : boundedIntegerErrors(pageNumber, 'maxPages', at, 1, 1000)))
  const request = asRecord(pageNumber.request)
  const requestAt = `${at}.request`
  if (!request) {
    errors.push(`${requestAt} is required ({pageIn, pagePath, startPage})`)
  } else {
    errors.push(
      ...unknownFieldErrors(request, KNOWN_KEYS.pageNumberRequest, requestAt),
      ...enumErrors(request.pageIn, ['query'], `${requestAt}.pageIn`, true),
      ...requiredStringErrors(request, 'pagePath', requestAt),
      ...(request.startPage === undefined ? [`${requestAt}.startPage is required (1 for most APIs, 0 for 0-based ones)`] : boundedIntegerErrors(request, 'startPage', requestAt, 0)),
      ...boundedIntegerErrors(request, 'pageSize', requestAt, 1),
      ...enumErrors(request.sizeIn, ['query'], `${requestAt}.sizeIn`),
      ...optionalStringErrors(request, 'sizePath', requestAt),
    )
  }
  if (pageNumber.response !== undefined) {
    errors.push(...pageNumberResponseErrors(pageNumber.response, request, `${at}.response`, requestAt))
  }
  return errors
}

/** The one block a pagination type names, and not the other (the CRD's four CEL rules). */
const paginationBlockErrors = (pagination: Record<string, unknown>, at: string): string[] => {
  const errors: string[] = []
  if (pagination.type === 'continuationToken') {
    if (pagination.continuationToken === undefined) { errors.push(`${at}: continuationToken must be set when type is continuationToken`) }
    if (pagination.pageNumber !== undefined) { errors.push(`${at}: pageNumber must not be set when type is continuationToken`) }
  }
  if (pagination.type === 'pageNumber') {
    if (pagination.pageNumber === undefined) { errors.push(`${at}: pageNumber must be set when type is pageNumber`) }
    if (pagination.continuationToken !== undefined) { errors.push(`${at}: continuationToken must not be set when type is pageNumber`) }
  }
  return errors
}

/** pagination{type continuationToken|pageNumber, and the block its type names} (the findby-only rule is the caller's). */
const paginationErrors = (value: unknown, at: string): string[] => {
  if (value === undefined) {
    return []
  }
  const pagination = asRecord(value)
  if (!pagination) {
    return [`${at}: must be an object ({type, continuationToken|pageNumber})`]
  }
  const errors = [
    ...unknownFieldErrors(pagination, KNOWN_KEYS.pagination, at),
    ...enumErrors(pagination.type, REST_DEF_PAGINATION_TYPES, `${at}.type`, true),
    ...paginationBlockErrors(pagination, at),
  ]
  if (pagination.continuationToken !== undefined) {
    const token = asRecord(pagination.continuationToken)
    const tokenAt = `${at}.continuationToken`
    if (!token) {
      errors.push(`${tokenAt}: must be an object ({request, response})`)
    } else {
      errors.push(
        ...unknownFieldErrors(token, KNOWN_KEYS.continuationToken, tokenAt),
        ...tokenLocationErrors(token.request, ['query'], `${tokenAt}.request`),
        ...tokenLocationErrors(token.response, ['header', 'body'], `${tokenAt}.response`),
      )
    }
  }
  if (pagination.pageNumber !== undefined) {
    errors.push(...pageNumberErrors(pagination.pageNumber, `${at}.pageNumber`))
  }
  return errors
}

/**
 * async{mode, operationRef{in, path, jq}, poll{path, statusPath, successValues ≥1, …}, postGet}.
 * poll.path must carry the {handleParam} token (default {operationId}) — oasgen fails the
 * RestDefinition at processing time otherwise, so it is caught here before publish.
 */
const asyncErrors = (value: unknown, at: string): string[] => {
  if (value === undefined) {
    return []
  }
  const config = asRecord(value)
  if (!config) {
    return [`${at}: must be an object ({operationRef, poll})`]
  }
  const errors = [
    ...unknownFieldErrors(config, KNOWN_KEYS.async, at),
    ...enumErrors(config.mode, REST_DEF_ASYNC_MODES, `${at}.mode`),
  ]
  if (config.postGet !== undefined && typeof config.postGet !== 'boolean') {
    errors.push(`${at}.postGet must be a boolean`)
  }
  const operationRef = asRecord(config.operationRef)
  const operationAt = `${at}.operationRef`
  if (!operationRef) {
    errors.push(`${operationAt} is required ({in, path})`)
  } else {
    errors.push(
      ...unknownFieldErrors(operationRef, KNOWN_KEYS.operationRef, operationAt),
      ...enumErrors(operationRef.in, ['body', 'header'], `${operationAt}.in`, true),
      ...requiredStringErrors(operationRef, 'path', operationAt),
      ...jqProgramErrors(operationRef.jq, `${operationAt}.jq`),
    )
  }
  const poll = asRecord(config.poll)
  const pollAt = `${at}.poll`
  if (!poll) {
    errors.push(`${pollAt} is required ({path, statusPath, successValues})`)
    return errors
  }
  errors.push(
    ...unknownFieldErrors(poll, KNOWN_KEYS.poll, pollAt),
    ...enumErrors(poll.method, ['GET'], `${pollAt}.method`),
    ...requiredStringErrors(poll, 'path', pollAt),
    ...requiredStringErrors(poll, 'statusPath', pollAt),
    ...optionalStringErrors(poll, 'handleParam', pollAt),
    ...stringListErrors(poll.successValues, `${pollAt}.successValues`, 1),
    ...stringListErrors(poll.failureValues, `${pollAt}.failureValues`),
    ...optionalIntegerErrors(poll, 'intervalSeconds', pollAt),
    ...optionalIntegerErrors(poll, 'maxAttempts', pollAt),
    ...optionalIntegerErrors(poll, 'timeoutSeconds', pollAt),
  )
  if (isNonEmptyString(poll.path)) {
    const token = `{${isNonEmptyString(poll.handleParam) ? poll.handleParam : DEFAULT_HANDLE_PARAM}}`
    if (!poll.path.includes(token)) {
      errors.push(`${pollAt}.path must contain the ${token} token (the extracted operation handle binds to it; set poll.handleParam to the OAS parameter name)`)
    }
  }
  return errors
}

/** One verbsDescription entry's errors (prefixed with its list position for the drawer). */
export const validateVerbEntry = (entry: unknown, index: number): string[] => {
  const at = `verbsDescription[${index}]`
  const verb = asRecord(entry)
  if (!verb) {
    return [`${at}: must be an object ({action, method, path})`]
  }
  const errors: string[] = unknownFieldErrors(verb, KNOWN_KEYS.verb, at)
  const actions: readonly string[] = REST_DEF_ACTIONS
  const methods: readonly string[] = REST_DEF_METHODS
  if (!isNonEmptyString(verb.action) || !actions.includes(verb.action)) {
    errors.push(`${at}: action must be one of ${REST_DEF_ACTIONS.join('|')}`)
  }
  if (!isNonEmptyString(verb.method) || !methods.includes(verb.method)) {
    errors.push(`${at}: method must be one of ${REST_DEF_METHODS.join('|')} (uppercase)`)
  }
  if (!isNonEmptyString(verb.path)) {
    errors.push(`${at}: path is required (must match a path in the OAS document)`)
  }
  // findby-only fields (CEL on the live CRD): identifiersMatchPolicy + pagination.
  if (verb.action !== 'findby' && verb.identifiersMatchPolicy !== undefined) {
    errors.push(`${at}: identifiersMatchPolicy can only be set on a findby action`)
  }
  if (verb.action !== 'findby' && verb.pagination !== undefined) {
    errors.push(`${at}: pagination can only be set on a findby action`)
  }
  // itemsPath (0.25): the property holding a findby ENVELOPE's collection — read by the generator and
  // the controller alike, so it means nothing on another verb.
  if (verb.itemsPath !== undefined && verb.action !== 'findby') {
    errors.push(`${at}: itemsPath can only be set on a findby action`)
  }
  if (verb.itemsPath !== undefined && !isNonEmptyString(verb.itemsPath)) {
    errors.push(`${at}.itemsPath must be a non-empty string (e.g. .values)`)
  }
  // oasPath (0.25): this verb's own document, in the same two URI forms as spec.oasPath.
  if (verb.oasPath !== undefined && !parseOasPath(verb.oasPath)) {
    errors.push(`${at}.oasPath must be configmap://<namespace>/<name>/<key> or http(s)://…`)
  }
  if (verb.identifiersMatchPolicy !== undefined && verb.identifiersMatchPolicy !== 'AND' && verb.identifiersMatchPolicy !== 'OR') {
    errors.push(`${at}: identifiersMatchPolicy must be AND or OR`)
  }
  // async drives a mutating verb's long-running operation — the provider documents it for create|update|delete only.
  if (verb.async !== undefined && !(isNonEmptyString(verb.action) && ASYNC_ACTIONS.includes(verb.action))) {
    errors.push(`${at}: async can only be set on a create, update or delete action`)
  }
  errors.push(
    ...requestFieldMappingErrors(verb.requestFieldMapping, at),
    ...fieldMappingErrors(verb.fieldMapping, at),
    ...jqProgramErrors(verb.requestTransform, `${at}.requestTransform`),
    ...jqProgramErrors(verb.responseTransform, `${at}.responseTransform`),
    ...jqProgramErrors(verb.notFoundBody, `${at}.notFoundBody`),
    ...paginationErrors(verb.pagination, `${at}.pagination`),
    ...asyncErrors(verb.async, `${at}.async`),
    ...nameValueListErrors(verb.headers, `${at}.headers`),
    ...nameValueListErrors(verb.queries, `${at}.queries`),
    ...integerListErrors(verb.successCodes, `${at}.successCodes`),
    ...integerListErrors(verb.tolerateCodes, `${at}.tolerateCodes`),
    ...integerListErrors(verb.notFoundCodes, `${at}.notFoundCodes`),
  )
  return errors
}

/**
 * An ApiRef (observe/create/update/deleteApiRef): a Snowplow RESTAction {name, namespace}
 * plus free-form extras; notFoundExpr / upToDateExpr are jq predicates that only the
 * observeApiRef evaluates.
 */
const apiRefErrors = (value: unknown, field: string): string[] => {
  if (value === undefined) {
    return []
  }
  const at = `resource.${field}`
  const ref = asRecord(value)
  if (!ref) {
    return [`${at}: must be an object ({name, namespace})`]
  }
  const errors = [
    ...unknownFieldErrors(ref, KNOWN_KEYS.apiRef, at),
    ...requiredStringErrors(ref, 'name', at),
    ...requiredStringErrors(ref, 'namespace', at),
    ...jqProgramErrors(ref.notFoundExpr, `${at}.notFoundExpr`),
    ...jqProgramErrors(ref.upToDateExpr, `${at}.upToDateExpr`),
  ]
  if (field !== 'observeApiRef' && (ref.notFoundExpr !== undefined || ref.upToDateExpr !== undefined)) {
    errors.push(`${at}: notFoundExpr and upToDateExpr are only evaluated on observeApiRef`)
  }
  return errors
}

/** The resource-level CEL rules that span fields: compareScope and the createApiRef preconditions. */
export const resourceRuleErrors = (resource: Record<string, unknown>): string[] => {
  const errors = enumErrors(resource.compareScope, REST_DEF_COMPARE_SCOPES, 'resource.compareScope')
  const verbs = Array.isArray(resource.verbsDescription) ? resource.verbsDescription.map((verb) => asRecord(verb)?.action) : []
  const hasEntries = (value: unknown): boolean => Array.isArray(value) && value.length > 0
  if (resource.compareScope === 'identifiersAndStatus' && !hasEntries(resource.identifiers) && !hasEntries(resource.additionalStatusFields)) {
    errors.push('resource.compareScope identifiersAndStatus requires at least one identifier or additionalStatusField')
  }
  if (resource.compareScope === 'updatable' && !verbs.includes('update')) {
    errors.push('resource.compareScope updatable requires an update verb (otherwise no field is ever compared)')
  }
  if (resource.createApiRef !== undefined && !verbs.includes('get') && !verbs.includes('findby')) {
    errors.push('resource.createApiRef requires a get or findby verb (so the controller can verify the create converged)')
  }
  if (resource.createApiRef !== undefined && resource.observeApiRef !== undefined && asRecord(resource.observeApiRef)?.notFoundExpr === undefined) {
    errors.push('resource.createApiRef with observeApiRef requires observeApiRef.notFoundExpr')
  }
  for (const field of REST_DEF_API_REFS) {
    errors.push(...apiRefErrors(resource[field], field))
  }
  return errors
}

/** The request-direction anchors of a fieldMapping entry. */
const REQUEST_ANCHORS = ['inPath', 'inQuery', 'inBody'] as const

/**
 * What a VALID RestDefinition still does wrong at runtime — warnings, never errors (the apiserver
 * accepts it). Today: a `valueMapping` of type jq on a REQUEST-direction fieldMapping entry
 * (inPath / inQuery / inBody). oasgen ≤0.25.1 ignores it there, so the request goes out without the
 * field. A jq valueMapping on an inResponse entry is applied, and is never warned about.
 */
export const restDefinitionWarnings = (draft: Record<string, unknown>): string[] => {
  const resource = asRecord(asRecord(draft.spec)?.resource)
  const verbs: unknown[] = Array.isArray(resource?.verbsDescription) ? resource.verbsDescription : []
  return verbs.flatMap((entry, index) => {
    const verb = asRecord(entry)
    const mappings: unknown[] = Array.isArray(verb?.fieldMapping) ? verb.fieldMapping : []
    return mappings.flatMap((raw, mappingIndex) => {
      const mapping = asRecord(raw)
      const anchor = REQUEST_ANCHORS.find((key) => mapping?.[key] !== undefined)
      if (!mapping || !anchor || asRecord(mapping.valueMapping)?.type !== 'jq') { return [] }
      return [`verbsDescription[${index}] (${String(verb?.action)}).fieldMapping[${mappingIndex}]: valueMapping type jq on ${anchor} ${String(mapping[anchor])} — oasgen ≤0.25.1 ignores it; the request goes out without the field.`]
    })
  })
}
