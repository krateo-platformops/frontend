/**
 * describeResource — CHECK THE LIVE CRD SCHEMA BEFORE GENERATING A CR:
 *   - gvr → CRD name (<plural>.<group>, core group => bare plural);
 *   - spec-field extraction from a fetched CRD (version pick, required set, int-or-string,
 *     kind from spec.names) with honest nulls when the schema is absent;
 *   - the drawer payload: real fields as summary lines, or the error AS content.
 */
import { describe, expect, it } from 'vitest'

import {
  buildDescribeResourcePayload,
  crdNameFromArgs,
  extractCrdSpecFields,
  parseDescribeResourceArgs,
  pickCrdVersion,
} from './describeResource'

/** A trimmed CRD like the live repocontents.github.krateo.io. */
const crd = {
  spec: {
    group: 'github.krateo.io',
    names: { kind: 'RepoContent', plural: 'repocontents' },
    versions: [
      {
        name: 'v1alpha1',
        schema: {
          openAPIV3Schema: {
            properties: {
              spec: {
                properties: {
                  configurationRef: { description: 'Auth Configuration ref.\nsecond line', type: 'object' },
                  content: { type: 'string' },
                  owner: { description: 'The repo owner.', type: 'string' },
                  path: { type: 'string' },
                  repo: { type: 'string' },
                  retries: { 'x-kubernetes-int-or-string': true },
                },
                required: ['owner', 'repo', 'path'],
                type: 'object',
              },
            },
          },
        },
        served: true,
        storage: true,
      },
    ],
  },
}

describe('parseDescribeResourceArgs + crdNameFromArgs', () => {
  it('parses a gvr and derives <plural>.<group>', () => {
    const args = parseDescribeResourceArgs({ gvr: { group: 'github.krateo.io', resource: 'repocontents', version: 'v1alpha1' } })
    expect(args).toEqual({ group: 'github.krateo.io', resource: 'repocontents', version: 'v1alpha1' })
    expect(crdNameFromArgs(args!)).toBe('repocontents.github.krateo.io')
  })

  it('handles the core group (bare plural) and rejects a missing resource', () => {
    expect(crdNameFromArgs({ group: '', resource: 'configmaps', version: 'v1' })).toBe('configmaps')
    expect(parseDescribeResourceArgs({ gvr: { group: 'x', version: 'v1' } })).toBeNull()
    expect(parseDescribeResourceArgs({})).toBeNull()
  })
})

describe('extractCrdSpecFields', () => {
  it('lists spec fields with types + required, from the storage version', () => {
    const out = extractCrdSpecFields(crd, 'v1alpha1')
    expect(out?.kind).toBe('RepoContent')
    const byName = Object.fromEntries((out?.fields ?? []).map((field) => [field.name, field]))
    expect(byName.owner).toEqual({ description: 'The repo owner.', name: 'owner', required: true, type: 'string' })
    expect(byName.path.required).toBe(true)
    expect(byName.content.required).toBe(false)
    expect(byName.configurationRef.type).toBe('object')
    expect(byName.retries.type).toBe('int-or-string')
  })

  it('falls back to storage/served/first when the version does not match', () => {
    expect(extractCrdSpecFields(crd, 'v9')?.kind).toBe('RepoContent')
  })

  it('falls back to a SERVED version before an unserved storage one — 38 of 46 composition CRDs on 057 store `vacuum`', () => {
    const version = (name: string, served: boolean, storage: boolean, field: string) =>
      ({ name, schema: { openAPIV3Schema: { properties: { spec: { properties: { [field]: { type: 'string' } }, type: 'object' } } } }, served, storage })
    const composition = { spec: { names: { kind: 'BuilderPublish' }, versions: [version('vacuum', false, true, 'stale'), version('v1-8-40', true, false, 'live')] } }
    expect(extractCrdSpecFields(composition)?.fields.map((field) => field.name)).toEqual(['live'])
    expect(pickCrdVersion(composition, 'v9')?.name).toBe('v1-8-40')
    expect(pickCrdVersion({ spec: { versions: [version('a', false, false, 'x'), version('b', true, true, 'y'), version('c', true, false, 'z')] } })?.name).toBe('b')
    expect(pickCrdVersion({ spec: { versions: [] } })).toBeNull()
  })

  it('returns null when there are no versions or no spec schema', () => {
    expect(extractCrdSpecFields({ spec: { versions: [] } })).toBeNull()
    expect(extractCrdSpecFields({ spec: { versions: [{ name: 'v1', schema: { openAPIV3Schema: { properties: {} } } }] } })).toBeNull()
    expect(extractCrdSpecFields(null)).toBeNull()
  })
})

describe('buildDescribeResourcePayload', () => {
  it('renders the real spec fields as summary lines with a generate-against-these caption', () => {
    const payload = buildDescribeResourcePayload('repocontents.github.krateo.io', extractCrdSpecFields(crd))
    expect(payload.title).toBe('CRD schema — RepoContent')
    expect(payload.caption).toContain('ONLY these spec fields')
    expect(payload.summary).toContain('spec.owner: string (required) — The repo owner.')
    expect(payload.summary).toContain('spec.configurationRef: object — Auth Configuration ref.')
    expect(payload.error).toBeUndefined()
  })

  it('renders a fetch/parse error AS the content', () => {
    const payload = buildDescribeResourcePayload('widgets.example.io', null, 'CRD widgets.example.io lookup responded 404')
    expect(payload.error).toContain('404')
    expect(payload.summary).toBeUndefined()
  })
})
