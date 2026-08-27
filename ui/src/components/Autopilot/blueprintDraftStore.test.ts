/**
 * FE-BP1 — pure-logic coverage of the blueprint held-draft seam:
 *   - the 512 KiB TOTAL-tree cap (UTF-8 bytes, not JS chars) + empty-tree refusal;
 *   - exact `{"$fileContent":"<path>"}` token detection (one key, non-empty string path);
 *   - $fileContent substitution at publish-compile time: verbatim bytes (text) or base64,
 *     exact-token matching only, pure (input ops never mutated);
 *   - the two refusals: a token with NOTHING held, and a token naming a path NOT in the
 *     held draft (drift) — both REFUSE the publish rather than fabricate bytes.
 */
import { describe, expect, it } from 'vitest'

import type { ApplyResourceSetOp } from './applyResourceSet'
import {
  BLUEPRINT_DRAFT_MAX_BYTES,
  createBlueprintDraft,
  createBlueprintDraftStore,
  encodeUtf8Base64,
  fileContentTokenPath,
  opsCarryFileContentToken,
  substituteFileContent,
} from './blueprintDraftStore'

const CHART = {
  'Chart.yaml': 'apiVersion: v2\nname: hello\nversion: 0.1.0\n',
  'templates/deployment.yaml': 'kind: Deployment\nmetadata:\n  name: hello\n',
  'values.schema.json': '{"type":"object","properties":{"replicas":{"type":"integer"}}}',
}

/** A git publish set: one RepoContent per file carrying a `{$fileContent:<path>}` token. */
const publishOps: ApplyResourceSetOp[] = Object.keys(CHART).map((path) => ({
  gvr: { group: 'github.krateo.io', resource: 'repocontents', version: 'v1alpha1' },
  name: `hello-${path.replace(/[^a-z0-9]+/gi, '-')}`,
  namespace: 'krateo-system',
  payload: {
    apiVersion: 'github.krateo.io/v1alpha1',
    kind: 'RepoContent',
    spec: { content: { $fileContent: path }, path },
  },
  verb: 'POST',
}))

describe('createBlueprintDraft — the 512 KiB total-tree cap', () => {
  it('holds a tree under the cap, measured in total UTF-8 bytes', () => {
    const result = createBlueprintDraft(CHART)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const total = Object.values(CHART).reduce((sum, text) => sum + text.length, 0)
    expect(result.held.bytes).toBe(total)
    expect(result.held.files).toEqual(CHART)
    // multibyte characters count as encoded bytes, not JS string length
    const accented = createBlueprintDraft({ 'NOTES.txt': 'café' })
    expect(accented.ok && accented.held.bytes).toBe('café'.length + 1)
  })

  it('refuses an empty tree', () => {
    const result = createBlueprintDraft({})
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('empty')
  })

  it('rejects an over-cap tree with a size hint — nothing is held', () => {
    const result = createBlueprintDraft({ 'templates/big.yaml': 'a'.repeat(BLUEPRINT_DRAFT_MAX_BYTES + 1) })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('512 KiB')
  })

  it('accepts exactly the cap boundary (summed across files)', () => {
    const half = 'a'.repeat(BLUEPRINT_DRAFT_MAX_BYTES / 2)
    expect(createBlueprintDraft({ 'a.txt': half, 'b.txt': half }).ok).toBe(true)
  })

  it('does not alias the caller map (defensive copy)', () => {
    const input: Record<string, string> = { 'Chart.yaml': 'name: x' }
    const result = createBlueprintDraft(input)
    input['Chart.yaml'] = 'name: MUTATED'
    expect(result.ok && result.held.files['Chart.yaml']).toBe('name: x')
  })
})

describe('createBlueprintDraftStore — one held tree at a time', () => {
  it('set/get/clear round-trip; a rejected set keeps the prior hold', () => {
    const store = createBlueprintDraftStore()
    expect(store.get()).toBeNull()
    expect(store.set(CHART).ok).toBe(true)
    expect(store.get()?.files).toEqual(CHART)
    // over-cap replacement fails → the previous tree survives
    expect(store.set({ 'big.yaml': 'b'.repeat(BLUEPRINT_DRAFT_MAX_BYTES + 1) }).ok).toBe(false)
    expect(store.get()?.files).toEqual(CHART)
    store.clear()
    expect(store.get()).toBeNull()
  })
})

