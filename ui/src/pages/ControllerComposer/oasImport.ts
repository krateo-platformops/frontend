/**
 * T7 — the `parser: openapi` plugin: read an OpenAPI 3.x document, say what is in it, and trim it
 * to what one controller needs. Pure: no React, no network.
 *
 * PARSE. JSON or YAML (js-yaml, the library the rail already uses), and a YAML stream of several
 * `---`-separated documents reads as several documents. A failure is ONE sentence with the line it
 * happened on, because the author fixes a paste by going to that line. Swagger 2.0 is refused by
 * name: oasgen reads OpenAPI 3.x only, and a 2.0 document that half-parses would map to nothing.
 *
 * TRIM. A controller's ConfigMap holds the spec, and the draft tree is capped at 512 KiB
 * (BLUEPRINT_DRAFT_MAX_BYTES). The trimmer keeps the selected paths, every `#/components/*` entry
 * they reach through `$ref` (transitively — a schema's own refs are followed), and the security
 * schemes their operations (or the document's root `security`) name. Everything else goes. The
 * result says its size against the cap, so "too big" is answered before a publish is attempted.
 *
 * SECURITY. oasgen generates an authentication field for http basic, http bearer and a header
 * apiKey. Everything else (oauth2, openIdConnect, an apiKey in a query or cookie, another http
 * scheme) is SKIPPED by the generator with a warning — reported here, with the reason, before the
 * author finds out through 401s.
 */
import { dump, load, loadAll, YAMLException } from 'js-yaml'

import { BLUEPRINT_DRAFT_MAX_BYTES } from '../../components/Autopilot/blueprintDraftStore'
import { asRecord } from '../../components/Autopilot/kogRestDefSchema'
import { utf8ByteLength } from '../../components/Autopilot/oasAttachment'

/** The HTTP methods an OpenAPI path item can carry, in the spec's order. */
export const OAS_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const
export type OasMethod = typeof OAS_METHODS[number]

export type OasDocument = Record<string, unknown>
export type OasFormat = 'json' | 'yaml'

/** One parameter of an operation, after path-level and operation-level parameters are merged and `$ref`s resolved. */
export interface OasParameter {
  name: string
  in: string
  required: boolean
}

/** One operation of the document. */
export interface OasOperation {
  /** `GET /pet/{petId}` — unique within a document. */
  key: string
  /** Uppercase, as a RestDefinition verb spells it. */
  method: Uppercase<OasMethod>
  path: string
  operationId: string | null
  summary: string | null
  /** The first path segment: the resource group the palette files it under. */
  group: string
  parameters: OasParameter[]
}

export interface OasSummary {
  /** The document's `openapi` field, e.g. 3.0.4. */
  version: string
  title: string
  paths: number
  operations: number
  /** The names under components.securitySchemes. */
  securitySchemes: string[]
  /** UTF-8 bytes of the text this document was read from (the whole text for a single document). */
  bytes: number
}

export interface OasImport {
  doc: OasDocument
  format: OasFormat
  summary: OasSummary
  operations: OasOperation[]
}

export type OasParseResult =
  | { ok: true; documents: OasImport[] }
  | { ok: false; error: string; line: number | null }

/** The first path segment, or `(root)` for `/`. Braces are kept: `/{tenant}/x` files under `{tenant}`. */
export const resourceGroupOf = (path: string): string => path.split('/').find((segment) => segment.length > 0) ?? '(root)'

/** Resolve a local `#/…` JSON pointer inside the document (null when it does not resolve or is not local). */
export const resolvePointer = (doc: OasDocument, ref: string): unknown => {
  if (!ref.startsWith('#/')) {
    return null
  }
  let node: unknown = doc
  for (const raw of ref.slice(2).split('/')) {
    const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    const record = asRecord(node)
    if (!record || !(segment in record)) {
      return null
    }
    node = record[segment]
  }
  return node
}

/** Follow `$ref` until a non-ref node (bounded, so a ref cycle ends). */
export const deref = (doc: OasDocument, node: unknown): Record<string, unknown> | null => {
  let current = asRecord(node)
  for (let hops = 0; current && typeof current.$ref === 'string' && hops < 32; hops++) {
    current = asRecord(resolvePointer(doc, current.$ref))
  }
  return current
}

