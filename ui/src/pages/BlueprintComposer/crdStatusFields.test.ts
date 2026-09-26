/**
 * What a custom resource can be waited on for: exactly the scalar fields its CRD types under
 * `status`, and the Ready condition only when it declares conditions — read at a SERVED version.
 */
import { describe, expect, it } from 'vitest'

import { CRDS } from './__fixtures__/s4a'
import { extractCrdStatusFields } from './crdStatusFields'

const schema = (status: Record<string, unknown> | null) => ({
  openAPIV3Schema: { properties: { spec: { type: 'object' }, ...(status ? { status: { properties: status, type: 'object' } } : {}) }, type: 'object' },
})

describe('extractCrdStatusFields', () => {
  it('Repository on krateo-057: its scalar status fields, in schema order, and it declares conditions', () => {
    expect(extractCrdStatusFields(CRDS['repositories.github.krateo.io'], 'v2022-11-28')).toEqual({
      conditions: true,
      fields: ['.status.clone_url', '.status.default_branch', '.status.full_name', '.status.html_url', '.status.id', '.status.name', '.status.node_id', '.status.ssh_url'],
    })
  })

  it('arrays are not fields; nested objects give their leaves, to depth three; names the grammar cannot say are left out', () => {
    const status = {
      atProvider: { properties: { arn: { type: 'string' }, deep: { properties: { deeper: { properties: { x: { type: 'string' } }, type: 'object' }, y: { type: 'integer' } }, type: 'object' } }, type: 'object' },
      'dashed-name': { type: 'string' },
      items: { type: 'array' },
      port: { 'x-kubernetes-int-or-string': true },
      ready: { type: 'boolean' },
    }
    const crd = { spec: { versions: [{ name: 'v1', schema: schema(status), served: true, storage: true }] } }
    expect(extractCrdStatusFields(crd, 'v1')).toEqual({ conditions: false, fields: ['.status.atProvider.arn', '.status.atProvider.deep.y', '.status.port', '.status.ready'] })
  })

  it('a served version is picked over an unserved storage version', () => {
    const crd = { spec: { versions: [
      { name: 'vacuum', schema: schema({ stale: { type: 'string' } }), served: false, storage: true },
      { name: 'v1-8-40', schema: schema({ conditions: { type: 'array' }, digest: { type: 'string' } }), served: true, storage: false },
    ] } }
    expect(extractCrdStatusFields(crd)).toEqual({ conditions: true, fields: ['.status.digest'] })
    expect(extractCrdStatusFields(crd, 'v1-8-40')).toEqual({ conditions: true, fields: ['.status.digest'] })
    // A composition CRD as 057 serves it: `vacuum` stored, never served.
    expect(extractCrdStatusFields(CRDS['builderpublishes.composition.krateo.io'])?.fields).toContain('.status.helmChartVersion')
  })

  it('no status schema: nothing to wait on — and no schema at all is null', () => {
    const crd = (status: Record<string, unknown> | null) => ({ spec: { versions: [{ name: 'v1', schema: schema(status), served: true, storage: true }] } })
    expect(extractCrdStatusFields(crd(null), 'v1')).toEqual({ conditions: false, fields: [] })
    expect(extractCrdStatusFields({ spec: { versions: [{ name: 'v1', served: true }] } }, 'v1')).toBeNull()
    expect(extractCrdStatusFields(null)).toBeNull()
  })
})