describe('createBlueprintDraftStore.updateFile — FE-K(edit) in-place single-file edit', () => {
  it('replaces one held file within the cap and re-measures the total UTF-8 bytes', () => {
    const store = createBlueprintDraftStore()
    store.set(CHART)
    const before = store.get()?.bytes ?? 0
    const next = 'kind: Deployment\nmetadata:\n  name: hello-edited\n'
    const result = store.updateFile('templates/deployment.yaml', next)
    expect(result.ok).toBe(true)
    expect(store.get()?.files['templates/deployment.yaml']).toBe(next)
    // the OTHER files are untouched; bytes re-measured across the whole tree
    expect(store.get()?.files['Chart.yaml']).toBe(CHART['Chart.yaml'])
    const expected = before - CHART['templates/deployment.yaml'].length + next.length
    expect(result.bytes).toBe(expected)
    expect(store.get()?.bytes).toBe(expected)
  })

  it('re-measures multibyte edits as encoded bytes, not JS chars', () => {
    const store = createBlueprintDraftStore()
    store.set({ 'NOTES.txt': 'ascii' })
    // 'é' is 2 UTF-8 bytes (JS string length 1) — the re-measure must count encoded bytes.
    const result = store.updateFile('NOTES.txt', 'café')
    expect(result.ok).toBe(true)
    expect(result.bytes).toBe('café'.length + 1)
    expect(store.get()?.bytes).toBe('café'.length + 1)
  })

  it('rejects an edit that pushes the TOTAL tree over the cap — held tree UNMUTATED', () => {
    const store = createBlueprintDraftStore()
    store.set(CHART)
    const before = store.get()
    const result = store.updateFile('templates/deployment.yaml', 'a'.repeat(BLUEPRINT_DRAFT_MAX_BYTES + 1))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('512 KiB')
    // deny-by-default: nothing changed, the previously-held bytes stand
    expect(store.get()).toEqual(before)
    expect(result.bytes).toBe(before?.bytes)
  })

  it('rejects an edit to a path that is not a held file — held tree UNMUTATED', () => {
    const store = createBlueprintDraftStore()
    store.set(CHART)
    const before = store.get()
    const result = store.updateFile('templates/secret.yaml', 'kind: Secret\n')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('templates/secret.yaml')
    expect(store.get()).toEqual(before)
  })

  it('rejects an edit when nothing is held', () => {
    const store = createBlueprintDraftStore()
    const result = store.updateFile('Chart.yaml', 'name: x')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no draft')
  })
})

describe('fileContentTokenPath — exact-token detection', () => {
  it('returns the path for exactly {"$fileContent":"<path>"}', () => {
    expect(fileContentTokenPath({ $fileContent: 'templates/deployment.yaml' })).toBe('templates/deployment.yaml')
  })

  it('rejects near-misses (extra keys, empty/non-string path, array, primitive)', () => {
    expect(fileContentTokenPath({ $fileContent: 'x', extra: 1 })).toBeNull()
    expect(fileContentTokenPath({ $fileContent: '' })).toBeNull()
    expect(fileContentTokenPath({ $fileContent: true })).toBeNull()
    expect(fileContentTokenPath({ fileContent: 'x' })).toBeNull()
    expect(fileContentTokenPath(['templates/x.yaml'])).toBeNull()
    expect(fileContentTokenPath('templates/x.yaml')).toBeNull()
    expect(fileContentTokenPath(null)).toBeNull()
  })
})

describe('opsCarryFileContentToken', () => {
  it('detects a token nested anywhere in any op payload', () => {
    expect(opsCarryFileContentToken(publishOps)).toBe(true)
    expect(opsCarryFileContentToken([{ ...publishOps[0], payload: { spec: { path: 'x' } } }])).toBe(false)
  })
})

describe('substituteFileContent — the publish-compile substitution', () => {
  const held = { bytes: 0, files: CHART }

  it('replaces each token with the held verbatim file (text mode) and only the token', () => {
    const result = substituteFileContent(publishOps, held)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.substituted).toBe(3)
    result.ops.forEach((op) => {
      const { spec } = op.payload as { spec: { content: unknown; path: string } }
      expect(spec.content).toBe(CHART[spec.path as keyof typeof CHART])
    })
  })

  it('base64-encodes when asked (UTF-8 safe, round-trips)', () => {
    const result = substituteFileContent(publishOps, held, 'base64')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const first = result.ops[0].payload as { spec: { content: string; path: string } }
    expect(first.spec.content).toBe(encodeUtf8Base64(CHART[first.spec.path as keyof typeof CHART]))
    expect(atob(first.spec.content)).toBe(CHART[first.spec.path as keyof typeof CHART])
  })

  it('is pure — the proposal ops are never mutated', () => {
    const before = JSON.parse(JSON.stringify(publishOps)) as unknown
    substituteFileContent(publishOps, held)
    expect(publishOps).toEqual(before)
  })

  it('passes ops through untouched when no token is present (substituted:0)', () => {
    const plain: ApplyResourceSetOp[] = [{ ...publishOps[0], payload: { spec: { path: 'Chart.yaml' } } }]
    const result = substituteFileContent(plain, null)
    expect(result.ok && result.substituted).toBe(0)
  })

  it('REFUSES when a token is present but nothing is held', () => {
    const result = substituteFileContent(publishOps, null)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('PREVIEW')
  })

  it('REFUSES when a token names a path the held draft does not contain (drift)', () => {
    const rogue: ApplyResourceSetOp[] = [{
      ...publishOps[0],
      payload: { spec: { content: { $fileContent: 'templates/secret.yaml' }, path: 'templates/secret.yaml' } },
    }]
    const result = substituteFileContent(rogue, held)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('templates/secret.yaml')
  })
})

describe('encodeUtf8Base64 — chunked, UTF-8 safe', () => {
  it('round-trips large multibyte content without overflowing', () => {
    const big = '✓café '.repeat(20000)
    expect(new TextDecoder().decode(Uint8Array.from(atob(encodeUtf8Base64(big)), (ch) => ch.charCodeAt(0)))).toBe(big)
  })
})
