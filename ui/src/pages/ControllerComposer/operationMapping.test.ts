/**
 * operationMapping — the inference over the real petstore spec, and over two github-provider-kog
 * specs whose live RestDefinitions on krateo-057 are the answer key.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type OasImport, parseOas } from './oasImport'
import { inferOperationMapping, type OperationMapping } from './operationMapping'
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

  it('pet: infers create/get/update/delete, and leaves the two findBy* as a conflict', () => {
    const mapping = inferOperationMapping(petstore.doc, group('pet'))
    expect(verbTable(mapping)).toEqual({
      create: 'POST /pet',
      delete: 'DELETE /pet/{petId}',
      get: 'GET /pet/{petId}',
      update: 'PUT /pet',
    })
    expect(mapping.verbs.findby).toBeUndefined()
    expect(mapping.conflicts).toEqual([{
      action: 'findby',
      candidates: [
        expect.objectContaining({ method: 'GET', operationId: 'findPetsByStatus', path: '/pet/findByStatus', reason: 'GET on a findBy* path' }),
        expect.objectContaining({ method: 'GET', operationId: 'findPetsByTags', path: '/pet/findByTags', reason: 'GET on a findBy* path' }),
      ],
      sentence: '2 operations look like findby (GET /pet/findByStatus, GET /pet/findByTags) — choose one.',
    }])
    expect(mapping.unmapped).toEqual([
      { key: 'POST /pet/{petId}', method: 'POST', path: '/pet/{petId}', reason: 'POST on an item path is neither a create nor an update by rule — map it with an override' },
      { key: 'POST /pet/{petId}/uploadImage', method: 'POST', path: '/pet/{petId}/uploadImage', reason: 'an action on the item /pet/{petId}, not a verb of the Kind' },
    ])
  })

  it('pet: identifiers come from the GET response, petId ↔ id first', () => {
    const mapping = inferOperationMapping(petstore.doc, group('pet'))
    expect(mapping.identifierCandidates).toEqual([
      { field: 'id', reason: "the get path's {petId} stands for it" },
      { field: 'name', reason: 'a conventional identifier in the get response' },
      { field: 'status', reason: 'a scalar field of the get response' },
    ])
    // Pet is both the create body and the get response: nothing is server-assigned by the schema.
    expect(mapping.statusFieldCandidates).toEqual([])
    expect(mapping.fieldMappingSuggestions.map(({ action, inCustomResource, inPath }) => ({ action, inCustomResource, inPath }))).toEqual([
      { action: 'get', inCustomResource: 'spec.id', inPath: 'petId' },
      { action: 'delete', inCustomResource: 'spec.id', inPath: 'petId' },
    ])
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
      .toEqual(['get:orderId→spec.id', 'delete:orderId→spec.id'])

    const user = inferOperationMapping(petstore.doc, group('user'))
    expect(verbTable(user)).toEqual({
      delete: 'DELETE /user/{username}',
      get: 'GET /user/{username}',
      update: 'PUT /user/{username}',
    })
    expect(user.conflicts.map((conflict) => conflict.sentence)).toEqual([
      '2 operations look like create (POST /user, POST /user/createWithList) — choose one.',
      '2 operations look like findby (GET /user/login, GET /user/logout) — choose one.',
    ])
    // {username} IS a response field, so it needs no fieldMapping and is the first identifier.
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
