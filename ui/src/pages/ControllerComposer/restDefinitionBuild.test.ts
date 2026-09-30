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

  it('validates clean: the 0.23 shape, the OAS cross-check, bearer auth', () => {
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

  it('builds once the conflict is settled, with the petId ↔ id fieldMapping, and warns about oauth2', () => {
    const result = buildAndValidate({
      identifiers: ['id'],
      kind: 'Pet',
      name: 'petstore-pet',
      namespace: 'demo',
      oasPath: 'https://petstore3.swagger.io/api/v3/openapi.json',
      resourceGroup: 'petstore.example.org',
      verbs: inferredVerbs(petstore, pet, [{ action: 'findby', method: 'GET', path: '/pet/findByStatus' }]),
    }, petstore.doc)
    expect(result.errors).toEqual([])
    expect((result.restDefinition.spec as { resource: { verbsDescription: unknown } }).resource.verbsDescription).toEqual([
      { action: 'create', method: 'POST', path: '/pet' },
      { action: 'get', fieldMapping: [{ inCustomResource: 'spec.id', inPath: 'petId' }], method: 'GET', path: '/pet/{petId}' },
      { action: 'findby', method: 'GET', path: '/pet/findByStatus' },
      { action: 'update', method: 'PUT', path: '/pet' },
      { action: 'delete', fieldMapping: [{ inCustomResource: 'spec.id', inPath: 'petId' }], method: 'DELETE', path: '/pet/{petId}' },
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
      'identifier slug is not a field of the get response (GET /repos/{owner}/{repo}/labels/{name})',
      'additionalStatusField etag is not a field of the get response (GET /repos/{owner}/{repo}/labels/{name})',
    ])
  })

  it('cannot check identifiers without a get verb, and says so', () => {
    const restDefinition = base({ identifiers: ['name'], verbs: { create: { method: 'POST', path: '/repos/{owner}/{repo}/labels' } } })
    expect(oasCrossCheckErrors(restDefinition, label.doc)).toEqual(['identifiers cannot be checked: there is no get verb whose response declares them'])
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

  it('carries the 0.23 shape errors from the #419 validator', () => {
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
