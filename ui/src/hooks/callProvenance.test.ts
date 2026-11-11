/**
 * callProvenance — the X-Krateo-Provenance header against snowplow's published contract
 * (snowplow `docs/howto-frontend-call-provenance.md`, #1333/#1352). The two golden vectors and
 * the 370-byte example below are copied from that page; the encoder must reproduce them BYTE FOR
 * BYTE, not merely produce the same hash, because snowplow never recomputes the hash — it only
 * proves the same definition from its side (`TestProvenance1333_G_GoldenVector`).
 */
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { buildBlastRadiusSet } from '../components/BlastRadius/buildBlastRadius'
import { sha256HexOfUtf8 } from '../utils/sha256'
import { randomId } from '../utils/utils'

import type { BlastRadius, BlastRadiusSet } from './blastRadius.types'
import {
  buildCallProvenance,
  type CallProvenance,
  canonicalOpsOf,
  canonicalSetJson,
  confirmedSetOf,
  confirmedWriteOf,
  encodeCallProvenance,
  isContractRequestedAt,
  MAX_PROVENANCE_BYTES,
  PROVENANCE_HEADER,
  provenanceHeaderOf,
  withoutProvenanceHeader,
} from './callProvenance'

// ---- The contract page, verbatim -------------------------------------------------------------

const GOLDEN_V1_BYTES = '[{"group":"composition.krateo.io","irreversible":false,"name":"example-a","namespace":"example-ns","resource":"examplecatalogs","verb":"POST","version":"v1-2-0"},{"group":"","irreversible":true,"name":"example-b","namespace":"example-ns","resource":"configmaps","verb":"DELETE","version":"v1"},{"group":"apps","irreversible":false,"name":"","namespace":"example-ns","resource":"deployments","verb":"POST","version":"v1"}]'
const GOLDEN_V1_SHA = '0a08bb91090b111f15a045b6061bccc4d0b8488d85f99ba57d8632e17061c277'

// The page's escaping vector: name "café-" U+2028 "<&>" quote backslash TAB U+0001 (the U+2028
// renders as a space on the page; its bytes are e2 80 a8).
const ESCAPING_NAME = 'café-\u2028<&>"\\\t\u0001'
const ESCAPING_BYTES = '[{"group":"","irreversible":true,"name":"café-\u2028<&>\\"\\\\\\t\\u0001","namespace":"ns-é","resource":"configmaps","verb":"DELETE","version":"v1"}]'
const ESCAPING_SHA = 'c7d3aedeac8dd069c50a82a9be6540050c026b8b3230fe702e6a53ac97e6b377'

const EXAMPLE_JSON = '{"source":"portal","agentSessionId":"ses_01-AB","confirmationId":"6f1d2c3b-4a5e-4f60-8b7a-9c0d1e2f3a4b","confirmedSet":{"count":3,"irreversible":true,"sha256":"0a08bb91090b111f15a045b6061bccc4d0b8488d85f99ba57d8632e17061c277"},"op":1,"requestedAt":"2026-11-11T10:20:30.456Z"}'
const EXAMPLE_HEADER = 'v1.eyJzb3VyY2UiOiJwb3J0YWwiLCJhZ2VudFNlc3Npb25JZCI6InNlc18wMS1BQiIsImNvbmZpcm1hdGlvbklkIjoiNmYxZDJjM2ItNGE1ZS00ZjYwLThiN2EtOWMwZDFlMmYzYTRiIiwiY29uZmlybWVkU2V0Ijp7ImNvdW50IjozLCJpcnJldmVyc2libGUiOnRydWUsInNoYTI1NiI6IjBhMDhiYjkxMDkwYjExMWYxNWEwNDViNjA2MWJjY2M0ZDBiODQ4OGQ4NWY5OWJhNTdkODYzMmUxNzA2MWMyNzcifSwib3AiOjEsInJlcXVlc3RlZEF0IjoiMjAyNi0xMS0xMVQxMDoyMDozMC40NTZaIn0'

