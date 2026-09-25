/**
 * A publish has no file-count limit.
 *
 * The git-provider claim is ONE write whatever the chart holds — the files ride inside it — yet it
 * was refused past ten files, by the write-set cap borrowed as a file cap. An ordinary blueprint
 * (Chart.yaml, values, schema, templates, architecture.yaml) already reaches nine. Size is what
 * bounds a claim, and the held-draft byte cap enforces it upstream.
 *
 * (The legacy GitHub path, which wrote one object per file and so WAS bounded by the write-set cap,
 * was removed on the same day: the claim is the only publish path.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./builderClaimPublish', () => ({
  buildClaimPublish: vi.fn(() => Promise.resolve({ branch: 'builder/big-chart', compiled: { denial: null, ops: [] }, deepLink: null })),
}))

import { wrapAsConfigMapTemplate } from '../../pages/BlueprintComposer/architecture'

import { MAX_APPLY_SET_OPS } from './applyResourceSet'
import { createBlueprintDraftStore } from './blueprintDraftStore'
import { buildClaimPublish } from './builderClaimPublish'
import { runDraftPublish, type PublishDraftDeps } from './publishDraft'

const TEMPLATES = 20

const DESCRIPTOR = [
  'apiVersion: architecture.krateo.io/v1alpha1',
  'kind: ChartArchitecture',
  'chart: big-chart',
  'resources:',
  '  - id: cm-0',
  '    class: native',
  '    apiVersion: v1',
  '    kind: ConfigMap',
  '    template: templates/cm-0.yaml',
  '',
].join('\n')

/** A clean chart well past the old ten-file line: the standard files plus twenty templates. */
const bigChart = (): Record<string, string> => {
  const files: Record<string, string> = {
    'Chart.yaml': 'apiVersion: v2\nname: big-chart\nversion: 0.1.0\n',
    'templates/architecture.yaml': wrapAsConfigMapTemplate(DESCRIPTOR, 'big-chart'),
    'values.schema.json': JSON.stringify({ properties: { replicas: { default: 1, type: 'integer' } }, type: 'object' }),
    'values.yaml': 'replicas: 1\n',
  }
  for (let index = 0; index < TEMPLATES; index += 1) {
    files[`templates/cm-${index}.yaml`] = `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cm-${index}\n`
  }
  return files
}

const deps = (): PublishDraftDeps => {
  const store = createBlueprintDraftStore()
  store.set(bigChart(), 'blueprint')
  return {
    blueprintGate: { evaluate: () => ({ allowed: true, reason: null }) },
    blueprintStore: store,
    builderTargets: { blueprint: { owner: 'krateo-blueprints', repo: 'big-chart' }, page: { owner: 'krateo-platformops', repo: 'portal' } },
    origin: { prompt: null, sessionId: null },
  } as unknown as PublishDraftDeps
}

beforeEach(() => { vi.mocked(buildClaimPublish).mockClear() })

describe('runDraftPublish — how many files a publish may carry', () => {
  it('the git-provider claim takes every file, however many — one write carries them all', async () => {
    const outcome = await runDraftPublish(deps(), { verb: 'publishBlueprint' })
    expect(outcome.compiled.denial).toBeNull()
    expect(buildClaimPublish).toHaveBeenCalledTimes(1)
    const [[args]] = vi.mocked(buildClaimPublish).mock.calls
    expect(args.files.length).toBeGreaterThan(MAX_APPLY_SET_OPS)
    expect(args.files).toHaveLength(TEMPLATES + 4)
  })
})
