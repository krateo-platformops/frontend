import { describe, expect, it } from 'vitest'

import {
  DRAFT_RECORD_KEY,
  draftOwner,
  draftRecordConfigMap,
  draftRecordName,
  LABEL_OWNER,
  LABEL_PURPOSE,
  readDraftRecord,
  treeHash,
  type DraftRecordBody,
} from './draftRecord'

const body: DraftRecordBody = {
  files: { 'Chart.yaml': 'apiVersion: v2\nname: catalog-service\nversion: 0.1.0\n', 'values.yaml': '{}\n' },
  kind: 'blueprint',
  name: 'catalog-service',
  state: 'open',
  updatedAt: '2026-09-29T12:04:00Z',
  version: 1,
}

describe('draftOwner', () => {
  it('is a DNS-label-safe owner, the same rule the portal jq applies', () => {
    expect(draftOwner('admin')).toBe('admin')
    expect(draftOwner('Diego.Braga@krateo.io')).toBe('diego-braga-krateo-io')
    expect(draftOwner('--weird__name--')).toBe('weird-name')
    expect(draftOwner('x'.repeat(60))).toHaveLength(40)
  })

  it('is unknown with no username', () => {
    expect(draftOwner(undefined)).toBe('unknown')
    expect(draftOwner('___')).toBe('unknown')
  })
})

describe('draftRecordName', () => {
  it('is draft-<kind>-<owner>-<slug>, within 63 characters, never ending in -', () => {
    expect(draftRecordName('blueprint', 'admin', 'catalog-service')).toBe('draft-blueprint-admin-catalog-service')
    const long = draftRecordName('page', 'a'.repeat(40), 'b'.repeat(40))
    expect(long.length).toBeLessThanOrEqual(63)
    expect(long).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/)
  })
})

describe('treeHash', () => {
  it('is equal for equal trees, whatever the key order, and differs on any edit', () => {
    const same = treeHash({ 'Chart.yaml': body.files['Chart.yaml'], 'values.yaml': '{}\n' })
    expect(treeHash(body.files)).toBe(same)
    expect(treeHash({ ...body.files, 'values.yaml': 'a: 1\n' })).not.toBe(same)
    expect(treeHash(body.files)).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('the record ConfigMap', () => {
  it('round-trips through draftRecordConfigMap and readDraftRecord', () => {
    const cm = draftRecordConfigMap('krateo-preview', 'admin', body) as { metadata: { name: string; labels: Record<string, string> } }
    expect(cm.metadata.name).toBe('draft-blueprint-admin-catalog-service')
    expect(cm.metadata.labels[LABEL_PURPOSE]).toBe('draft-record')
    expect(cm.metadata.labels[LABEL_OWNER]).toBe('admin')
    expect(readDraftRecord(cm)).toEqual(body)
  })

  it('reads anything that is not a restorable record as null, never a throw', () => {
    expect(readDraftRecord(null)).toBeNull()
    expect(readDraftRecord({ data: {} })).toBeNull()
    expect(readDraftRecord({ data: { [DRAFT_RECORD_KEY]: '{not json' } })).toBeNull()
    expect(readDraftRecord({ data: { [DRAFT_RECORD_KEY]: JSON.stringify({ ...body, version: 2 }) } })).toBeNull()
    expect(readDraftRecord({ data: { [DRAFT_RECORD_KEY]: JSON.stringify({ ...body, files: { a: 1 } }) } })).toBeNull()
  })
})
