/**
 * THE ENGINE, HEADLESS, DRIVEN BY A STUB BUILDER (T2, frontend#408).
 *
 * No composer is mounted. A Builder that is NOT one of the fixtures — its own name, label, verbs,
 * lint list and destination keys — replaces the registry, and a draft goes start → edit → preview →
 * publish through the engine's own functions. Every assertion is something the stub's SPEC decided:
 * which verb publishes, where it goes, which lint refuses, what a refusal calls the builder. Were any
 * of those still a hardcoded page/blueprint switch, the stub's values would not show up here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import yaml from 'js-yaml'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The one cluster read on the publish path (the BuilderPublish GVR, over /call) — answered here, so
// everything else the claim is built from is the engine's own code.
vi.mock('../components/Autopilot/builderPublishGvr', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveBuilderPublishGvr: () => Promise.resolve({
    apiVersion: 'builder.krateo.io/v1alpha1',
    gvr: { group: 'builder.krateo.io', resource: 'builderpublishes', version: 'v1alpha1' },
  }),
}))

import { createBlueprintDraftStore } from '../components/Autopilot/blueprintDraftStore'
import { createBlueprintGate } from '../components/Autopilot/blueprintGate'
import type { BuilderTargets } from '../components/Autopilot/builderTargets'
import { wrongComposerMessage } from '../components/Autopilot/draftResume'
import { summarizeChart, withHeldDraft } from '../components/Autopilot/draftStructure'
import { draftKindOfPayload } from '../components/Autopilot/previewBus'
import { lintHeldDraft } from '../components/Autopilot/proposedChart'
import { heldDraftIdentity } from '../components/Autopilot/publishCompile'
import { publishDraft, publisherOfVerb, REGISTRATION_PATH, type PublishDraftDeps } from '../components/Autopilot/publishDraft'
import { draftRecordDisplayName } from '../components/Autopilot/useDraftAutosave'
import { startChart } from '../pages/BlueprintComposer/startChart'

import { builderRegistry, swapBuildersForTest } from './builderRegistry'
import { parseBuilder, type Builder } from './builderSpec'

const FIXTURE = join(__dirname, 'fixtures', 'blueprint-builder.builder.yaml')

/**
 * The stub: a chart builder that is neither of today's. Its publish verb is `publishStub`, it lints
 * with `chart-lint` only, it has no summarizer, and — deliberately crossed — its destination is the
 * PAGE builder's config key while its seed is the blueprint template's.
 */
const stubBuilder = (): Builder => {
  const raw = yaml.load(readFileSync(FIXTURE, 'utf8')) as { metadata: Record<string, unknown>; spec: Record<string, unknown> }
  const { spec } = raw
  delete spec.summarizer
  const parsed = parseBuilder({
    ...raw,
    metadata: { name: 'stub-builder' },
    spec: {
      ...spec,
      label: 'Stub Builder',
      lint: ['chart-lint'],
      publish: { ...(spec.publish as object), targetKey: 'AUTOPILOT_PAGE_BUILDER_REPO' },
      route: '/stub-builder/compose',
      verbs: { allowed: ['chartPut', 'publishStub'] },
    },
  })
  if (!parsed.ok) { throw new Error(`stub Builder refused: ${parsed.problems.join('; ')}`) }
  return parsed.builder
}

const TARGETS: BuilderTargets = {
  blueprint: { owner: 'blueprint-org', repo: '<chart>' },
  blueprintTemplate: { owner: 'krateo-blueprints', repo: 'builder-scaffold' },
  kog: { owner: '', repo: '' },
  page: { owner: 'stub-org', repo: 'stub-repo' },
  pageTemplate: { owner: 'page-org', repo: 'page-scaffold' },
}

const engine = () => {
  const store = createBlueprintDraftStore()
  const gate = createBlueprintGate()
  const deps: PublishDraftDeps = {
    blueprintGate: gate,
    blueprintStore: store,
    builderTargets: TARGETS,
    config: { api: { AUTOPILOT_GIT_HOST: 'git.example.com' } } as PublishDraftDeps['config'],
    origin: { prompt: null, sessionId: null },
  }
  return { deps, gate, store }
}

const started = (): Record<string, string> => {
  const result = startChart({ description: 'headless', name: 'orders-api', version: '1.2.3' })
  if (!result.ok) { throw new Error('start refused') }
  return result.files
}

let restore: () => void

beforeAll(() => { restore = swapBuildersForTest([stubBuilder()]) })
afterAll(() => restore())

