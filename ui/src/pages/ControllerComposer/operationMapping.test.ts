/**
 * operationMapping — the inference over the real petstore spec, and over two github-provider-kog
 * specs whose live RestDefinitions on krateo-057 are the answer key.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type OasImport, parseOas } from './oasImport'
import { envelopeArrays, findbyItemSchema, inferOperationMapping, type OperationMapping, successResponseSchema } from './operationMapping'
import { operationsInGroup } from './paletteModel'

const load = (file: string): OasImport => {
  const result = parseOas(readFileSync(join(__dirname, '__fixtures__', file), 'utf8'))
  if (!result.ok) { throw new Error(result.error) }
  return result.documents[0]
}

const verbTable = (mapping: OperationMapping): Record<string, string> =>
  Object.fromEntries(Object.entries(mapping.verbs).map(([action, choice]) => [action, `${choice?.method} ${choice?.path}`]))

const fields = (list: { field: string }[]): string[] => list.map((entry) => entry.field)

describe('inferOperationMapping — petstore', () => {
  const petstore = load('petstore-v3.openapi.json')
  const group = (name: string) => operationsInGroup(petstore.operations, name)

  it('pet: infers create/get/delete, leaves the two findBy* as a conflict, and OFFERS PUT /pet as an update to confirm', () => {
    const mapping = inferOperationMapping(petstore.doc, group('pet'))
    // Round 2: an update is a PUT/PATCH on the ITEM path. petstore updates with PUT on the collection,
    // its body carrying the id — offered as a one-candidate conflict the person confirms, never inferred.
    expect(verbTable(mapping)).toEqual({
      create: 'POST /pet',
      delete: 'DELETE /pet/{petId}',
      get: 'GET /pet/{petId}',
    })
    expect(mapping.verbs.findby).toBeUndefined()
    expect(mapping.conflicts).toEqual([{
      action: 'findby',
      candidates: [
        expect.objectContaining({ method: 'GET', operationId: 'findPetsByStatus', path: '/pet/findByStatus', reason: 'GET on a findBy* path' }),
        expect.objectContaining({ method: 'GET', operationId: 'findPetsByTags', path: '/pet/findByTags', reason: 'GET on a findBy* path' }),
      ],
      sentence: '2 operations look like findby (GET /pet/findByStatus, GET /pet/findByTags) — choose one.',
    }, {
      action: 'update',
      candidates: [expect.objectContaining({ method: 'PUT', operationId: 'updatePet', path: '/pet', reason: 'PUT on the collection, the id (id) in its body — confirm' })],
      sentence: 'PUT /pet may be the update — a PUT on the collection whose body carries the id (id), not on the item, so it needs a confirm — choose one.',
    }])
    expect(mapping.unmapped).toEqual([
      { category: 'other', key: 'POST /pet/{petId}', method: 'POST', path: '/pet/{petId}', reason: 'POST on an item path is neither a create nor an update by rule — map it with an override' },
      { category: 'action', key: 'POST /pet/{petId}/uploadImage', method: 'POST', path: '/pet/{petId}/uploadImage', reason: 'an action on the item /pet/{petId}, not a lifecycle verb' },
    ])
  })

  it('pet: identifiers come from the GET response, petId ↔ id first, nested id/name-like fields after', () => {
    const mapping = inferOperationMapping(petstore.doc, group('pet'))
    expect(mapping.identifierCandidates).toEqual([
      { field: 'id', reason: "the get path's {petId} stands for it" },
      { field: 'name', reason: 'a conventional identifier in the get response' },
      { field: 'status', reason: 'a scalar field of the get response' },
      { field: 'category.id', reason: 'nested in the get response' },
      { field: 'category.name', reason: 'nested in the get response' },
    ])
    // Pet is both the create body and the get response: nothing is server-assigned by the schema.
    expect(mapping.statusFieldCandidates).toEqual([])
  })

  it('pet: {petId} is read from STATUS — the create response returns id, and the create body does not require it', () => {
    const mapping = inferOperationMapping(petstore.doc, group('pet'))
    expect(mapping.fieldMappingSuggestions.map(({ action, alternatives, confirm, inCustomResource, inPath }) => ({ action, alternatives, confirm, inCustomResource, inPath }))).toEqual([
      { action: 'get', alternatives: [], confirm: null, inCustomResource: 'status.id', inPath: 'petId' },
      { action: 'delete', alternatives: [], confirm: null, inCustomResource: 'status.id', inPath: 'petId' },
    ])
    expect(mapping.fieldMappingSuggestions[0].reason).toBe('the create response returns id — the server assigns the id, so it is read from status')
    // category.id is a related object's id: the shallowest field named id wins, so nothing is ambiguous.
    expect(mapping.boundStatusFields).toEqual(['id'])
  })

  it('pet: an override settles the conflict; omit drops a verb; a bad override is named', () => {
    const settled = inferOperationMapping(petstore.doc, group('pet'), [
      { action: 'findby', method: 'get', path: '/pet/findByStatus' },
      { action: 'update', method: 'POST', path: '/pet/{petId}' },
      { action: 'delete', omit: true },
      { action: 'create', method: 'POST', path: '/pets' },
    ])
    expect(settled.conflicts).toEqual([])
    expect(verbTable(settled)).toEqual({
      create: 'POST /pet',
      findby: 'GET /pet/findByStatus',
      get: 'GET /pet/{petId}',
      update: 'POST /pet/{petId}',
    })
    expect(settled.verbs.findby?.reason).toBe('override')
    expect(settled.overrideErrors).toEqual(['the create override names POST /pets, which is not one of the selected operations'])
    expect(settled.fieldMappingSuggestions.map((suggestion) => suggestion.action)).toEqual(['get', 'update'])
    // An override is how petstore's PUT /pet becomes the update.
    expect(verbTable(inferOperationMapping(petstore.doc, group('pet'), [{ action: 'update', method: 'PUT', path: '/pet' }])).update).toBe('PUT /pet')
  })

  it('store and user: what the path shapes say, conflicts included', () => {
    const store = inferOperationMapping(petstore.doc, group('store'))
    expect(verbTable(store)).toEqual({
      create: 'POST /store/order',
      delete: 'DELETE /store/order/{orderId}',
      findby: 'GET /store/inventory',
      get: 'GET /store/order/{orderId}',
    })
    expect(store.conflicts).toEqual([])
    expect(fields(store.identifierCandidates).slice(0, 2)).toEqual(['id', 'petId'])
    expect(store.fieldMappingSuggestions.map((suggestion) => `${suggestion.action}:${suggestion.inPath}→${suggestion.inCustomResource}`))
      .toEqual(['get:orderId→status.id', 'delete:orderId→status.id'])

    const user = inferOperationMapping(petstore.doc, group('user'))
    expect(verbTable(user)).toEqual({
      create: 'POST /user',
      delete: 'DELETE /user/{username}',
      get: 'GET /user/{username}',
      update: 'PUT /user/{username}',
    })
    // Round 2: a literal segment under the collection is an ACTION — create is POST to exactly /user,
    // and login / logout are not a findby. What used to be two conflicts is no conflict at all.
    expect(user.conflicts).toEqual([])
    expect(user.unmapped.map((entry) => `${entry.key} (${entry.category})`)).toEqual([
      'POST /user/createWithList (action)',
      'GET /user/login (action)',
      'GET /user/logout (action)',
    ])
    // {username} is a field the create body sends: the person chooses it, so it needs no fieldMapping
    // and is the first identifier.
    expect(fields(user.identifierCandidates)[0]).toBe('username')
    expect(user.fieldMappingSuggestions).toEqual([])
  })
})

describe('inferOperationMapping — github-provider-kog (the live RestDefinitions are the answer key)', () => {
  it('Label: the four verbs, identifier name, and the live additionalStatusFields exactly', () => {
    const label = load('github-kog-label.oas.yaml')
    const mapping = inferOperationMapping(label.doc, label.operations)
    expect(verbTable(mapping)).toEqual({
      create: 'POST /repos/{owner}/{repo}/labels',
      delete: 'DELETE /repos/{owner}/{repo}/labels/{name}',
      get: 'GET /repos/{owner}/{repo}/labels/{name}',
      update: 'PATCH /repos/{owner}/{repo}/labels/{name}',
    })
    expect(mapping.conflicts).toEqual([])
    expect(mapping.unmapped).toEqual([])
    expect(mapping.identifierCandidates[0]).toEqual({ field: 'name', reason: 'the get path addresses it as {name}' })
    // github-provider-kog-label on krateo-057: additionalStatusFields [id, node_id, url, default].
    expect(fields(mapping.statusFieldCandidates)).toEqual(['id', 'node_id', 'url', 'default'])
    expect(mapping.fieldMappingSuggestions).toEqual([])
  })

  it('Repository: create is org-scoped, get/update address the repo; identifier name', () => {
    const repository = load('github-kog-repository.oas.yaml')
    const mapping = inferOperationMapping(repository.doc, repository.operations)
    expect(verbTable(mapping)).toEqual({
      create: 'POST /orgs/{org}/repos',
      get: 'GET /repos/{org}/{name}',
      update: 'PATCH /repos/{org}/{name}',
    })
    expect(mapping.identifierCandidates[0].field).toBe('name')
    // Live: [id, node_id, full_name, html_url, clone_url, ssh_url, default_branch] — all candidates;
    // `archived` is one too (create never sends it), and the author left it out.
    expect(fields(mapping.statusFieldCandidates)).toEqual(['id', 'node_id', 'full_name', 'html_url', 'clone_url', 'ssh_url', 'default_branch', 'archived'])
  })
})

describe('inferOperationMapping — an Aruba-like provider (constructed fixtures, round 2)', () => {
  const dbaas = load('aruba-like-dbaas.oas.yaml')
  const kms = load('aruba-like-kms.oas.yaml')
  const base = '/projects/{projectId}/providers/Aruba.Database/dbaas'

  it('create is POST to exactly the collection; update PUT to exactly the item; poweron and password are ACTIONS', () => {
    const mapping = inferOperationMapping(dbaas.doc, dbaas.operations)
    expect(verbTable(mapping)).toEqual({
      create: `POST ${base}`,
      delete: `DELETE ${base}/{id}`,
      findby: `GET ${base}`,
      get: `GET ${base}/{dbaasId}`,
      update: `PUT ${base}/{dbaasId}`,
    })
    expect(mapping.conflicts).toEqual([])
    expect(mapping.unmapped.map((entry) => ({ category: entry.category, key: entry.key, reason: entry.reason }))).toEqual([
      { category: 'action', key: `POST ${base}/{dbaasId}/poweron`, reason: `an action on the item ${base}/{dbaasId}, not a lifecycle verb` },
      // A PUT on a sub-path of the item is an action too — never the update.
      { category: 'action', key: `PUT ${base}/{dbaasId}/password`, reason: `an action on the item ${base}/{dbaasId}, not a lifecycle verb` },
    ])
  })

  it('the id the create returns NESTED (metadata.id) is read from status, as a leaf — and {projectId} stays a spec scope', () => {
    const mapping = inferOperationMapping(dbaas.doc, dbaas.operations)
    const bound = mapping.fieldMappingSuggestions.map((entry) => `${entry.action}:${entry.inPath}→${entry.inCustomResource}`)
    expect(bound).toEqual(['get:dbaasId→status.metadata.id', 'update:dbaasId→status.metadata.id', 'delete:id→status.metadata.id'])
    expect(bound.some((entry) => entry.includes('projectId'))).toBe(false)
    expect(mapping.boundStatusFields).toEqual(['metadata.id'])
  })

  it('{dbaasId} and {id} name one segment: treated as one identifier and flagged for confirm', () => {
    const mapping = inferOperationMapping(dbaas.doc, dbaas.operations)
    expect(mapping.paramAliases.map((alias) => alias.names)).toEqual([['dbaasId', 'id']])
    expect(mapping.fieldMappingSuggestions.every((entry) => entry.confirm === mapping.paramAliases[0].sentence)).toBe(true)
  })

  it('nested identifiers and status fields reach the pickers (metadata.id, metadata.name; a readOnly metadata.uri)', () => {
    const mapping = inferOperationMapping(dbaas.doc, dbaas.operations)
    expect(fields(mapping.identifierCandidates)).toEqual(['metadata.id', 'metadata.name'])
    expect(fields(mapping.statusFieldCandidates)).toEqual(['status', 'metadata.id', 'metadata.uri'])
  })

  it('keyId vs id: the create response carries both, so the binding is suggested and waits for a confirm', () => {
    const mapping = inferOperationMapping(kms.doc, kms.operations)
    expect(verbTable(mapping)).toEqual({ create: 'POST /kms/{kmsId}/keys', delete: 'DELETE /kms/{kmsId}/keys/{keyId}', findby: 'GET /kms/{kmsId}/keys' })
    expect(mapping.fieldMappingSuggestions).toEqual([{
      action: 'delete',
      alternatives: ['status.id'],
      confirm: '{keyId} could be keyId or id — keyId is suggested; confirm it or choose another.',
      inCustomResource: 'status.keyId',
      inPath: 'keyId',
      reason: 'the create response returns keyId — the server assigns the id, so it is read from status',
    }])
  })

  it('no get: status comes from one findby item — none until itemsPath names the envelope\'s collection', () => {
    expect(inferOperationMapping(kms.doc, kms.operations).identifierCandidates).toEqual([])
    const withItems = inferOperationMapping(kms.doc, kms.operations, [], '.data')
    expect(fields(withItems.identifierCandidates)).toEqual(['id', 'name', 'keyId', 'algorithm', 'status', 'user.username'])
    expect(withItems.identifierCandidates[0].reason).toBe('a conventional identifier in the findby item')
  })

  it('a user-chosen id stays spec-sourced: the create body names the parameter itself', () => {
    const doc = JSON.parse(JSON.stringify(kms.doc)) as typeof kms.doc
    const { post } = (doc.paths as Record<string, Record<string, Record<string, unknown>>>)['/kms/{kmsId}/keys']
    post.requestBody = { content: { 'application/json': { schema: { properties: { keyId: { type: 'string' }, name: { type: 'string' } }, required: ['keyId', 'name'], type: 'object' } } } }
    // spec carries {keyId} by name, so no fieldMapping at all.
    expect(inferOperationMapping(doc, kms.operations).fieldMappingSuggestions).toEqual([])
  })

  it('a user-chosen id stays spec-sourced: the create body REQUIRES the field the parameter stands for', () => {
    const doc = JSON.parse(JSON.stringify(kms.doc)) as typeof kms.doc
    const { post } = (doc.paths as Record<string, Record<string, Record<string, unknown>>>)['/kms/{kmsId}/keys']
    post.requestBody = { content: { 'application/json': { schema: { properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id', 'name'], type: 'object' } } } }
    const [suggestion] = inferOperationMapping(doc, kms.operations).fieldMappingSuggestions
    expect(suggestion.inCustomResource).toBe('status.keyId')
    expect(suggestion.alternatives).toEqual(['status.id'])
    const required = JSON.parse(JSON.stringify(doc)) as typeof kms.doc
    const keySchema = ((required.components as Record<string, Record<string, Record<string, Record<string, unknown>>>>).schemas.Key.properties)
    Reflect.deleteProperty(keySchema, 'keyId')
    const [chosen] = inferOperationMapping(required, kms.operations).fieldMappingSuggestions
    expect(chosen.inCustomResource).toBe('spec.id')
    expect(chosen.reason).toBe('the create body requires id: the person chooses the id, so it is read from spec')
  })
})

describe('findbyItemSchema — the envelope, as oasgen reads it', () => {
  const kms = load('aruba-like-kms.oas.yaml')
  const dbaas = load('aruba-like-dbaas.oas.yaml')
  const response = (oas: OasImport, path: string) => successResponseSchema(oas.doc, 'GET', path)

  it('two arrays and no itemsPath is refused, with the candidates named; itemsPath picks one; a wrong one is said', () => {
    const keys = response(kms, '/kms/{kmsId}/keys')
    expect(envelopeArrays(kms.doc, keys)).toEqual(['data', 'included'])
    const refused = findbyItemSchema(kms.doc, keys)
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.reason).toBe('the findby response is an envelope with 2 array properties (data, included), and oasgen refuses to guess which holds the collection — set itemsPath')
    expect(findbyItemSchema(kms.doc, keys, '.data')).toMatchObject({ ok: true, via: 'itemsPath' })
    expect(findbyItemSchema(kms.doc, keys, 'data')).toMatchObject({ ok: true, via: 'itemsPath' })
    expect(findbyItemSchema(kms.doc, keys, '.links')).toMatchObject({ ok: false, reason: 'itemsPath .links names links, which is not a property of the findby response' })
  })

  it('one array is unambiguous', () => {
    expect(findbyItemSchema(dbaas.doc, response(dbaas, '/projects/{projectId}/providers/Aruba.Database/dbaas'))).toMatchObject({ ok: true, via: 'envelope' })
  })
})
