import type { JSONSchema4 } from 'json-schema'
import { describe, expect, it } from 'vitest'

import { changedPaths, collectDependencies, dependentsToClear, nodeAt, parseDependsOn, resolveFieldPath, templateKey } from './fieldDependencies'

const options = (ref: string, name?: string, key = 'p') => ({ autocomplete: { resourceRefId: ref }, ...(name ? { dependsOn: { extra: { key }, name } } : {}) })

/* eslint-disable sort-keys/sort-keys-fix */
const SCHEMA: JSONSchema4 = {
  type: 'object',
  properties: {
    region: { type: 'string', ...options('regions') },
    zone: { type: 'string', ...options('zones', 'region') },
    subnet: { type: 'string', ...options('subnets', 'zone') },
    hosts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cluster: { type: 'string' },
          node: { type: 'string', ...options('nodes', 'cluster') },
          pool: { type: 'string', ...options('pools', '/region') },
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
})

describe('parseDependsOn', () => {
  it('accepts { name, extra: { key } }', () => {
    expect(parseDependsOn({ extra: { key: 'region' }, name: 'region' })).toEqual({ dependsOn: { field: 'region', param: 'region' } })
    expect(parseDependsOn(undefined)).toEqual({})
  })

  it('refuses an identity name as the param', () => {
    expect(parseDependsOn({ extra: { key: 'username' }, name: 'owner' }).problem).toContain('identity')
    expect(parseDependsOn({ extra: { key: 'groups' }, name: 'g' }).problem).toContain('identity')
  })

  it('refuses a malformed spec', () => {
    expect(parseDependsOn('region').problem).toBeTruthy()
    expect(parseDependsOn({ name: 'a' }).problem).toBeTruthy()
    expect(parseDependsOn({ extra: { key: 'p' }, name: '' }).problem).toBeTruthy()
    expect(parseDependsOn({ extra: { key: 'not a name' }, name: 'a' }).problem).toBeTruthy()
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
        a: options('r', 'b'),
        b: options('r', 'a'),
        c: options('r', 'a'),
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
      properties: { a: options('r', 'b'), b: options('r', 'a') },
    }).dependencies
    expect(dependentsToClear(cycle, { a: 1 }, () => 'x')).toEqual([['b']])
  })
})

describe('collectDependencies — dependsOn without autocomplete', () => {
  it('ignores a dependsOn with no autocomplete beside it', () => {
    expect(collectDependencies({ properties: { zone: { dependsOn: { extra: { key: 'r' }, name: 'region' } } } }).dependencies).toEqual([])
  })
})
