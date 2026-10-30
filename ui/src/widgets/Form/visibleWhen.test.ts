import type { JSONSchema4 } from 'json-schema'
import { describe, expect, it } from 'vitest'

import { hiddenPaths, isVisible, omitPaths } from './visibleWhen'

const when = (rule: unknown): JSONSchema4 => ({ displayDependency: rule, type: 'string' })

describe('isVisible', () => {
  const values = { service: { ports: [80], type: 'NodePort' }, tier: 'gold' }

  it('is visible without a rule', () => {
    expect(isVisible({ type: 'string' }, values, [])).toBe(true)
  })

  it('reads value, in and notEmpty, relative to the object holding the field', () => {
    expect(isVisible(when({ conditionType: 'value', dependsOn: { name: 'type' }, value: 'NodePort' }), values, ['service'])).toBe(true)
    expect(isVisible(when({ conditionType: 'value', dependsOn: { name: 'type' }, value: 'ClusterIP' }), values, ['service'])).toBe(false)
    expect(isVisible(when({ conditionType: 'in', dependsOn: { name: 'type' }, values: ['LoadBalancer', 'NodePort'] }), values, ['service'])).toBe(true)
    expect(isVisible(when({ conditionType: 'notEmpty', dependsOn: { name: 'ports' } }), values, ['service'])).toBe(true)
    expect(isVisible(when({ conditionType: 'notEmpty', dependsOn: { name: 'missing' } }), values, ['service'])).toBe(false)
  })

  it('reads an absolute field and compares objects by value', () => {
    expect(isVisible(when({ conditionType: 'value', dependsOn: { name: '/tier' }, value: 'gold' }), values, ['service'])).toBe(true)
    expect(isVisible(when({ conditionType: 'value', dependsOn: { name: 'ports' }, value: [80] }), values, ['service'])).toBe(true)
  })

  it('holds a list of conditions when every one does', () => {
    expect(isVisible(when([{ conditionType: 'value', dependsOn: { name: '/tier' }, value: 'gold' }, { conditionType: 'value', dependsOn: { name: 'type' }, value: 'NodePort' }]), values, ['service'])).toBe(true)
    expect(isVisible(when([{ conditionType: 'value', dependsOn: { name: '/tier' }, value: 'gold' }, { conditionType: 'value', dependsOn: { name: 'type' }, value: 'x' }]), values, ['service'])).toBe(false)
  })

  it('leaves a field visible when its rule cannot be read', () => {
    expect(isVisible(when('NodePort'), values, [])).toBe(true)
    expect(isVisible(when({ dependsOn: { name: 'type' } }), values, ['service'])).toBe(true)
    expect(isVisible(when([]), values, [])).toBe(true)
    expect(isVisible(when([{ conditionType: 'value', dependsOn: { name: 'a' }, value: 1 }, 'bad']), values, [])).toBe(true)
  })
})

/* eslint-disable sort-keys/sort-keys-fix */
const SCHEMA: JSONSchema4 = {
  properties: {
    type: { enum: ['ClusterIP', 'NodePort'], type: 'string' },
    nodePort: when({ conditionType: 'value', dependsOn: { name: 'type' }, value: 'NodePort' }),
    hosts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { tls: { type: 'boolean' }, secretName: when({ conditionType: 'value', dependsOn: { name: 'tls' }, value: true }) },
      },
    },
  },
}
/* eslint-enable sort-keys/sort-keys-fix */

describe('hiddenPaths / omitPaths', () => {
  const values = { hosts: [{ secretName: 'a', tls: true }, { secretName: 'b', tls: false }], nodePort: 30001, type: 'ClusterIP' }

  it('finds the hidden fields, list rows included', () => {
    expect(hiddenPaths(SCHEMA, values)).toEqual([['nodePort'], ['hosts', 1, 'secretName']])
  })

  it('drops them from a copy', () => {
    expect(omitPaths(values, hiddenPaths(SCHEMA, values))).toEqual({ hosts: [{ secretName: 'a', tls: true }, { tls: false }], type: 'ClusterIP' })
    expect(values.nodePort).toBe(30001)
  })
})