// The golden set as the portal holds it: keys in construction order (NOT sorted), payload
// previews present (they must not reach the hash).
const goldenSet: BlastRadiusSet = {
  count: 3,
  kind: 'set',
  ops: [
    { gvr: { group: 'composition.krateo.io', resource: 'examplecatalogs', version: 'v1-2-0' }, irreversible: false, name: 'example-a', namespace: 'example-ns', payloadPreview: { spec: { a: 1 } }, verb: 'POST' },
    // eslint-disable-next-line sort-keys/sort-keys-fix -- deliberately unsorted: the canonical bytes must not depend on construction order
    { verb: 'DELETE', namespace: 'example-ns', name: 'example-b', irreversible: true, gvr: { version: 'v1', resource: 'configmaps', group: '' } },
    // No name: a collection POST.
    { gvr: { group: 'apps', resource: 'deployments', version: 'v1' }, irreversible: false, namespace: 'example-ns', payloadPreview: { kind: 'Deployment' }, verb: 'POST' },
  ],
}

const decode = (header: string): unknown => {
  expect(header.startsWith('v1.')).toBe(true)
  const b64 = header.slice(3).replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (char) => char.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

// ---- Golden vectors --------------------------------------------------------------------------

describe('confirmedSet.sha256 — the canonical confirmed set (contract section 7)', () => {
  it('golden vector v1: the canonical BYTES equal the page, and so does the hash', () => {
    const bytes = canonicalSetJson(canonicalOpsOf(goldenSet))
    expect(bytes).toBe(GOLDEN_V1_BYTES)
    expect(sha256HexOfUtf8(bytes)).toBe(GOLDEN_V1_SHA)
    expect(confirmedSetOf(goldenSet)).toEqual({ count: 3, irreversible: true, sha256: GOLDEN_V1_SHA })
  })

  it('golden vector v1 through the REAL set builder (paths + payloads, as runRestSet builds it)', () => {
    const radius = buildBlastRadiusSet([
      { path: '/apis/composition.krateo.io/v1-2-0/namespaces/example-ns/examplecatalogs', payload: { metadata: { name: 'example-a' } }, verb: 'POST' },
      { path: '/api/v1/namespaces/example-ns/configmaps/example-b', verb: 'DELETE' },
      { path: '/apis/apps/v1/namespaces/example-ns/deployments', payload: { spec: { replicas: 1 } }, verb: 'POST' },
    ])
    expect(canonicalSetJson(canonicalOpsOf(radius))).toBe(GOLDEN_V1_BYTES)
    expect(confirmedSetOf(radius).sha256).toBe(GOLDEN_V1_SHA)
  })

  it('escaping vector: quote, backslash, tab, U+0001 escaped; <&>, U+2028 and non-ASCII raw', () => {
    const radius: BlastRadiusSet = {
      count: 1,
      kind: 'set',
      ops: [{ gvr: { group: '', resource: 'configmaps', version: 'v1' }, irreversible: true, name: ESCAPING_NAME, namespace: 'ns-é', verb: 'DELETE' }],
    }
    const bytes = canonicalSetJson(canonicalOpsOf(radius))
    expect(bytes).toBe(ESCAPING_BYTES)
    // The UTF-8 bytes the hash covers: U+2028 raw (e2 80 a8), é raw (c3 a9), U+0001 as six ASCII bytes.
    const utf8 = Array.from(new TextEncoder().encode(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
    expect(utf8).toContain('636166c3a92de280a83c263e')
    expect(utf8).toContain(Array.from('\\u0001', (char) => char.charCodeAt(0).toString(16)).join(''))
    expect(sha256HexOfUtf8(bytes)).toBe(ESCAPING_SHA)
  })

  it('a scalar write is a set of one; core group "", absent name "", verb upper-case, diff excluded', () => {
    const scalar: BlastRadius = {
      cluster: 'local',
      count: 1,
      diff: { after: { data: { secret: 'x' } }, kind: 'create' },
      gvr: { group: '', resource: 'configmaps', version: 'v1' },
      namespace: 'demo',
      verb: 'POST',
    }
    expect(canonicalSetJson(canonicalOpsOf(scalar))).toBe('[{"group":"","irreversible":false,"name":"","namespace":"demo","resource":"configmaps","verb":"POST","version":"v1"}]')
    const deletion: BlastRadius = { ...scalar, diff: { kind: 'delete' }, name: 'gone', verb: 'DELETE' }
    expect(confirmedSetOf(deletion)).toMatchObject({ count: 1, irreversible: true })
  })

  it('the hash ignores diffs and previews but covers every op key and the ORDER', () => {
    const base = confirmedSetOf(goldenSet).sha256
    const noPreviews: BlastRadiusSet = { ...goldenSet, ops: goldenSet.ops.map(({ payloadPreview: _drop, ...op }) => op) }
    expect(confirmedSetOf(noPreviews).sha256).toBe(base)
    const reordered: BlastRadiusSet = { ...goldenSet, ops: [goldenSet.ops[1], goldenSet.ops[0], goldenSet.ops[2]] }
    expect(confirmedSetOf(reordered).sha256).not.toBe(base)
    const renamed: BlastRadiusSet = { ...goldenSet, ops: [{ ...goldenSet.ops[0], name: 'example-z' }, goldenSet.ops[1], goldenSet.ops[2]] }
    expect(confirmedSetOf(renamed).sha256).not.toBe(base)
  })
})

describe('sha256 — FIPS 180-2 examples (the implementation, independent of the contract)', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ])('sha256(%j)', (input, hex) => {
    expect(sha256HexOfUtf8(input)).toBe(hex)
  })

  it('a million "a" (multi-block, length high word path untouched)', () => {
    expect(sha256HexOfUtf8('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
  })
})

// ---- Header encoding -------------------------------------------------------------------------

describe('header encoding (contract sections 3 and 5)', () => {
  it('reproduces the page\'s example (JSON and the 370-byte header) exactly', () => {
    const provenance = buildCallProvenance({
      agentSessionId: 'ses_01-AB',
      confirmationId: '6f1d2c3b-4a5e-4f60-8b7a-9c0d1e2f3a4b',
      confirmedSet: { count: 3, irreversible: true, sha256: GOLDEN_V1_SHA },
      op: 1,
      requestedAt: '2026-11-11T10:20:30.456Z',
    })
    expect(JSON.stringify(provenance)).toBe(EXAMPLE_JSON)
    expect(encodeCallProvenance(provenance)).toBe(EXAMPLE_HEADER)
    // "Example (370 bytes)": the header value, `v1.` included.
    expect(EXAMPLE_HEADER).toHaveLength(370)
  })

  it('`v1.` + unpadded base64url: no +, /, =, whitespace or line break', () => {
    // A value whose standard base64 would contain + and / and padding.
    const header = encodeCallProvenance({ agentSessionId: '~~~?>>>', source: 'portal' }) ?? ''
    expect(header).toMatch(/^v1\.[A-Za-z0-9_-]+$/)
  })

  it('ONE field value: provenanceHeaderOf yields exactly one key, and a widget\'s own spelling is stripped', () => {
    const fragment = provenanceHeaderOf({ requestedAt: '2026-11-11T10:20:30.456Z' })
    expect(Object.keys(fragment)).toEqual([PROVENANCE_HEADER])
    const merged = { ...withoutProvenanceHeader({ 'X-KRATEO-PROVENANCE': 'v1.forged2', 'X-Other': 'kept', 'x-krateo-provenance': 'v1.forged' }), ...fragment }
    const headers = new Headers(merged)
    expect(headers.get(PROVENANCE_HEADER)).toBe(fragment[PROVENANCE_HEADER])
    expect(headers.get(PROVENANCE_HEADER)).not.toContain(',')
    expect(headers.get('X-Other')).toBe('kept')
  })

  it('stays far under 2 KiB at every field\'s maximum, however big the set (the hash bounds it)', () => {
    const huge: BlastRadiusSet = {
      count: 10_000,
      kind: 'set',
      ops: Array.from({ length: 10_000 }, (_unused, index) => ({
        gvr: { group: 'composition.krateo.io', resource: 'examplecatalogs', version: 'v1' },
        irreversible: index % 2 === 0,
        name: `object-${index}-${'n'.repeat(200)}`,
        namespace: 'ns'.repeat(30),
        verb: 'DELETE' as const,
      })),
    }
    const write = confirmedWriteOf(huge, { agentSessionId: 'A'.repeat(128), confirmed: true, requestedAt: '2026-11-11T10:20:30.456-09:59' })
    const header = write.headerFor(9_999)[PROVENANCE_HEADER]
    expect(header).toBeDefined()
    expect(header.length).toBeLessThan(MAX_PROVENANCE_BYTES / 3)
    expect(decode(header)).toMatchObject({ confirmedSet: { count: 10_000 }, op: 9_999 })
  })

  it('an oversize value is never sent (asserted, not assumed)', () => {
    const oversize = { agentSessionId: 'A'.repeat(2048), source: 'portal' } as CallProvenance
    expect(encodeCallProvenance(oversize)).toBeUndefined()
  })
})

// ---- requestedAt -----------------------------------------------------------------------------

describe('requestedAt — the decoder\'s rule', () => {
  it.each([
    '2026-11-11T10:20:30.456Z',
    '2026-11-11T12:20:30.456+02:00',
    '2026-11-11T05:50:30.456-04:30',
    '2026-11-11T10:20:30.456+23:59',
    '2024-02-29T00:00:00.000Z',
    '0000-01-01T00:00:00.000Z',
    '0000-01-01T00:00:00.000-00:01',
    '9999-12-31T23:59:59.999Z',
    '9999-12-31T23:59:59.999+01:00',
  ])('accepts %s', (value) => {
    expect(isContractRequestedAt(value)).toBe(true)
  })

  it.each([
    ['offset hour 24', '2026-11-11T10:20:30.456+24:00'],
    ['offset minute 60', '2026-11-11T10:20:30.456+23:60'],
    ['UTC year -1', '0000-01-01T00:00:00.000+00:01'],
    ['UTC year 10000', '9999-12-31T23:59:59.999-01:00'],
    ['no fraction', '2026-11-11T10:20:30Z'],
    ['two fractional digits', '2026-11-11T10:20:30.45Z'],
    ['lower-case z', '2026-11-11T10:20:30.456z'],
    ['February 30', '2026-02-30T10:20:30.456Z'],
    ['February 29 of a common year', '2026-02-29T10:20:30.456Z'],
    ['hour 24', '2026-11-11T24:00:00.000Z'],
    ['second 60', '2026-11-11T10:20:60.000Z'],
    ['month 13', '2026-13-11T10:20:30.456Z'],
    ['expanded year', '+010000-01-01T00:00:00.000Z'],
  ])('rejects %s', (_label, value) => {
    expect(isContractRequestedAt(value)).toBe(false)
  })

  it('a non-UTC offset value is carried as written (snowplow rewrites it in UTC)', () => {
    const decoded = decode(provenanceHeaderOf({ requestedAt: '2026-11-11T12:20:30.456+02:00' })[PROVENANCE_HEADER]) as CallProvenance
    expect(decoded.requestedAt).toBe('2026-11-11T12:20:30.456+02:00')
  })

  it('the browser clock\'s own form (toISOString of now) always passes', () => {
    expect(isContractRequestedAt(new Date().toISOString())).toBe(true)
  })

  it('an out-of-contract requestedAt is LEFT OUT, the rest still sent', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const decoded = decode(provenanceHeaderOf({ ...VALID_CONFIRMATION, requestedAt: '2026-11-11T10:20:30.456+24:00' })[PROVENANCE_HEADER])
    expect(decoded).toEqual({ ...VALID_CONFIRMATION, source: 'portal' })
  })
})

// ---- The confirmation triple (snowplow#1357) ---------------------------------------------------

const VALID_CONFIRMATION = {
  confirmationId: '00000000-0000-4000-8000-000000000001',
  confirmedSet: { count: 3, irreversible: true, sha256: GOLDEN_V1_SHA },
  op: 1,
}
const TRIPLE = ['confirmationId', 'confirmedSet', 'op']

describe('confirmationId + confirmedSet + op — ALL THREE or NONE', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('the valid triple is sent whole', () => {
    expect(decode(provenanceHeaderOf(VALID_CONFIRMATION)[PROVENANCE_HEADER])).toEqual({ ...VALID_CONFIRMATION, source: 'portal' })
  })

  it.each<[string, Record<string, unknown>]>([
    ['id only', { confirmationId: VALID_CONFIRMATION.confirmationId }],
    ['set + op without id', { confirmedSet: VALID_CONFIRMATION.confirmedSet, op: 1 }],
    ['id + set without op', { confirmationId: VALID_CONFIRMATION.confirmationId, confirmedSet: VALID_CONFIRMATION.confirmedSet }],
    ['id + op without set', { confirmationId: VALID_CONFIRMATION.confirmationId, op: 1 }],
    ['set only', { confirmedSet: VALID_CONFIRMATION.confirmedSet }],
    ['op only', { op: 0 }],
    ['an invalid (upper-case) id with a valid set', { ...VALID_CONFIRMATION, confirmationId: '6F1D2C3B-4A5E-4F60-8B7A-9C0D1E2F3A4B' }],
    ['a non-UUID id with a valid set', { ...VALID_CONFIRMATION, confirmationId: 'not-a-uuid' }],
    ['a valid id with an invalid hash', { ...VALID_CONFIRMATION, confirmedSet: { ...VALID_CONFIRMATION.confirmedSet, sha256: GOLDEN_V1_SHA.toUpperCase() } }],
    ['a valid id with count 0', { ...VALID_CONFIRMATION, confirmedSet: { ...VALID_CONFIRMATION.confirmedSet, count: 0 }, op: 0 }],
    ['a valid id with op out of range', { ...VALID_CONFIRMATION, op: 3 }],
    ['a valid id with a fractional op', { ...VALID_CONFIRMATION, op: 0.5 }],
  ])('%s → none of the three; source, session and requestedAt kept', (_label, partial) => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const decoded = decode(provenanceHeaderOf({ agentSessionId: 's_test-0001', requestedAt: '2026-11-11T10:20:30.456Z', ...partial })[PROVENANCE_HEADER]) as Record<string, unknown>
    for (const key of TRIPLE) { expect(decoded).not.toHaveProperty(key) }
    expect(decoded).toEqual({ agentSessionId: 's_test-0001', requestedAt: '2026-11-11T10:20:30.456Z', source: 'portal' })
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('confirmation'))
  })
})

