/**
 * The controller palette — the real petstore spec, grouped by resource group.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseOas, type OasOperation } from './oasImport'
import { buildControllerPalette, operationsInGroup } from './paletteModel'

const petstoreOperations = (): OasOperation[] => {
  const result = parseOas(readFileSync(join(__dirname, '__fixtures__', 'petstore-v3.openapi.json'), 'utf8'))
  if (!result.ok) { throw new Error(result.error) }
  return result.documents[0].operations
}

describe('buildControllerPalette', () => {
  const operations = petstoreOperations()

  it('groups the 19 petstore operations by first path segment', () => {
    const palette = buildControllerPalette(operations)
    expect(palette.operations).toBe(19)
    expect(palette.groups.map(({ group, operations: members, total }) => [group, total, members.length])).toEqual([
      ['pet', 8, 8],
      ['store', 4, 4],
      ['user', 7, 7],
    ])
    expect(palette.groups[0].operations.map((operation) => operation.key)).toEqual([
      'PUT /pet',
      'POST /pet',
      'GET /pet/findByStatus',
      'GET /pet/findByTags',
      'GET /pet/{petId}',
      'POST /pet/{petId}',
      'DELETE /pet/{petId}',
      'POST /pet/{petId}/uploadImage',
    ])
    expect(palette.nothingMatches).toBe(false)
  })

  it('filters by path, method, operationId or summary; a group-name match keeps the whole group', () => {
    const findBy = buildControllerPalette(operations, ' findBy ')
    expect(findBy.filter).toBe('findBy')
    expect(findBy.groups.map((group) => [group.group, group.total, group.operations.map((operation) => operation.path)])).toEqual([
      ['pet', 8, ['/pet/findByStatus', '/pet/findByTags']],
    ])
    // `store` names the store group (all 4) and appears in two pet summaries ("… to the store", "… in the store …").
    expect(buildControllerPalette(operations, 'store').groups.map((group) => [group.group, group.operations.map((operation) => operation.key)])).toEqual([
      ['pet', ['POST /pet', 'POST /pet/{petId}']],
      ['store', ['GET /store/inventory', 'POST /store/order', 'GET /store/order/{orderId}', 'DELETE /store/order/{orderId}']],
    ])
    expect(buildControllerPalette(operations, 'loginUser').groups.map((group) => group.operations.map((operation) => operation.key)))
      .toEqual([['GET /user/login']])
    expect(buildControllerPalette(operations, 'delete').groups.map((group) => group.operations.length)).toEqual([1, 1, 1])
  })

  it('says when nothing matches', () => {
    const palette = buildControllerPalette(operations, 'zebra')
    expect(palette.groups).toEqual([])
    expect(palette.nothingMatches).toBe(true)
  })

  it('files a root path under (root) and selects one group', () => {
    const palette = buildControllerPalette([
      { group: '(root)', key: 'GET /', method: 'GET', operationId: null, parameters: [], path: '/', summary: null },
      ...operations,
    ])
    expect(palette.groups[0].group).toBe('(root)')
    expect(operationsInGroup(operations, 'store').map((operation) => operation.key)).toEqual([
      'GET /store/inventory',
      'POST /store/order',
      'GET /store/order/{orderId}',
      'DELETE /store/order/{orderId}',
    ])
  })
})