describe('a stub Builder drives the engine, start → edit → preview → publish', () => {
  it('the registry holds only the stub', () => {
    expect(builderRegistry.all().map((builder) => builder.metadata.name)).toEqual(['stub-builder'])
  })

  it('verbs come from the spec: publishStub publishes, publishBlueprint no longer does', () => {
    expect(publisherOfVerb('publishStub')).toBe('blueprint')
    expect(publisherOfVerb('publishBlueprint')).toBeNull()
    expect(publisherOfVerb('publishPage')).toBeNull()
  })

  it('publishes only after a preview, to the destination and seed its keys name, with its registration', async () => {
    const { deps, gate, store } = engine()

    // START: the draft is held under the stub's draft kind, filed under its Chart.yaml name.
    store.set(started(), 'blueprint')
    const held = store.get()
    expect(held).not.toBeNull()
    expect(draftRecordDisplayName(held!)).toBe('orders-api')

    // EDIT: a hand change to values.yaml, still clean under the stub's lint.
    const files = { ...held!.files, 'values.yaml': `${held!.files['values.yaml'] ?? ''}# edited\n` }
    store.set(files, 'blueprint')
    expect(lintHeldDraft(store.get()!.files, 'blueprint')).toEqual([])

    // PUBLISH BEFORE PREVIEW: the render-hash gate refuses — nothing previewed this tree.
    const early = await publishDraft(deps, { verb: 'publishStub' })
    expect(early.compiled.ops).toBeNull()
    expect(early.compiled.denial).toMatch(/preview/i)

    // PREVIEW: a successful render arms the gate for exactly the held draft's identity.
    gate.recordPreview(heldDraftIdentity(store.get()))

    // PUBLISH: one claim, to the stub's destination key (the page target's owner) and seeded from its
    // template key, carrying the registration file its publisher writes.
    const outcome = await publishDraft(deps, { verb: 'publishStub' })
    expect(outcome.compiled.denial).toBeNull()
    expect(outcome.held?.files['values.yaml']).toContain('# edited')
    const claim = outcome.compiled.ops?.[0]
    expect(claim?.gvr.resource).toBe('builderpublishes')
    const { spec } = claim?.payload as { spec: Record<string, unknown> }
    expect(JSON.stringify(spec)).toContain('stub-org')
    expect(JSON.stringify(spec)).toContain('https://git.example.com/krateo-blueprints/builder-scaffold.git')
    expect(JSON.stringify(spec)).toContain(REGISTRATION_PATH)
  })

  it('a publish verb the stub does not allow publishes nothing', async () => {
    const { deps, gate, store } = engine()
    store.set(started(), 'blueprint')
    gate.recordPreview(heldDraftIdentity(store.get()))
    const outcome = await publishDraft(deps, { verb: 'publishBlueprint' })
    expect(outcome.compiled.ops).toBeNull()
    expect(outcome.compiled.denial).toBe('denied — no builder publishes a held draft with publishBlueprint')
  })

  it('the lint is the spec\'s list: chart-lint refuses a chart with no schema; a Builder naming no lint does not', () => {
    const broken = { ...started() }
    delete broken['values.schema.json']
    expect(lintHeldDraft(broken, 'blueprint').join('\n')).toMatch(/values\.schema\.json/)
    const lintless = stubBuilder()
    lintless.spec.lint = []
    const back = swapBuildersForTest([lintless])
    try {
      expect(lintHeldDraft(broken, 'blueprint')).toEqual([])
    } finally {
      back()
    }
  })

  it('the words come from the spec: a refusal names the stub\'s label', () => {
    expect(wrongComposerMessage({ kind: 'blueprint', name: 'orders-api' })).toBe('orders-api is a blueprint chart draft — resume it from the Stub Builder.')
  })

  it('the summarizer is the spec\'s: the stub names none, so Autopilot is told no chart', () => {
    const store = createBlueprintDraftStore()
    store.set(started(), 'blueprint')
    expect(summarizeChart(store.get())).toBeUndefined()
    const envelope = { route: '/stub-builder/compose', widgets: [] }
    expect(withHeldDraft(envelope, store.get())).toBe(envelope)
  })

  it('preview dispatch follows the registry: with no page Builder, a legacy page payload is held by none', () => {
    expect(draftKindOfPayload({ builder: 'blueprint' })).toBe('blueprint')
    expect(draftKindOfPayload({})).toBeNull()
  })
})
