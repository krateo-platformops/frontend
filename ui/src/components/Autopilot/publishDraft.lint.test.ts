/**
 * A draft that fails the chart lint is refused BY NAME at publish — before the destination dialog.
 *
 * Its gate is disarmed already (a dirty hand edit forgets the arming), so without this the refusal
 * read "preview first": the wrong reason, because previewing again cannot help until the file is
 * fixed. The person was also asked for a destination for a chart that could never be sent.
 */
import { describe, expect, it } from 'vitest'

import { CHART_YAML_PATH, VALUES_SCHEMA_PATH } from './blueprintDraft'
import { createBlueprintDraftStore } from './blueprintDraftStore'
import { runDraftPublish, type PublishDraftDeps } from './publishDraft'

const deps = (store: ReturnType<typeof createBlueprintDraftStore>): PublishDraftDeps => ({
  blueprintStore: store,
  builderTargets: { blueprint: { owner: 'krateo-blueprints', repo: 'fallback' }, page: { owner: 'krateo-platformops', repo: 'portal' } },
} as unknown as PublishDraftDeps)

describe('runDraftPublish — a lint-dirty draft', () => {
  it('is denied with the lint problems, not "preview first"', async () => {
    const store = createBlueprintDraftStore()
    store.set({
      [CHART_YAML_PATH]: 'apiVersion: v2\nname: nginx-demo\nversion: 0.1.0\n',
      [VALUES_SCHEMA_PATH]: JSON.stringify({ properties: { resources: { default: { limits: { cpu: '100m' } }, type: 'object' } }, type: 'object' }),
    }, 'blueprint')
    const outcome = await runDraftPublish(deps(store), { verb: 'publishBlueprint' })
    expect(outcome.compiled.ops).toBeNull()
    expect(outcome.compiled.denial).toMatch(/fails the chart lint/)
    expect(outcome.compiled.denial).toMatch(/resources/)
  })

  it('names a missing values.schema.json on a PAGE draft too — it publishes as a chart', async () => {
    const store = createBlueprintDraftStore()
    store.set({ [CHART_YAML_PATH]: 'apiVersion: v2\nname: page-x\n', 'templates/flex.page-x.yaml': 'kind: Flex\n' }, 'page')
    const outcome = await runDraftPublish(deps(store), { verb: 'publishPage' })
    expect(outcome.compiled.denial).toMatch(/values\.schema\.json is missing/)
  })
})