const parametersOf = (doc: OasDocument, pathItem: Record<string, unknown>, operation: Record<string, unknown>): OasParameter[] => {
  const merged = new Map<string, OasParameter>()
  for (const list of [pathItem.parameters, operation.parameters]) {
    if (!Array.isArray(list)) {
      continue
    }
    for (const entry of list) {
      const parameter = deref(doc, entry)
      if (parameter && typeof parameter.name === 'string' && typeof parameter.in === 'string') {
        // Operation-level wins over path-level for the same name+in (OpenAPI 3 §4.8.9).
        merged.set(`${parameter.in}:${parameter.name}`, { in: parameter.in, name: parameter.name, required: parameter.required === true })
      }
    }
  }
  return [...merged.values()]
}

/** Every operation of the document, in path order then the spec's method order. */
export const listOperations = (doc: OasDocument): OasOperation[] => {
  const paths = asRecord(doc.paths) ?? {}
  const operations: OasOperation[] = []
  for (const [path, value] of Object.entries(paths)) {
    const pathItem = deref(doc, value) ?? {}
    for (const method of OAS_METHODS) {
      const operation = asRecord(pathItem[method])
      if (!operation) {
        continue
      }
      const upper = method.toUpperCase() as Uppercase<OasMethod>
      operations.push({
        group: resourceGroupOf(path),
        key: `${upper} ${path}`,
        method: upper,
        operationId: typeof operation.operationId === 'string' ? operation.operationId : null,
        parameters: parametersOf(doc, pathItem, operation),
        path,
        summary: typeof operation.summary === 'string' ? operation.summary : null,
      })
    }
  }
  return operations
}

/** The `openapi` field as text — an unquoted `openapi: 3.1` is a YAML float, and still names 3.1. */
const versionOf = (doc: OasDocument): string | null => {
  if (typeof doc.openapi === 'number') {
    return doc.openapi.toFixed(1)
  }
  return typeof doc.openapi === 'string' ? doc.openapi : null
}

/** The document's summary line. */
export const summarizeOas = (doc: OasDocument, bytes: number): OasSummary => {
  const info = asRecord(doc.info)
  return {
    bytes,
    operations: listOperations(doc).length,
    paths: Object.keys(asRecord(doc.paths) ?? {}).length,
    securitySchemes: Object.keys(asRecord(asRecord(doc.components)?.securitySchemes) ?? {}),
    title: typeof info?.title === 'string' ? info.title : '',
    version: versionOf(doc) ?? '',
  }
}

/** Why a parsed value is not an OpenAPI 3.x document (null when it is one). */
const notOpenApiReason = (value: unknown): string | null => {
  const doc = asRecord(value)
  if (!doc) {
    return 'it is not an object'
  }
  if (doc.swagger !== undefined) {
    return `it is Swagger ${JSON.stringify(doc.swagger).replace(/"/g, '')}, and oasgen reads OpenAPI 3.x only — convert it first`
  }
  const version = versionOf(doc)
  if (version === null || !/^3\.\d+/.test(version)) {
    return doc.openapi === undefined ? 'it has no openapi field' : `its openapi field is ${JSON.stringify(doc.openapi).replace(/"/g, '')}, not 3.x`
  }
  if (!asRecord(doc.paths)) {
    return 'it has no paths'
  }
  return null
}

const dumpYaml = (doc: OasDocument): string => dump(doc, { lineWidth: -1, noRefs: true })

/** Serialize a document back in the format it came in (what a ConfigMap would carry). */
export const serializeOas = (doc: OasDocument, format: OasFormat): string =>
  (format === 'json' ? `${JSON.stringify(doc, null, 2)}\n` : dumpYaml(doc))

const yamlFailure = (error: unknown): { ok: false; error: string; line: number | null } => {
  if (error instanceof YAMLException) {
    const line = typeof error.mark?.line === 'number' ? error.mark.line + 1 : null
    const where = line === null ? '' : ` on line ${line}`
    return { error: `The spec could not be read${where}: ${error.reason}.`, line, ok: false }
  }
  return { error: `The spec could not be read: ${error instanceof Error ? error.message : String(error)}.`, line: null, ok: false }
}

/**
 * Parse OpenAPI 3.x text — JSON, YAML, or a YAML stream of several documents. Every document must
 * be OpenAPI 3.x; the first that is not fails the whole parse (a set is imported whole or not at all).
 */
