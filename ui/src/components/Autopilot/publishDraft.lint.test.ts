/**
 * A draft that fails the chart lint is refused BY NAME at publish — before the destination dialog.
 *
 * Its gate is disarmed already (a dirty hand edit forgets the arming), so without this the refusal
 * read "preview first": the wrong reason, because previewing again cannot help until the file is
 * fixed. The person was also asked for a destination for a chart that could never be sent.
 */
import { describe, expect, it, vi } from 'vitest'

// Past the lint a publish builds the claim; nothing here is about the claim, so it only answers.
vi.mock('./builderClaimPublish', () => ({
  buildClaimPublish: vi.fn(() => Promise.resolve({ compiled: { denial: null, ops: [] }, deepLink: null })),
}))

import { CHART_YAML_PATH, VALUES_SCHEMA_PATH } from './blueprintDraft'
import { createBlueprintDraftStore } from './blueprintDraftStore'
import { pageChartYaml } from './pageDraft'
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

describe('runDraftPublish — the lint runs under the HELD kind', () => {
  // Kind 34: inside the budget at 0.1.0, over it at 10.20.30.
  const name = `a${'b'.repeat(33)}`

  it('a page set is not refused for its CHART_VERSION placeholder — the version budget is a blueprint\'s', async () => {
    const store = createBlueprintDraftStore()
    store.set({ [CHART_YAML_PATH]: pageChartYaml(name), [VALUES_SCHEMA_PATH]: '{"type":"object"}', 'templates/flex.page-x.yaml': 'kind: Flex\n' }, 'page')
    const base = deps(store)
    // A page publish reads the page template too; none configured is a real install's default.
    const withTemplate: PublishDraftDeps = { ...base, builderTargets: { ...base.builderTargets, pageTemplate: { owner: '', repo: '' } } }
    const outcome = await runDraftPublish(withTemplate, { verb: 'publishPage' })
    expect(outcome.compiled.denial).toBeNull()
  })

  it('a blueprint whose version outgrew its name is denied by the lint, naming the budget', async () => {
    const store = createBlueprintDraftStore()
    store.set({ [CHART_YAML_PATH]: `apiVersion: v2\nname: ${name}\nversion: 10.20.30\n`, [VALUES_SCHEMA_PATH]: '{"type":"object"}' }, 'blueprint')
    const outcome = await runDraftPublish(deps(store), { verb: 'publishBlueprint' })
    expect(outcome.compiled.denial).toMatch(/fails the chart lint: .*at version 10\.20\.30 the Kind .* at most 31 characters/)
  })
})
