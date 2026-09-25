/**
 * `$fileContent` is refused, not written.
 *
 * It was the token the legacy GitHub publish substituted into RepoContent payloads. That path is
 * gone (2026-09-25) and nothing substitutes the token any more — so a model-emitted set carrying it
 * would write the literal `{"$fileContent": "<path>"}` object into whatever it targets. It is refused
 * instead, with a denial that says where charts and pages are published from.
 */
import { describe, expect, it } from 'vitest'

import type { ApplyResourceSetOp } from './applyResourceSet'
import { compilePublishOps } from './publishCompile'

const ALLOW = { allowed: true } as const
const origin = { prompt: null, sessionId: null }

const configMap = (data: Record<string, unknown>): ApplyResourceSetOp => ({
  gvr: { group: '', resource: 'configmaps', version: 'v1' },
  name: 'x',
  namespace: 'krateo-system',
  payload: { data, metadata: { name: 'x' } },
  verb: 'POST',
})

describe('compilePublishOps — the $fileContent token', () => {
  it('refuses a set that carries it, naming the publish verbs', () => {
    const result = compilePublishOps([configMap({ chart: { $fileContent: 'Chart.yaml' } })], ALLOW, ALLOW, null, origin)
    expect(result.ops).toBeNull()
    expect(result.denial).toMatch(/publishBlueprint/)
  })

  it('compiles a set without it as before', () => {
    const result = compilePublishOps([configMap({ key: 'value' })], ALLOW, ALLOW, null, origin)
    expect(result.denial).toBeNull()
    expect(result.ops).toHaveLength(1)
  })
})

describe('compilePublishOps — a hand-written git-write set', () => {
  it('is refused by name — the kernel alone would drop it silently, with no chip the model can read', () => {
    const repoContent: ApplyResourceSetOp = {
      gvr: { group: 'github.krateo.io', resource: 'repocontents', version: 'v1alpha1' },
      name: 'chart-yaml',
      namespace: 'krateo-system',
      payload: { spec: { content: 'x', path: 'Chart.yaml' } },
      verb: 'POST',
    }
    const result = compilePublishOps([repoContent], ALLOW, ALLOW, null, origin)
    expect(result.ops).toBeNull()
    expect(result.denial).toMatch(/publishBlueprint/)
  })
})