export const parseOas = (text: string): OasParseResult => {
  const bytes = utf8ByteLength(text)
  if (text.trim().length === 0) {
    return { error: 'The spec is empty.', line: null, ok: false }
  }
  const trimmed = text.trimStart()
  let values: unknown[]
  let format: OasFormat = 'yaml'
  if (trimmed.startsWith('{')) {
    try {
      values = [JSON.parse(text)]
      format = 'json'
    } catch {
      // JSON.parse names a character offset (or nothing, depending on the engine); js-yaml reads
      // JSON too and names the line, so the sentence the author gets is the same either way.
      try {
        values = [load(text)]
      } catch (error) {
        return yamlFailure(error)
      }
    }
  } else {
    try {
      values = loadAll(text).filter((value) => value !== null && value !== undefined)
    } catch (error) {
      return yamlFailure(error)
    }
  }
  if (values.length === 0) {
    return { error: 'The spec is empty.', line: null, ok: false }
  }
  const documents: OasImport[] = []
  for (const [index, value] of values.entries()) {
    const reason = notOpenApiReason(value)
    if (reason) {
      const which = values.length > 1 ? `Document ${index + 1} of ${values.length}` : 'The spec'
      return { error: `${which} is not an OpenAPI 3.x document: ${reason}.`, line: null, ok: false }
    }
    const doc = value as OasDocument
    // One document: its bytes are the text's. Several: each is measured as it would be published alone.
    const own = values.length === 1 ? bytes : utf8ByteLength(serializeOas(doc, format))
    documents.push({ doc, format, operations: listOperations(doc), summary: summarizeOas(doc, own) })
  }
  return { documents, ok: true }
}

/** Every `$ref` string anywhere under `node`. */
const collectRefs = (node: unknown, into: Set<string>): void => {
  if (Array.isArray(node)) {
    node.forEach((entry) => collectRefs(entry, into))
    return
  }
  const record = asRecord(node)
  if (!record) {
    return
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === '$ref' && typeof value === 'string') {
      into.add(value)
    } else {
      collectRefs(value, into)
    }
  }
}

/** The security scheme names a `security` requirement list names. */
const requirementNames = (value: unknown): string[] =>
  (Array.isArray(value) ? value.flatMap((requirement) => Object.keys(asRecord(requirement) ?? {})) : [])

export interface OasTrimResult {
  doc: OasDocument
  /** UTF-8 bytes of the trimmed document, serialized in `format`. */
  bytes: number
  /** The cap it is measured against (BLUEPRINT_DRAFT_MAX_BYTES, 512 KiB). */
  cap: number
  overCap: boolean
  /** Selected paths the document does not have (nothing is kept for them). */
  missingPaths: string[]
  /** The components kept, as `#/components/<section>/<name>` refs, sorted. */
  keptComponents: string[]
  /** The security schemes kept, sorted. */
  keptSecuritySchemes: string[]
  /** `$ref`s reached from the kept paths that resolve to nothing in the document. */
  danglingRefs: string[]
}

/** `#/components/<section>/<name>` → [section, name] (null for any other ref). */
const componentAddress = (ref: string): [string, string] | null => {
  const match = /^#\/components\/([^/]+)\/([^/]+)/.exec(ref)
  return match ? [match[1], match[2].replace(/~1/g, '/').replace(/~0/g, '~')] : null
}

/**
 * Trim a document to the selected paths plus the components they transitively reference and the
 * security schemes their operations use. Top-level fields other than paths/components (openapi,
 * info, servers, security, …) are kept; `tags` keeps only the tags a kept operation names.
 */
