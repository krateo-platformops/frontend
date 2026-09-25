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
import { pageChartYaml, pageValuesSchema } from './pageDraft'
import { runDraftPublish, type PublishDraftDeps } from './publishDraft'

const deps = (store: ReturnType<typeof createBlueprintDraftStore>): PublishDraftDeps => ({
  blueprintStore: store,
  // No template configured for either builder — a real install's state before the scaffold existed.
  builderTargets: {
    blueprint: { owner: 'krateo-blueprints', repo: 'fallback' },
    blueprintTemplate: { owner: '', repo: '' },
    page: { owner: 'krateo-platformops', repo: 'portal' },
    pageTemplate: { owner: '', repo: '' },
  },
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

describe('runDraftPublish — a valid chart its publish claim cannot carry', () => {
  it('is denied BY NAME before the destination is asked — not refused by admission at the last step', async () => {
    const store = createBlueprintDraftStore()
    const name = `a${'b'.repeat(36)}`
    store.set({ [CHART_YAML_PATH]: `apiVersion: v2\nname: ${name}\nversion: 0.1.0\n`, [VALUES_SCHEMA_PATH]: '{"type":"object"}' }, 'blueprint')
    const outcome = await runDraftPublish(deps(store), { verb: 'publishBlueprint' })
    expect(outcome.compiled.ops).toBeNull()
    expect(outcome.compiled.denial).toMatch(new RegExp(`^denied — "${name}" cannot be published through the builder: at most 36 characters to publish`))
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
  // Kind 42: inside the budget at 0.1.0, over it at 10.20.30 (the controller container would be 64).
  const name = `a${'b'.repeat(41)}`

  it('a page set is not refused for its CHART_VERSION placeholder — the version budget is a blueprint\'s', async () => {
    const store = createBlueprintDraftStore()
    store.set({ [CHART_YAML_PATH]: pageChartYaml(name), [VALUES_SCHEMA_PATH]: '{"type":"object"}', 'templates/flex.page-x.yaml': 'kind: Flex\n' }, 'page')
    const outcome = await runDraftPublish(deps(store), { verb: 'publishPage' })
    expect(outcome.compiled.denial).toBeNull()
  })

  it('a blueprint whose schema closes its root without `global` is denied by the lint, naming the cause (E6)', async () => {
    // composition-dynamic-controller adds `global` to every render's values; a closed root refuses
    // it, and without this the chart would publish, merge, release and register first.
    const store = createBlueprintDraftStore()
    store.set({
      [CHART_YAML_PATH]: 'apiVersion: v2\nname: orders-api\nversion: 0.1.0\n',
      [VALUES_SCHEMA_PATH]: JSON.stringify({ additionalProperties: false, properties: { size: { type: 'string' } }, type: 'object' }),
    }, 'blueprint')
    const outcome = await runDraftPublish(deps(store), { verb: 'publishBlueprint' })
    expect(outcome.compiled.ops).toBeNull()
    expect(outcome.compiled.denial).toMatch(/fails the chart lint: \[CDC-GLOBAL\] values\.schema\.json: the root sets "additionalProperties": false and does not declare "global"/)
  })

  it('a page set is NOT denied for its generated schema — its closed root declares global', async () => {
    const store = createBlueprintDraftStore()
    store.set({ [CHART_YAML_PATH]: pageChartYaml('page-x'), [VALUES_SCHEMA_PATH]: pageValuesSchema('page-x'), 'templates/flex.page-x.yaml': 'kind: Flex\n' }, 'page')
    const outcome = await runDraftPublish(deps(store), { verb: 'publishPage' })
    expect(outcome.compiled.denial).toBeNull()
  })

  it('a blueprint whose version outgrew its name is denied by the lint, naming the budget', async () => {
    const store = createBlueprintDraftStore()
    store.set({ [CHART_YAML_PATH]: `apiVersion: v2\nname: ${name}\nversion: 10.20.30\n`, [VALUES_SCHEMA_PATH]: '{"type":"object"}' }, 'blueprint')
    const outcome = await runDraftPublish(deps(store), { verb: 'publishBlueprint' })
    expect(outcome.compiled.denial).toMatch(/fails the chart lint: .*at version 10\.20\.30 the Kind .* at most 41 characters/)
  })
})
