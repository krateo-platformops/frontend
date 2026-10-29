import type { JSONSchema4 } from 'json-schema'
import { describe, expect, it } from 'vitest'

import { hiddenPaths, isVisible, omitPaths } from './visibleWhen'

const when = (rule: unknown): JSONSchema4 => ({ type: 'string', 'x-krateo-visible-when': rule })

describe('isVisible', () => {
  const values = { service: { ports: [80], type: 'NodePort' }, tier: 'gold' }

  it('is visible without a rule', () => {
    expect(isVisible({ type: 'string' }, values, [])).toBe(true)
  })

  it('reads equals, in and notEmpty, relative to the object holding the field', () => {
    expect(isVisible(when({ equals: 'NodePort', field: 'type' }), values, ['service'])).toBe(true)
    expect(isVisible(when({ equals: 'ClusterIP', field: 'type' }), values, ['service'])).toBe(false)
    expect(isVisible(when({ field: 'type', in: ['LoadBalancer', 'NodePort'] }), values, ['service'])).toBe(true)
    expect(isVisible(when({ field: 'ports', notEmpty: true }), values, ['service'])).toBe(true)
    expect(isVisible(when({ field: 'missing', notEmpty: true }), values, ['service'])).toBe(false)
  })

  it('reads an absolute field and compares objects by value', () => {
    expect(isVisible(when({ equals: 'gold', field: '/tier' }), values, ['service'])).toBe(true)
    expect(isVisible(when({ equals: [80], field: 'ports' }), values, ['service'])).toBe(true)
  })

  it('combines rules with all', () => {
    expect(isVisible(when({ all: [{ equals: 'gold', field: '/tier' }, { equals: 'NodePort', field: 'type' }] }), values, ['service'])).toBe(true)
    expect(isVisible(when({ all: [{ equals: 'gold', field: '/tier' }, { equals: 'x', field: 'type' }] }), values, ['service'])).toBe(false)
  })

  it('leaves a field visible when its rule cannot be read', () => {
    expect(isVisible(when('NodePort'), values, [])).toBe(true)
    expect(isVisible(when({ field: 'type' }), values, ['service'])).toBe(true)
    expect(isVisible(when({ all: [] }), values, [])).toBe(true)
    expect(isVisible(when({ all: [{ equals: 1, field: 'a' }, 'bad'] }), values, [])).toBe(true)
  })
})

/* eslint-disable sort-keys/sort-keys-fix */
const SCHEMA: JSONSchema4 = {
  properties: {
    type: { enum: ['ClusterIP', 'NodePort'], type: 'string' },
    nodePort: when({ equals: 'NodePort', field: 'type' }),
    hosts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { tls: { type: 'boolean' }, secretName: when({ equals: true, field: 'tls' }) },
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