export const trimOas = (doc: OasDocument, selectedPaths: readonly string[], format: OasFormat = 'json'): OasTrimResult => {
  const paths = asRecord(doc.paths) ?? {}
  const keptPaths: Record<string, unknown> = {}
  const missingPaths: string[] = []
  for (const path of selectedPaths) {
    if (path in paths) {
      keptPaths[path] = paths[path]
    } else {
      missingPaths.push(path)
    }
  }

  // Transitive $ref closure, starting from the kept path items.
  const pending = new Set<string>()
  collectRefs(keptPaths, pending)
  const visited = new Set<string>()
  const danglingRefs = new Set<string>()
  while (pending.size > 0) {
    const [ref] = pending
    pending.delete(ref)
    if (visited.has(ref)) {
      continue
    }
    visited.add(ref)
    const target = resolvePointer(doc, ref)
    if (target === null || target === undefined) {
      danglingRefs.add(ref)
      continue
    }
    const next = new Set<string>()
    collectRefs(target, next)
    next.forEach((entry) => {
      if (!visited.has(entry)) {
        pending.add(entry)
      }
    })
  }

  const sourceComponents = asRecord(doc.components) ?? {}
  const components: Record<string, Record<string, unknown>> = {}
  const keptComponents: string[] = []
  for (const ref of visited) {
    const address = componentAddress(ref)
    if (!address || danglingRefs.has(ref)) {
      continue
    }
    const [section, name] = address
    const value = asRecord(sourceComponents[section])?.[name]
    if (value === undefined) {
      continue
    }
    components[section] = { ...components[section], [name]: value }
    keptComponents.push(`#/components/${section}/${name}`)
  }

  // Security schemes: the root requirement plus every kept operation's own.
  const schemeNames = new Set(requirementNames(doc.security))
  const usedTags = new Set<string>()
  for (const value of Object.values(keptPaths)) {
    const pathItem = deref(doc, value) ?? {}
    for (const method of OAS_METHODS) {
      const operation = asRecord(pathItem[method])
      if (operation) {
        requirementNames(operation.security).forEach((name) => schemeNames.add(name))
        if (Array.isArray(operation.tags)) {
          operation.tags.filter((tag): tag is string => typeof tag === 'string').forEach((tag) => usedTags.add(tag))
        }
      }
    }
  }
  const sourceSchemes = asRecord(sourceComponents.securitySchemes) ?? {}
  const keptSecuritySchemes = [...schemeNames].filter((name) => name in sourceSchemes).sort()
  if (keptSecuritySchemes.length > 0) {
    components.securitySchemes = {
      ...components.securitySchemes,
      ...Object.fromEntries(keptSecuritySchemes.map((name) => [name, sourceSchemes[name]])),
    }
  }

  const trimmed: OasDocument = {}
  for (const [key, value] of Object.entries(doc)) {
    if (key === 'paths') {
      trimmed.paths = keptPaths
    } else if (key === 'components') {
      if (Object.keys(components).length > 0) {
        trimmed.components = components
      }
    } else if (key === 'tags' && Array.isArray(value)) {
      trimmed.tags = value.filter((tag) => usedTags.has(String(asRecord(tag)?.name)))
    } else {
      trimmed[key] = value
    }
  }
  if (!('paths' in trimmed)) {
    trimmed.paths = keptPaths
  }
  if (!('components' in trimmed) && Object.keys(components).length > 0) {
    trimmed.components = components
  }

  const bytes = utf8ByteLength(serializeOas(trimmed, format))
  return {
    bytes,
    cap: BLUEPRINT_DRAFT_MAX_BYTES,
    danglingRefs: [...danglingRefs].sort(),
    doc: trimmed,
    keptComponents: keptComponents.sort(),
    keptSecuritySchemes,
    missingPaths,
    overCap: bytes > BLUEPRINT_DRAFT_MAX_BYTES,
  }
}

/** One security scheme and whether oasgen can generate an authentication field for it. */
export interface SecuritySchemeSupport {
  name: string
  type: string
  /** basic | bearer | apiKey — the key oasgen exposes it under in `authentication` (null when skipped). */
  authKey: 'basic' | 'bearer' | 'apiKey' | null
  supported: boolean
  /** Why it is skipped (null when supported). */
  reason: string | null
}

/**
 * Classify every components.securitySchemes entry the way oasgen's configuration builder does:
 * http basic → basic, http bearer → bearer, apiKey in a header → apiKey; everything else is
 * skipped by the generator (a warning, not an error — the resource then has no credentials field).
 */
export const securitySchemeSupport = (doc: OasDocument): SecuritySchemeSupport[] => {
  const schemes = asRecord(asRecord(doc.components)?.securitySchemes) ?? {}
  return Object.entries(schemes).map(([name, value]) => {
    const scheme = deref(doc, value) ?? {}
    const type = typeof scheme.type === 'string' ? scheme.type : ''
    const httpScheme = typeof scheme.scheme === 'string' ? scheme.scheme.toLowerCase() : ''
    const skipped = (reason: string): SecuritySchemeSupport => ({ authKey: null, name, reason, supported: false, type })
    if (type === 'http' && (httpScheme === 'basic' || httpScheme === 'bearer')) {
      return { authKey: httpScheme, name, reason: null, supported: true, type }
    }
    if (type === 'apiKey') {
      return scheme.in === 'header'
        ? { authKey: 'apiKey', name, reason: null, supported: true, type }
        : skipped(`an apiKey in ${typeof scheme.in === 'string' ? scheme.in : 'an unnamed location'} is not generated (only a header apiKey is; a query key would put the credential in URLs and access logs)`)
    }
    if (type === 'http') {
      return skipped(`http scheme "${httpScheme || 'none'}" is not generated (only basic and bearer are)`)
    }
    if (type === 'oauth2') {
      return skipped('oauth2 is not generated: the controller has no token flow, so the generated Configuration would have no credentials field')
    }
    if (type === 'openIdConnect') {
      return skipped('openIdConnect is not generated: the controller has no token flow, so the generated Configuration would have no credentials field')
    }
    return skipped(`scheme type "${type || 'none'}" is not generated`)
  })
}
