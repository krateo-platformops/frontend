/**
 * oasImport — the real Swagger Petstore v3 spec (petstore3.swagger.io/api/v3/openapi.json, fetched
 * 2026-09-30) and two github-provider-kog specs as krateo-057 holds them in their ConfigMaps.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { BLUEPRINT_DRAFT_MAX_BYTES } from '../../components/Autopilot/blueprintDraftStore'

import { listOperations, type OasImport, parseOas, securitySchemeSupport, trimOas } from './oasImport'

const fixture = (file: string): string => readFileSync(join(__dirname, '__fixtures__', file), 'utf8')
const PETSTORE = fixture('petstore-v3.openapi.json')
const LABEL = fixture('github-kog-label.oas.yaml')
const REPOSITORY = fixture('github-kog-repository.oas.yaml')

const only = (text: string): OasImport => {
  const result = parseOas(text)
  if (!result.ok) { throw new Error(result.error) }
  expect(result.documents).toHaveLength(1)
  return result.documents[0]
}

const failure = (text: string): { error: string; line: number | null } => {
  const result = parseOas(text)
  if (result.ok) { throw new Error('expected a parse failure') }
  return result
}

describe('parseOas', () => {
  it('reads the petstore JSON: 13 paths, 19 operations, two security schemes', () => {
    const petstore = only(PETSTORE)
    expect(petstore.format).toBe('json')
    expect(petstore.summary).toEqual({
      bytes: 17106,
      operations: 19,
      paths: 13,
      securitySchemes: ['petstore_auth', 'api_key'],
      title: 'Swagger Petstore - OpenAPI 3.0',
      version: '3.0.4',
    })
  })

  it('reads the github-provider-kog Label YAML as krateo-057 holds it', () => {
    const label = only(LABEL)
    expect(label.format).toBe('yaml')
    expect(label.summary).toEqual({
      bytes: 5731,
      operations: 4,
      paths: 2,
      securitySchemes: ['accessToken'],
      title: 'GitHub v3 REST API - Labels',
      version: '3.0.3',
    })
    expect(label.operations.map((operation) => operation.key)).toEqual([
      'POST /repos/{owner}/{repo}/labels',
      'GET /repos/{owner}/{repo}/labels/{name}',
      'DELETE /repos/{owner}/{repo}/labels/{name}',
      'PATCH /repos/{owner}/{repo}/labels/{name}',
    ])
  })

  it('resolves $ref parameters and merges path-level ones', () => {
    const label = only(LABEL)
    const get = label.operations.find((operation) => operation.key === 'GET /repos/{owner}/{repo}/labels/{name}')
    expect(get?.parameters).toEqual([
      { in: 'path', name: 'owner', required: true },
      { in: 'path', name: 'repo', required: true },
      { in: 'path', name: 'name', required: true },
    ])
    const merged = listOperations({
      openapi: '3.0.3',
      paths: {
        '/a/{id}': {
          get: { parameters: [{ in: 'path', name: 'id', required: false }, { in: 'query', name: 'q' }] },
          parameters: [{ in: 'path', name: 'id', required: true }],
        },
      },
    })
    // Operation-level wins over path-level for the same name+in.
    expect(merged[0].parameters).toEqual([{ in: 'path', name: 'id', required: false }, { in: 'query', name: 'q', required: false }])
  })

  it('reads a YAML stream of several documents as several documents', () => {
    const result = parseOas(`${LABEL}\n---\n${REPOSITORY}`)
    if (!result.ok) { throw new Error(result.error) }
    expect(result.documents.map((document) => document.summary.title)).toEqual(['GitHub v3 REST API - Labels', 'GitHub v3 REST API - Repositories'])
    expect(result.documents.map((document) => document.summary.operations)).toEqual([4, 3])
  })

  it('refuses the whole stream when one document is not OpenAPI 3.x', () => {
    expect(failure(`${LABEL}\n---\nswagger: '2.0'\npaths: {}\n`).error)
      .toBe('Document 2 of 2 is not an OpenAPI 3.x document: it is Swagger 2.0, and oasgen reads OpenAPI 3.x only — convert it first.')
  })

  it('says what is wrong with a document that parses but is not a spec', () => {
    expect(failure('openapi: 2.9\npaths: {}\n').error).toBe('The spec is not an OpenAPI 3.x document: its openapi field is 2.9, not 3.x.')
    expect(failure('openapi: 3.1.0\ninfo: {}\n').error).toBe('The spec is not an OpenAPI 3.x document: it has no paths.')
    expect(failure('- a\n- b\n').error).toBe('The spec is not an OpenAPI 3.x document: it is not an object.')
    expect(failure('   \n').error).toBe('The spec is empty.')
    // An unquoted `openapi: 3.1` is a YAML float, and still a 3.x document.
    const float = parseOas('openapi: 3.1\npaths: {}\n')
    expect(float.ok && float.documents[0].summary.version).toBe('3.1')
  })

  it('reports a YAML error as a sentence with its line', () => {
    const broken = 'openapi: 3.0.3\ninfo:\n  title: x\npaths:\n  /a:\n    get: {\n'
    const result = failure(broken)
    expect(result.line).toBe(7)
    expect(result.error).toMatch(/^The spec could not be read on line 7: .+\.$/)
  })

  it('reports a JSON error as a sentence with its line', () => {
    const broken = '{\n  "openapi": "3.0.3",\n  "paths": {\n    "/a": {,}\n  }\n}\n'
    const result = failure(broken)
    expect(result.line).toBe(4)
    expect(result.error).toMatch(/^The spec could not be read on line 4: .+\.$/)
  })
})

describe('trimOas', () => {
  const petstore = only(PETSTORE)
  const petPaths = ['/pet', '/pet/findByStatus', '/pet/findByTags', '/pet/{petId}', '/pet/{petId}/uploadImage']

  it('keeps the selected paths and every component they reach, transitively', () => {
    const trimmed = trimOas(petstore.doc, petPaths, 'json')
    expect(Object.keys(trimmed.doc.paths as object)).toEqual(petPaths)
    // Pet is referenced directly; Category and Tag only through Pet; ApiResponse by uploadImage.
    expect(trimmed.keptComponents).toEqual([
      '#/components/schemas/ApiResponse',
      '#/components/schemas/Category',
      '#/components/schemas/Pet',
      '#/components/schemas/Tag',
    ])
    expect(trimmed.keptSecuritySchemes).toEqual(['api_key', 'petstore_auth'])
    expect(Object.keys((trimmed.doc.components as Record<string, object>).schemas)).not.toContain('Order')
    expect(trimmed.missingPaths).toEqual([])
    expect(trimmed.danglingRefs).toEqual([])
    // The trimmed document is itself a spec: 5 paths, 8 operations.
    const reparsed = only(JSON.stringify(trimmed.doc))
    expect([reparsed.summary.paths, reparsed.summary.operations]).toEqual([5, 8])
  })

  it('measures the trimmed bytes against the 512 KiB draft cap', () => {
    const trimmed = trimOas(petstore.doc, ['/pet/{petId}'], 'json')
    expect(trimmed.cap).toBe(BLUEPRINT_DRAFT_MAX_BYTES)
    expect(trimmed.cap).toBe(512 * 1024)
    expect(trimmed.overCap).toBe(false)
    expect(trimmed.bytes).toBeLessThan(petstore.summary.bytes)
    expect(trimmed.keptComponents).toEqual(['#/components/schemas/Category', '#/components/schemas/Pet', '#/components/schemas/Tag'])
    expect(trimmed.bytes).toBe(new TextEncoder().encode(`${JSON.stringify(trimmed.doc, null, 2)}\n`).length)
  })

  it('says a trim is over the cap when what it keeps is', () => {
    const doc = {
      components: { schemas: { Big: { description: 'x'.repeat(600 * 1024), type: 'object' }, Unused: { description: 'y'.repeat(600 * 1024) } } },
      openapi: '3.0.3',
      paths: {
        '/big': { get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Big' } } }, description: 'ok' } } } },
        '/small': { get: { responses: { 204: { description: 'none' } } } },
      },
    }
    expect(trimOas(doc, ['/small']).overCap).toBe(false)
    expect(trimOas(doc, ['/big']).overCap).toBe(true)
  })

  it('keeps the root security requirement and the schemes it names', () => {
    const label = only(LABEL)
    const trimmed = trimOas(label.doc, ['/repos/{owner}/{repo}/labels/{name}'], 'yaml')
    expect(trimmed.keptSecuritySchemes).toEqual(['accessToken'])
    expect(trimmed.doc.security).toEqual([{ accessToken: [] }])
    expect(trimmed.keptComponents).toEqual([
      '#/components/parameters/name',
      '#/components/parameters/owner',
      '#/components/parameters/repo',
      '#/components/schemas/Label',
    ])
  })

  it('names missing paths and dangling refs instead of dropping them silently', () => {
    const doc = { openapi: '3.0.3', paths: { '/a': { get: { responses: { 200: { $ref: '#/components/responses/Gone' } } } } } }
    const trimmed = trimOas(doc, ['/a', '/nope'])
    expect(trimmed.missingPaths).toEqual(['/nope'])
    expect(trimmed.danglingRefs).toEqual(['#/components/responses/Gone'])
  })

  it('keeps only the tags a kept operation names', () => {
    const trimmed = trimOas(petstore.doc, ['/store/order'])
    expect((trimmed.doc.tags as { name: string }[]).map((tag) => tag.name)).toEqual(['store'])
  })
})

describe('securitySchemeSupport', () => {
  it('petstore: the header apiKey is generated, oauth2 is skipped with a reason', () => {
    const support = securitySchemeSupport(only(PETSTORE).doc)
    expect(support.map(({ authKey, name, supported }) => ({ authKey, name, supported }))).toEqual([
      { authKey: null, name: 'petstore_auth', supported: false },
      { authKey: 'apiKey', name: 'api_key', supported: true },
    ])
    expect(support[0].reason).toMatch(/^oauth2 is not generated/)
  })

  it('github-provider-kog: http bearer is generated', () => {
    expect(securitySchemeSupport(only(LABEL).doc)).toEqual([
      { authKey: 'bearer', name: 'accessToken', reason: null, supported: true, type: 'http' },
    ])
  })

  it('basic is generated; openIdConnect, a query apiKey and digest are skipped', () => {
    const support = securitySchemeSupport({
      components: {
        securitySchemes: {
          basic: { scheme: 'Basic', type: 'http' },
          digest: { scheme: 'digest', type: 'http' },
          oidc: { openIdConnectUrl: 'https://x/.well-known/openid-configuration', type: 'openIdConnect' },
          queryKey: { in: 'query', name: 'key', type: 'apiKey' },
        },
      },
      openapi: '3.0.3',
      paths: {},
    })
    expect(support.map((scheme) => [scheme.name, scheme.authKey, scheme.supported])).toEqual([
      ['basic', 'basic', true],
      ['digest', null, false],
      ['oidc', null, false],
      ['queryKey', null, false],
    ])
    expect(support[2].reason).toMatch(/^openIdConnect is not generated/)
    expect(support[3].reason).toMatch(/apiKey in query/)
  })
})
