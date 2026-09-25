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

describe('runDraftPublish — the verb must match what is held', () => {
  const cleanChart = {
    [CHART_YAML_PATH]: 'apiVersion: v2\nname: orders-api\nversion: 0.1.0\n',
    [VALUES_SCHEMA_PATH]: '{"type":"object"}',
  }

  it('publishPage over a held CHART is refused by name — it would compile a page claim from chart files', async () => {
    const store = createBlueprintDraftStore()
    store.set(cleanChart, 'blueprint')
    const outcome = await runDraftPublish(deps(store), { verb: 'publishPage' })
    expect(outcome.compiled.ops).toBeNull()
    expect(outcome.compiled.denial).toBe('denied — the open draft is a blueprint chart, and publishPage publishes a portal page. Publish it from the blueprint composer.')
  })

  it('publishBlueprint over a held PAGE is refused by name, before the lint or the destination dialog', async () => {
    const store = createBlueprintDraftStore()
    // Lint-dirty too (no values.schema.json): the mismatch is the reason that must win.
    store.set({ [CHART_YAML_PATH]: 'apiVersion: v2\nname: page-x\n', 'templates/flex.page-x.yaml': 'kind: Flex\n' }, 'page')
    const outcome = await runDraftPublish(deps(store), { verb: 'publishBlueprint' })
    expect(outcome.compiled.denial).toMatch(/^denied — the open draft is a portal page, and publishBlueprint publishes a blueprint chart/)
    expect(outcome.compiled.denial).not.toMatch(/lint/)
  })
})

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
