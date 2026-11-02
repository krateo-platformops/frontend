import type { JSONSchema4 } from 'json-schema'
import { describe, expect, it } from 'vitest'

import { changedPaths, collectDependencies, dependentsToClear, nodeAt, parseDependsOn, resolveFieldPath, templateKey } from './fieldDependencies'
import { OPTIONS_KEY } from './fieldKeys'

const options = (ref: string, field?: string, param = 'p') => ({ ref, ...(field ? { dependsOn: { field, param } } : {}) })

/* eslint-disable sort-keys/sort-keys-fix */
const SCHEMA: JSONSchema4 = {
  type: 'object',
  properties: {
    region: { type: 'string', [OPTIONS_KEY]: options('regions') },
    zone: { type: 'string', [OPTIONS_KEY]: options('zones', 'region') },
    subnet: { type: 'string', [OPTIONS_KEY]: options('subnets', 'zone') },
    hosts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cluster: { type: 'string' },
          node: { type: 'string', [OPTIONS_KEY]: options('nodes', 'cluster') },
          pool: { type: 'string', [OPTIONS_KEY]: options('pools', '/region') },
        },
      },
    },
  },
}
/* eslint-enable sort-keys/sort-keys-fix */

describe('resolveFieldPath', () => {
  it('is relative to the object holding the field, absolute with a leading slash', () => {
    expect(resolveFieldPath('region', ['spec'])).toEqual(['spec', 'region'])
    expect(resolveFieldPath('net.region', ['hosts', 0])).toEqual(['hosts', 0, 'net', 'region'])
    expect(resolveFieldPath('/spec.region', ['hosts', 0])).toEqual(['spec', 'region'])
  })

  it('reads the row of the field from an absolute reference into its own list', () => {
    expect(resolveFieldPath('/hosts.[].region', ['hosts', 2])).toEqual(['hosts', 2, 'region'])
    expect(resolveFieldPath('/hosts.[].region', ['hosts', 2, 'net'])).toEqual(['hosts', 2, 'region'])
    expect(resolveFieldPath('/hosts.[].region', ['hosts', '[]'])).toEqual(['hosts', '[]', 'region'])
    // another list: no row to take
    expect(resolveFieldPath('/pools.[].region', ['hosts', 2])).toEqual(['pools', '[]', 'region'])
  })
})

describe('parseDependsOn', () => {
  it('accepts { field, param }', () => {
    expect(parseDependsOn({ field: 'region', param: 'region' })).toEqual({ dependsOn: { field: 'region', param: 'region' } })
    expect(parseDependsOn(undefined)).toEqual({})
  })

  it('refuses an identity name as the param', () => {
    expect(parseDependsOn({ field: 'owner', param: 'username' }).problem).toContain('identity')
    expect(parseDependsOn({ field: 'g', param: 'groups' }).problem).toContain('identity')
  })

  it('refuses a malformed spec', () => {
    expect(parseDependsOn('region').problem).toBeTruthy()
    expect(parseDependsOn({ field: '', param: 'p' }).problem).toBeTruthy()
    expect(parseDependsOn({ field: 'a', param: 'not a name' }).problem).toBeTruthy()
  })
})

describe('nodeAt', () => {
  it('walks properties and list items', () => {
    expect(nodeAt(SCHEMA, ['hosts', 3, 'cluster'])).toEqual({ type: 'string' })
    expect(nodeAt(SCHEMA, ['nope'])).toBeUndefined()
  })
})

describe('collectDependencies', () => {
  it('collects every dependsOn as template paths, rows included', () => {
    expect(collectDependencies(SCHEMA).dependencies).toEqual([
      { child: ['zone'], parent: ['region'] },
      { child: ['subnet'], parent: ['zone'] },
      { child: ['hosts', '[]', 'node'], parent: ['hosts', '[]', 'cluster'] },
      { child: ['hosts', '[]', 'pool'], parent: ['region'] },
    ])
  })

  it('marks the fields caught in a cycle', () => {
    const { cyclic } = collectDependencies({
      properties: {
        a: { [OPTIONS_KEY]: options('r', 'b') },
        b: { [OPTIONS_KEY]: options('r', 'a') },
        c: { [OPTIONS_KEY]: options('r', 'a') },
      },
    })
    expect([...cyclic].sort()).toEqual([templateKey(['a']), templateKey(['b'])])
  })
})

describe('changedPaths', () => {
  it('reads antd changedValues as leaf paths, a whole list as itself', () => {
    expect(changedPaths({ spec: { region: 'eu' } })).toEqual([['spec', 'region']])
    // eslint-disable-next-line no-sparse-arrays
    expect(changedPaths({ hosts: [, { cluster: 'c2' }] })).toEqual([['hosts'], ['hosts', 1, 'cluster']])
  })
})

describe('dependentsToClear', () => {
  const { dependencies } = collectDependencies(SCHEMA)
  const values: Record<string, unknown> = {
    hosts: [{ cluster: 'c1', node: 'n1', pool: 'p1' }, { cluster: 'c2', node: 'n2', pool: 'p2' }],
    region: 'eu',
    subnet: 's1',
    zone: 'z1',
  }
  const get = (path: Array<string | number>): unknown =>
    path.reduce<unknown>((at, key) => (at && typeof at === 'object' ? (at as Record<string | number, unknown>)[key] : undefined), values)

  it('clears the chain below the changed field, every row that reads it included', () => {
    expect(dependentsToClear(dependencies, { region: 'us' }, get)).toEqual([
      ['zone'], ['hosts', 0, 'pool'], ['hosts', 1, 'pool'], ['subnet'],
    ])
  })

  it('in a row, clears only that row\'s dependent', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(dependentsToClear(dependencies, { hosts: [, { cluster: 'c9' }] }, get)).toEqual([['hosts', 1, 'node']])
  })

  it('clears nothing for a field nothing depends on', () => {
    expect(dependentsToClear(dependencies, { subnet: 's2' }, get)).toEqual([])
  })

  it('terminates on a cycle', () => {
    const cycle = collectDependencies({
      properties: { a: { [OPTIONS_KEY]: options('r', 'b') }, b: { [OPTIONS_KEY]: options('r', 'a') } },
    }).dependencies
    expect(dependentsToClear(cycle, { a: 1 }, () => 'x')).toEqual([['b']])
  })
})