describe('randomId — the confirmationId source — in an INSECURE context', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const V4_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('crypto.randomUUID absent (plain http): getRandomValues still yields a lower-case v4 UUID', () => {
    const getRandomValues = vi.fn(<T extends ArrayBufferView | null>(bytes: T): T => {
      if (bytes instanceof Uint8Array) { bytes.fill(0xff) }
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })
    for (let run = 0; run < 50; run++) { expect(randomId()).toMatch(V4_LOWER) }
    expect(getRandomValues).toHaveBeenCalled()
    // All-0xff bytes: the version and variant bits are pinned, everything else lower-case hex.
    expect(randomId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })

  it('crypto.randomUUID absent with real random bytes: 500 ids, all valid confirmations', () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })
    for (let run = 0; run < 500; run++) {
      const id = randomId()
      expect(id).toMatch(V4_LOWER)
      expect(decode(provenanceHeaderOf({ ...VALID_CONFIRMATION, confirmationId: id })[PROVENANCE_HEADER])).toHaveProperty('confirmationId', id)
    }
  })

  it('no Web Crypto at all: still a lower-case v4 UUID', () => {
    vi.stubGlobal('crypto', undefined)
    for (let run = 0; run < 50; run++) { expect(randomId()).toMatch(V4_LOWER) }
  })

  it('a randomUUID that returns upper case is normalised, so the triple survives', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '6F1D2C3B-4A5E-4F60-8B7A-9C0D1E2F3A4B' })
    expect(randomId()).toBe('6f1d2c3b-4a5e-4f60-8b7a-9c0d1e2f3a4b')
  })
})

