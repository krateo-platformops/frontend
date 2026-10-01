/**
 * restDefinitionBuild — infer → build → validate, with the live github-provider-kog-label
 * RestDefinition (krateo-057, oasgen-provider 0.23.0) as the answer key.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { immutableFieldDiff } from './immutableDiff'
import { type OasImport, parseOas } from './oasImport'
import { inferOperationMapping } from './operationMapping'
import { operationsInGroup } from './paletteModel'
import {
  buildAndValidate,
  buildRestDefinition,
  type KindMapping,
  oasCrossCheckErrors,
  validateControllerRestDefinition,
  verbsFromInference,
} from './restDefinitionBuild'

const fixture = (file: string): string => readFileSync(join(__dirname, '__fixtures__', file), 'utf8')
const load = (file: string): OasImport => {
  const result = parseOas(fixture(file))
  if (!result.ok) { throw new Error(result.error) }
  return result.documents[0]
}
const LIVE_LABEL = JSON.parse(fixture('github-kog-label.restdefinition.json')) as Record<string, unknown>

const inferredVerbs = (oas: OasImport, operations = oas.operations, overrides: Parameters<typeof inferOperationMapping>[2] = []) => {
  const result = verbsFromInference(inferOperationMapping(oas.doc, operations, overrides))
  if (!result.ok) { throw new Error(result.errors.join('; ')) }
  return result.verbs
}

describe('buildRestDefinition — github-provider-kog Label', () => {
  const label = load('github-kog-label.oas.yaml')
  const mapping: KindMapping = {
    additionalStatusFields: ['id', 'node_id', 'url', 'default'],
    compareScope: 'updatable',
    identifiers: ['name'],
    kind: 'Label',
    name: 'github-provider-kog-label',
    namespace: 'krateo-system',
    oasPath: 'configmap://krateo-system/github-provider-kog-label/label.yaml',
    resourceGroup: 'github.krateo.io',
    verbs: inferredVerbs(label),
  }

  it('rebuilds the live RestDefinition from the inferred mapping', () => {
    const built = buildRestDefinition(mapping)
    const live = LIVE_LABEL.spec as { resource: Record<string, unknown> }
    // The live CR carries configurationFields: [] where the builder omits the empty list.
    const { configurationFields, ...liveResource } = live.resource
    expect(configurationFields).toEqual([])
    expect(built).toEqual({
      apiVersion: 'ogen.krateo.io/v1alpha1',
      kind: 'RestDefinition',
      metadata: { name: 'github-provider-kog-label', namespace: 'krateo-system' },
      spec: { ...live, resource: liveResource },
    })
    expect(immutableFieldDiff(LIVE_LABEL, built)).toEqual([])
  })

  it('validates clean: the CRD shape, the OAS cross-check, bearer auth', () => {
    const result = buildAndValidate(mapping, label.doc)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.security.map((scheme) => [scheme.name, scheme.authKey])).toEqual([['accessToken', 'bearer']])
  })

  it('the live RestDefinition itself passes both validators against its own spec', () => {
    expect(validateControllerRestDefinition(LIVE_LABEL, label.doc).errors).toEqual([])
  })
})

describe('buildRestDefinition — github-provider-kog Repository', () => {
  it('matches the live verbs and validates clean', () => {
    const repository = load('github-kog-repository.oas.yaml')
    const result = buildAndValidate({
      additionalStatusFields: ['id', 'node_id', 'full_name', 'html_url', 'clone_url', 'ssh_url', 'default_branch'],
      compareScope: 'updatable',
      identifiers: ['name'],
      kind: 'Repository',
      name: 'github-provider-kog-repository',
      namespace: 'krateo-system',
      oasPath: 'configmap://krateo-system/github-provider-kog-repository/repository.yaml',
      resourceGroup: 'github.krateo.io',
      verbs: inferredVerbs(repository),
    }, repository.doc)
    expect(result.errors).toEqual([])
    // krateo-057's github-provider-kog-repository verbsDescription, verbatim.
    expect((result.restDefinition.spec as { resource: { verbsDescription: unknown } }).resource.verbsDescription).toEqual([
      { action: 'create', method: 'POST', path: '/orgs/{org}/repos' },
      { action: 'get', method: 'GET', path: '/repos/{org}/{name}' },
      { action: 'update', method: 'PATCH', path: '/repos/{org}/{name}' },
    ])
  })
})

describe('buildRestDefinition — petstore Pet', () => {
  const petstore = load('petstore-v3.openapi.json')
  const pet = operationsInGroup(petstore.operations, 'pet')

  it('refuses to build while a verb has two candidates', () => {
    expect(verbsFromInference(inferOperationMapping(petstore.doc, pet))).toEqual({
      errors: ['2 operations look like findby (GET /pet/findByStatus, GET /pet/findByTags) — choose one.'],
      ok: false,
    })
  })

  it('builds once the conflict is settled, with {petId} read from status.id, and warns about oauth2', () => {
    const result = buildAndValidate({
      identifiers: ['id'],
      kind: 'Pet',
      name: 'petstore-pet',
      namespace: 'demo',
      oasPath: 'https://petstore3.swagger.io/api/v3/openapi.json',
      resourceGroup: 'petstore.example.org',
      verbs: inferredVerbs(petstore, pet, [{ action: 'findby', method: 'GET', path: '/pet/findByStatus' }, { action: 'update', method: 'PUT', path: '/pet' }]),
    }, petstore.doc)
    expect(result.errors).toEqual([])
    expect((result.restDefinition.spec as { resource: { verbsDescription: unknown } }).resource.verbsDescription).toEqual([
      { action: 'create', method: 'POST', path: '/pet' },
      { action: 'get', fieldMapping: [{ inCustomResource: 'status.id', inPath: 'petId' }], method: 'GET', path: '/pet/{petId}' },
      { action: 'findby', method: 'GET', path: '/pet/findByStatus' },
      { action: 'update', method: 'PUT', path: '/pet' },
      { action: 'delete', fieldMapping: [{ inCustomResource: 'status.id', inPath: 'petId' }], method: 'DELETE', path: '/pet/{petId}' },
    ])
    expect(result.warnings).toEqual([
      expect.stringMatching(/^security scheme petstore_auth \(oauth2\) is skipped: oauth2 is not generated/),
    ])
  })
})

describe('oasCrossCheckErrors', () => {
  const label = load('github-kog-label.oas.yaml')
  const base = (resource: Record<string, unknown>) => buildRestDefinition({
    identifiers: [],
    kind: 'Label',
    name: 'x',
    namespace: 'y',
    oasPath: 'configmap://krateo-system/x/label.yaml',
    resourceGroup: 'github.krateo.io',
    verbs: {},
    ...resource,
  })

  it('catches a path, a method, a fieldMapping parameter and identifiers the spec does not have', () => {
    const restDefinition = base({
      additionalStatusFields: ['node_id', 'etag'],
      identifiers: ['name', 'slug'],
      verbs: {
        create: { method: 'POST', path: '/repos/{owner}/{repo}/label' },
        delete: { method: 'PUT', path: '/repos/{owner}/{repo}/labels/{name}' },
        get: { fieldMapping: [{ inCustomResource: 'status.id', inPath: 'labelId' }], method: 'GET', path: '/repos/{owner}/{repo}/labels/{name}' },
      },
    })
    expect(oasCrossCheckErrors(restDefinition, label.doc)).toEqual([
      'verbsDescription[0] (create): path /repos/{owner}/{repo}/label is not in the OAS document',
      'verbsDescription[1] (get).fieldMapping[0]: inPath labelId is not a path parameter of /repos/{owner}/{repo}/labels/{name}',
      'verbsDescription[2] (delete): /repos/{owner}/{repo}/labels/{name} has no PUT operation in the OAS document (it has GET, DELETE, PATCH)',
      // A path parameter read from status needs status to carry the field.
      'verbsDescription[1] (get).fieldMapping[0]: reads status.id, which is not a status field — add id to identifiers or additionalStatusFields, or the request never has it',
      'identifier slug is not a field of the get response (GET /repos/{owner}/{repo}/labels/{name})',
      'additionalStatusField etag is not a field of the get response (GET /repos/{owner}/{repo}/labels/{name})',
    ])
  })

  it('cannot check identifiers without a get or findby verb, and says so', () => {
    const restDefinition = base({ identifiers: ['name'], verbs: { create: { method: 'POST', path: '/repos/{owner}/{repo}/labels' } } })
    expect(oasCrossCheckErrors(restDefinition, label.doc)).toEqual(['identifiers cannot be checked: there is no get or findby verb whose response declares them'])
  })

  it('follows a dotted identifier through nested schemas', () => {
    const doc = {
      components: { schemas: { Meta: { properties: { name: { type: 'string' } }, type: 'object' } } },
      openapi: '3.0.3',
      paths: {
        '/things/{id}': {
          get: { responses: { 200: { content: { 'application/json': { schema: { allOf: [{ properties: { metadata: { $ref: '#/components/schemas/Meta' } } }] } } }, description: 'ok' } } },
        },
      },
    }
    const restDefinition = base({ identifiers: ['metadata.name', 'metadata.uid'], verbs: { get: { method: 'GET', path: '/things/{id}' } } })
    expect(oasCrossCheckErrors(restDefinition, doc)).toEqual(['identifier metadata.uid is not a field of the get response (GET /things/{id})'])
  })

  it('carries the shape errors from the #419 validator', () => {
    const restDefinition = base({ identifiers: ['name'], resourceGroup: 'Not_A_Group', verbs: { get: { method: 'GET', path: '/repos/{owner}/{repo}/labels/{name}' } } })
    expect(validateControllerRestDefinition(restDefinition, label.doc).errors).toEqual([
      'spec.resourceGroup must be a DNS subdomain (e.g. mlflow.example.org) — the generated CRD is rejected otherwise',
    ])
  })

  it('warns when no scheme in the spec can be generated', () => {
    const doc = { components: { securitySchemes: { oauth: { type: 'oauth2' } } }, openapi: '3.0.3', paths: {} }
    expect(validateControllerRestDefinition(base({}), doc).warnings).toEqual([
      expect.stringMatching(/^security scheme oauth \(oauth2\) is skipped/),
      'no security scheme in the spec is supported, so the generated Configuration has no credentials field',
    ])
  })
})

describe('round 2 — an Aruba-like provider: findby envelopes, no get, status-sourced ids, notices', () => {
  const kms = load('aruba-like-kms.oas.yaml')
  const keys = (findby: Record<string, unknown>, extra: Partial<KindMapping> = {}) => buildRestDefinition({
    identifiers: ['keyId'],
    kind: 'Key',
    name: 'kms-key',
    namespace: 'demo',
    oasPath: 'configmap://demo/kms-oas/openapi.yaml',
    resourceGroup: 'kms.example.io',
    verbs: {
      create: { method: 'POST', path: '/kms/{kmsId}/keys' },
      delete: { fieldMapping: [{ inCustomResource: 'status.keyId', inPath: 'keyId' }], method: 'DELETE', path: '/kms/{kmsId}/keys/{keyId}' },
      findby: { method: 'GET', path: '/kms/{kmsId}/keys', ...findby },
    },
    ...extra,
  })

  it('a findby envelope with two arrays and no itemsPath is an error — oasgen refuses to guess', () => {
    expect(oasCrossCheckErrors(keys({}), kms.doc)).toEqual([
      'findby (GET /kms/{kmsId}/keys): the findby response is an envelope with 2 array properties (data, included), and oasgen refuses to guess which holds the collection — set itemsPath',
    ])
  })

  it('with itemsPath the identifiers are checked against ONE findby item (there is no get)', () => {
    const restDefinition = keys({ itemsPath: '.data' })
    expect(validateControllerRestDefinition(restDefinition, kms.doc).errors).toEqual([])
    expect(oasCrossCheckErrors(keys({ itemsPath: '.data' }, { additionalStatusFields: ['user.username', 'owner'] }), kms.doc)).toEqual([
      'additionalStatusField owner is not a field of the findby item (GET /kms/{kmsId}/keys)',
    ])
    expect(oasCrossCheckErrors(keys({ itemsPath: '.included.type' }), kms.doc)).toEqual([
      'findby (GET /kms/{kmsId}/keys): itemsPath .included.type names type, which is not a property of the findby response (its arrays: data, included)',
    ])
  })

  it('a Kind with findby and no get is told where its status comes from (oasgen#146)', () => {
    expect(validateControllerRestDefinition(keys({ itemsPath: '.data' }), kms.doc).warnings).toEqual([
      'Key has no get verb: oasgen builds its status from the findby response — one item of its envelope — and every observe walks the findby list (oasgen#146).',
    ])
  })

  it('a jq valueMapping on a REQUEST-direction entry is a warning; on inResponse it is not', () => {
    const restDefinition = keys({ itemsPath: '.data' }, {
      verbs: {
        create: {
          fieldMapping: [
            { inBody: 'algorithm', inCustomResource: 'spec.algorithm', valueMapping: { jq: { inline: 'ascii_upcase' }, type: 'jq' } },
            { inCustomResource: 'status.name', inResponse: 'name', valueMapping: { jq: { inline: 'ascii_downcase' }, type: 'jq' } },
          ],
          method: 'POST',
          path: '/kms/{kmsId}/keys',
        },
        findby: { itemsPath: '.data', method: 'GET', path: '/kms/{kmsId}/keys' },
      },
    })
    const { warnings } = validateControllerRestDefinition(restDefinition, kms.doc)
    expect(warnings.filter((line) => line.includes('valueMapping'))).toEqual([
      'verbsDescription[0] (create).fieldMapping[0]: valueMapping type jq on inBody algorithm — oasgen ≤0.25.1 ignores it; the request goes out without the field.',
    ])
  })
})
