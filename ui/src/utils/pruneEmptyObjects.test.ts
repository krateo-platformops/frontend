import { describe, expect, it } from 'vitest'

import { pruneEmptyObjects } from './pruneEmptyObjects'

describe('pruneEmptyObjects', () => {
  it('drops empty plain-object properties (empty k8s maps like affinity/nodeSelector)', () => {
    expect(pruneEmptyObjects({ affinity: {}, name: 'x', nodeSelector: {} })).toEqual({ name: 'x' })
  })

  it('keeps a populated oneOf branch and drops the empty sibling branches (probe corruption)', () => {
    expect(pruneEmptyObjects({ exec: {}, httpGet: { path: '/', port: 'http' }, tcpSocket: {} }))
      .toEqual({ httpGet: { path: '/', port: 'http' } })
  })

  it('collapses a parent object that becomes empty only after its children are pruned', () => {
    expect(pruneEmptyObjects({ probe: { exec: {}, tcpSocket: {} }, replicas: 1 })).toEqual({ replicas: 1 })
  })

  it('preserves empty arrays and the falsy scalars false / 0 / "" (they are meaningful values)', () => {
    expect(pruneEmptyObjects({ count: 0, enabled: false, list: [], note: '' }))
      .toEqual({ count: 0, enabled: false, list: [], note: '' })
  })

  it('preserves null (an explicit value, not an empty object)', () => {
    expect(pruneEmptyObjects({ a: null, b: {} })).toEqual({ a: null })
  })

  it('prunes empty-object properties inside array elements without removing the elements', () => {
    expect(pruneEmptyObjects({ containers: [{ livenessProbe: { exec: {}, httpGet: { path: '/' } }, name: 'c' }] }))
      .toEqual({ containers: [{ livenessProbe: { httpGet: { path: '/' } }, name: 'c' }] })
  })

  it('does not remove an empty-object array element (array length/order is preserved)', () => {
    expect(pruneEmptyObjects({ items: [{}, { a: 1 }] })).toEqual({ items: [{}, { a: 1 }] })
  })
})