// ---- Confirmation identity -------------------------------------------------------------------

describe('confirmedWriteOf — one confirmation, many calls', () => {
  it('every op of ONE confirmation shares confirmationId, set and requestedAt; only `op` differs', () => {
    const write = confirmedWriteOf(goldenSet, { confirmed: true, requestedAt: '2026-11-11T10:20:30.456Z' })
    const decoded = [0, 1, 2].map((op) => decode(write.headerFor(op)[PROVENANCE_HEADER]) as CallProvenance)
    expect(decoded.map((entry) => entry.op)).toEqual([0, 1, 2])
    expect(new Set(decoded.map((entry) => entry.confirmationId)).size).toBe(1)
    expect(decoded[0].confirmationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    for (const entry of decoded) {
      expect(entry.confirmedSet).toEqual({ count: 3, irreversible: true, sha256: GOLDEN_V1_SHA })
      expect(entry.requestedAt).toBe('2026-11-11T10:20:30.456Z')
    }
  })

  it('two confirmations of the SAME set get two different confirmationIds', () => {
    const first = decode(confirmedWriteOf(goldenSet, { confirmed: true, requestedAt: '2026-11-11T10:20:30.456Z' }).headerFor(0)[PROVENANCE_HEADER]) as CallProvenance
    const second = decode(confirmedWriteOf(goldenSet, { confirmed: true, requestedAt: '2026-11-11T10:20:30.456Z' }).headerFor(0)[PROVENANCE_HEADER]) as CallProvenance
    expect(first.confirmationId).not.toBe(second.confirmationId)
    expect(first.confirmedSet).toEqual(second.confirmedSet)
  })

  it('an UNCONFIRMED set (sandbox carve-out) asserts no confirmation: no confirmationId, no confirmedSet/op', () => {
    const decoded = decode(confirmedWriteOf(goldenSet, { agentSessionId: 's_x', confirmed: false, requestedAt: '2026-11-11T10:20:30.456Z' }).headerFor(2)[PROVENANCE_HEADER])
    expect(decoded).toEqual({ agentSessionId: 's_x', requestedAt: '2026-11-11T10:20:30.456Z', source: 'portal' })
  })
})

// ---- The closed schema -----------------------------------------------------------------------

const ALLOWED_KEYS = ['agentSessionId', 'confirmationId', 'confirmedSet', 'op', 'requestedAt', 'source']
const FORBIDDEN_KEYS = ['actor', 'agent', 'agentId', 'action', 'verb', 'namespace', 'name', 'user', 'outcome', 'status', 'resolvedAt', 'prompt', 'summary', 'message']

/** Deterministic PRNG (mulberry32) so a failure reproduces. */
const prng = (seed: number) => {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

describe('the closed schema — no forbidden field, ever', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('the type IS the allow-list', () => {
    expectTypeOf<keyof CallProvenance>().toEqualTypeOf<'agentSessionId' | 'confirmationId' | 'confirmedSet' | 'op' | 'requestedAt' | 'source'>()
    expectTypeOf<keyof NonNullable<CallProvenance['confirmedSet']>>().toEqualTypeOf<'count' | 'irreversible' | 'sha256'>()
  })

  it('property: 2000 random inputs — with forbidden keys smuggled in — decode to allowed keys only, and pass the decoder rules', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const random = prng(1333)
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
    const strings = ['', 's_ok', 'has space', 'ü', 'A'.repeat(129), 'free text prompt: delete everything', '6f1d2c3b-4a5e-4f60-8b7a-9c0d1e2f3a4b', '6F1D2C3B-4A5E-4F60-8B7A-9C0D1E2F3A4B']
    for (let run = 0; run < 2000; run++) {
      const count = Math.floor(random() * 5)
      const smuggled = Object.fromEntries(FORBIDDEN_KEYS.filter(() => random() < 0.3).map((key) => [key, pick(strings)]))
      const input = {
        ...smuggled,
        ...(random() < 0.7 ? { agentSessionId: pick(strings) } : {}),
        ...(random() < 0.7 ? { confirmationId: pick(strings) } : {}),
        ...(random() < 0.7 ? { confirmedSet: { count, irreversible: random() < 0.5, sha256: random() < 0.8 ? GOLDEN_V1_SHA : 'XYZ', ...smuggled } } : {}),
        ...(random() < 0.7 ? { op: Math.floor(random() * 6) - 1 } : {}),
        ...(random() < 0.7 ? { requestedAt: pick([new Date().toISOString(), '2026-11-11T10:20:30.456+24:00', 'yesterday']) } : {}),
      }
      const header = provenanceHeaderOf(input)[PROVENANCE_HEADER]
      const decoded = decode(header) as Record<string, unknown>
      expect(ALLOWED_KEYS).toEqual(expect.arrayContaining(Object.keys(decoded)))
      for (const key of FORBIDDEN_KEYS) { expect(decoded).not.toHaveProperty(key) }
      expect(decoded.source).toBe('portal')
      if (decoded.agentSessionId !== undefined) { expect(decoded.agentSessionId).toMatch(/^[A-Za-z0-9_-]{1,128}$/) }
      if (decoded.confirmationId !== undefined) { expect(decoded.confirmationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/) }
      // The confirmation is all three keys or none (snowplow#1357).
      expect(['confirmationId', 'confirmedSet', 'op'].filter((key) => key in decoded).length % 3).toBe(0)
      if (decoded.confirmedSet !== undefined) {
        const set = decoded.confirmedSet as Record<string, unknown>
        expect(Object.keys(set).sort()).toEqual(['count', 'irreversible', 'sha256'])
        expect(decoded.op as number).toBeGreaterThanOrEqual(0)
        expect(decoded.op as number).toBeLessThan(set.count as number)
      }
      if (decoded.requestedAt !== undefined) { expect(isContractRequestedAt(decoded.requestedAt as string)).toBe(true) }
      expect(header.length).toBeLessThanOrEqual(MAX_PROVENANCE_BYTES)
    }
  })
})
