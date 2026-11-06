/**
 * FE-K2 — pure-logic coverage of the OAS attachment seam:
 *   - the 512 KiB cap (UTF-8 bytes, not JS chars) with the host-it/URL-path hint;
 *   - OpenAPI-document detection (conservative — chat prose is never captured);
 *   - $oasAttachment substitution at publish-compile time: verbatim bytes, exact-token
 *     matching only, pure (input ops never mutated);
 *   - the absent-attachment error: a token with nothing held REFUSES the publish.
 */
import { describe, expect, it } from 'vitest'

import type { ApplyResourceSetOp } from './applyResourceSet'
import {
  createOasAttachment,
  createOasAttachmentStore,
  looksLikeOpenApiDocument,
  OAS_ATTACHMENT_MAX_BYTES,
  opsCarryOasToken,
  substituteOasAttachment,
} from './oasAttachment'

const OAS_DOC = 'openapi: 3.0.0\ninfo:\n  title: MLflow\npaths:\n  /api/2.0/mlflow/experiments/get: {}\n'

/** The 2-op paste-path publish set (ConfigMap with the token, then the RestDefinition). */
const publishOps: ApplyResourceSetOp[] = [
  {
    gvr: { group: '', resource: 'configmaps', version: 'v1' },
    name: 'experiment-oas',
    namespace: 'krateo-system',
    payload: {
      apiVersion: 'v1',
      data: { 'openapi.yaml': { $oasAttachment: true } },
      kind: 'ConfigMap',
      metadata: { name: 'experiment-oas', namespace: 'krateo-system' },
    },
    verb: 'POST',
  },
  {
    gvr: { group: 'ogen.krateo.io', resource: 'restdefinitions', version: 'v1alpha1' },
    name: 'experiment',
    namespace: 'krateo-system',
    payload: { apiVersion: 'ogen.krateo.io/v1alpha1', kind: 'RestDefinition' },
    verb: 'POST',
  },
]

describe('createOasAttachment — the 512 KiB hard cap', () => {
  it('holds a document under the cap, measured in UTF-8 bytes', () => {
    const result = createOasAttachment(OAS_DOC)
    expect(result).toEqual({ attachment: { bytes: OAS_DOC.length, text: OAS_DOC }, ok: true })
    // multibyte characters count as their encoded bytes, not their JS string length
    const accented = 'openapi: 3.0.0 # café'
    const held = createOasAttachment(accented)
    expect(held.ok && held.attachment.bytes).toBe(accented.length + 1)
  })

  it('rejects an over-cap paste with the host-it (URL path) hint — nothing is held', () => {
    const oversized = 'a'.repeat(OAS_ATTACHMENT_MAX_BYTES + 1)
    const result = createOasAttachment(oversized)
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error).toContain('512 KiB')
    expect(result.error).toContain('URL')
    expect(createOasAttachment('   ').ok).toBe(false)
  })

  it('accepts exactly the cap boundary', () => {
    expect(createOasAttachment('a'.repeat(OAS_ATTACHMENT_MAX_BYTES)).ok).toBe(true)
  })
})

describe('createOasAttachmentStore — one held document at a time', () => {
  it('set/get/clear round-trip; a rejected set keeps the prior hold', () => {
    const store = createOasAttachmentStore()
    expect(store.get()).toBeNull()
    expect(store.set(OAS_DOC).ok).toBe(true)
    expect(store.get()?.text).toBe(OAS_DOC)
    // over-cap replacement fails → the previous attachment survives
    expect(store.set('b'.repeat(OAS_ATTACHMENT_MAX_BYTES + 1)).ok).toBe(false)
    expect(store.get()?.text).toBe(OAS_DOC)
    store.clear()
    expect(store.get()).toBeNull()
  })
})

describe('looksLikeOpenApiDocument — conservative capture detection', () => {
  it('detects YAML and JSON OpenAPI/Swagger roots', () => {
    expect(looksLikeOpenApiDocument(OAS_DOC)).toBe(true)
    expect(looksLikeOpenApiDocument('swagger: "2.0"\ninfo: {}')).toBe(true)
    expect(looksLikeOpenApiDocument('{\n  "openapi": "3.1.0",\n  "paths": {}\n}')).toBe(true)
  })

  it('never captures ordinary chat text', () => {
    expect(looksLikeOpenApiDocument('please expose the mlflow api as a kubernetes kind')).toBe(false)
    expect(looksLikeOpenApiDocument('{"verb":"navigate","route":"/dashboard"}')).toBe(false)
    expect(looksLikeOpenApiDocument('')).toBe(false)
  })
})

describe('substituteOasAttachment — the publish-compile substitution', () => {
  it('replaces the exact token with the held verbatim document (and only the token)', () => {
    const result = substituteOasAttachment(publishOps, { bytes: OAS_DOC.length, text: OAS_DOC })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.substituted).toBe(1)
    const { data } = result.ops[0].payload as { data: Record<string, unknown> }
    expect(data['openapi.yaml']).toBe(OAS_DOC)
    // the RestDefinition op rides through untouched
    expect(result.ops[1].payload).toEqual(publishOps[1].payload)
  })

  it('is pure — the proposal ops are never mutated', () => {
    const before = JSON.parse(JSON.stringify(publishOps)) as unknown
    substituteOasAttachment(publishOps, { bytes: OAS_DOC.length, text: OAS_DOC })
    expect(publishOps).toEqual(before)
  })

  it('passes a token-less set through unchanged (substituted 0) — non-KOG sets are unaffected', () => {
    const plain: ApplyResourceSetOp[] = [publishOps[1]]
    const result = substituteOasAttachment(plain, null)
    expect(result).toEqual({ ok: true, ops: plain, substituted: 0 })
  })

  it('REFUSES a token with no attachment held — the absent-attachment error', () => {
    const result = substituteOasAttachment(publishOps, null)
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error).toContain('no OpenAPI document is attached')
  })

  it('only the EXACT single-key token substitutes — near-misses are left as data', () => {
    const nearMiss: ApplyResourceSetOp[] = [{
      ...publishOps[0],
      payload: { data: { a: { $oasAttachment: true, extra: 1 }, b: { $oasAttachment: false } } },
    }]
    expect(opsCarryOasToken(nearMiss)).toBe(false)
    const result = substituteOasAttachment(nearMiss, { bytes: 1, text: 'x' })
    expect(result.ok && result.substituted).toBe(0)
  })

  it('opsCarryOasToken finds tokens nested anywhere in a payload', () => {
    expect(opsCarryOasToken(publishOps)).toBe(true)
    expect(opsCarryOasToken([publishOps[1]])).toBe(false)
    expect(opsCarryOasToken([{ ...publishOps[1], payload: { deep: [{ inner: { $oasAttachment: true } }] } }])).toBe(true)
  })
})
