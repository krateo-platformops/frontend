import { afterEach, describe, expect, it, vi } from 'vitest'

import { countNoun, getCallReadQuery, getExportEndpoint, getResourceEndpoint, randomId } from './utils'

describe('countNoun', () => {
  it('keeps the singular for exactly one', () => {
    expect(countNoun(1, 'write')).toBe('1 write')
  })

  it('pluralises zero and many', () => {
    expect(countNoun(0, 'write')).toBe('0 writes')
    expect(countNoun(2, 'write')).toBe('2 writes')
  })

  it('takes an irregular plural', () => {
    expect(countNoun(1, 'branch', 'branches')).toBe('1 branch')
    expect(countNoun(3, 'branch', 'branches')).toBe('3 branches')
  })
})

/** RFC-4122 v4: 8-4-4-4-12 hex, version nibble '4', variant nibble in [89ab]. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('randomId', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a valid v4 UUID in a secure context (crypto.randomUUID present)', () => {
    expect(randomId()).toMatch(UUID_V4)
  })

  it('falls back to getRandomValues in an INSECURE context (http://<LB-IP>, no crypto.randomUUID)', () => {
    // The bug this guards: crypto.randomUUID is undefined over plain http on a bare IP,
    // which crashed the whole portal. getRandomValues IS available there, so we use it.
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) { arr[i] = (i * 37 + 11) & 0xff }
        return arr
      },
    })
    expect(randomId()).toMatch(UUID_V4)
  })

  it('falls back to Math.random when no Web Crypto exists at all', () => {
    vi.stubGlobal('crypto', undefined)
    expect(randomId()).toMatch(UUID_V4)
  })

  it('produces distinct ids across many calls', () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomId()))
    expect(ids.size).toBe(200)
  })
})

/**
 * #528. getResourceEndpoint builds a `/call` path too, and had the same unconditional
 * interpolation: an absent namespace became the literal `namespace=undefined`. snowplow
 * reads an ABSENT namespace as cluster-scoped (#156), so the param is omitted.
 */
describe('getResourceEndpoint — a cluster-scoped target omits namespace (#528)', () => {
  it('omits the param when there is no namespace', () => {
    expect(getResourceEndpoint({ apiVersion: 'kyverno.io/v1', name: 'require-tags', resource: 'clusterpolicies' }))
      .toBe('/call?resource=clusterpolicies&apiVersion=kyverno.io/v1&name=require-tags')
  })

  it('omits it for an empty string as well', () => {
    expect(getResourceEndpoint({ apiVersion: 'v1', name: 'node-1', namespace: '', resource: 'nodes' }))
      .not.toContain('namespace')
  })

  it('still sends it for a namespaced target', () => {
    expect(getResourceEndpoint({ apiVersion: 'v1', name: 'cm', namespace: 'krateo-system', resource: 'configmaps' }))
      .toBe('/call?resource=configmaps&apiVersion=v1&name=cm&namespace=krateo-system')
  })
})

/**
 * snowplow's export is `POST /export`, a sibling of `/call` — a POST to `/call` is the write
 * passthrough. The export carries the read's own query untouched, then the export query.
 */
describe('getExportEndpoint — a /call read exported on /export', () => {
  const read = getResourceEndpoint({ apiVersion: 'widgets.templates.krateo.io/v1beta1', name: 'pods', namespace: 'krateo-system', resource: 'tables' })

  it('takes the query of a /call read, verbatim', () => {
    expect(getCallReadQuery(read)).toBe('resource=tables&apiVersion=widgets.templates.krateo.io/v1beta1&name=pods&namespace=krateo-system')
  })

  it('has no read query for anything that is not a /call read', () => {
    expect(getCallReadQuery('/call/read?resource=tables')).toBeNull()
    expect(getCallReadQuery('/api-info/names?category=widgets')).toBeNull()
    expect(getCallReadQuery('/callx?resource=tables')).toBeNull()
  })

  it('reads a bare /call as an empty query', () => {
    expect(getCallReadQuery('/call')).toBe('')
  })

  it('puts the read query, then the export query, on /export', () => {
    expect(getExportEndpoint(getCallReadQuery(read)!, 'format=csv&fields=name'))
      .toBe('/export?resource=tables&apiVersion=widgets.templates.krateo.io/v1beta1&name=pods&namespace=krateo-system&format=csv&fields=name')
  })

  it('drops the read\'s page window and keeps every other param byte-for-byte', () => {
    expect(getExportEndpoint('resource=tables&page=2&apiVersion=a%2Fb&perPage=5&name=pods&pageSize=9&namespace=ns', 'format=csv'))
      .toBe('/export?resource=tables&apiVersion=a%2Fb&name=pods&pageSize=9&namespace=ns&format=csv')
  })

  it('joins no stray separator when either side is empty', () => {
    expect(getExportEndpoint('', 'format=csv')).toBe('/export?format=csv')
    expect(getExportEndpoint('resource=tables', '')).toBe('/export?resource=tables')
    expect(getExportEndpoint('', '')).toBe('/export')
  })
})
