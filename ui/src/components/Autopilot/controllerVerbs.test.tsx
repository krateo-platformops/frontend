// @vitest-environment jsdom
/**
 * frontend#429 — Autopilot authors a controller THROUGH the Controller Builder: the controller verbs
 * start, place, map and settle through the composer's own kernels and buses, previewRestDef renders the
 * held controller the way the composer's Preview does, and publishRestDef publishes the held, previewed
 * draft — the petstore e2e an agent must be able to reproduce, then every refusal.
 *
 * The provider is the real one where it matters (the file buses, the authoring buses, the draft store
 * and the gate); the render (oasgen over /call) and the claim are stubbed — what is under test is what
 * the verbs hand them.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, render } from '@testing-library/react'
import { load } from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../pages/ControllerComposer/controllerRender', async (original) => ({
  ...(await original<typeof ControllerRenderModule>()),
  renderController: vi.fn(),
}))
vi.mock('./builderClaimPublish', () => ({
  buildClaimPublish: vi.fn(() => Promise.resolve({ branch: 'builder/x', compiled: { denial: null, ops: [] }, deepLink: null })),
}))

import { builderRegistry } from '../../builders/builderRegistry'
import type { Config } from '../../context/ConfigContext'
import { lockedSnapshot, restDefinitionPath } from '../../pages/ControllerComposer/controllerChart'
import { renderController } from '../../pages/ControllerComposer/controllerRender'
import type * as ControllerRenderModule from '../../pages/ControllerComposer/controllerRender'

import type { PortalActionProposal } from './actionBridge'
import { isComposeVerb } from './actionBridge'
import { createBlueprintDraftStore, type BlueprintDraftStore } from './blueprintDraftStore'
import { createBlueprintGate } from './blueprintGate'
import { buildClaimPublish } from './builderClaimPublish'
import type { BuilderTargets } from './builderTargets'
import { clearComposeRefusals, getComposeRefusals } from './composeRequest'
import { CONTROLLER_VERBS, NO_CONTROLLER_HELD } from './controllerVerbs'
import { draftHistory } from './draftHistory'
import { controllerFingerprint, summarizeController, withHeldDraft } from './draftStructure'
import { previewRestDefSpec } from './previewHandlers'
import { routeProposal } from './proposalRoute'
import { heldDraftIdentity } from './publishCompile'
import { NOTHING_HELD_CONTROLLER, publishDraft, type PublishDraftDeps } from './publishDraft'
import { publishedLocks } from './publishedLocks'
import { buildContextDelta, serializePageContext } from './useAutopilotContext'
import { useBlueprintAuthoringBuses } from './useBlueprintAuthoringBuses'
import { useDraftFileBuses } from './useDraftFileBuses'
import { DRAFT_VERB_REGISTRY, isDraftVerb, isReadOnlyVerb, type VerbDeps } from './verbRegistry'

const PETSTORE = readFileSync(join(__dirname, '..', '..', 'pages', 'ControllerComposer', '__fixtures__', 'petstore-v3.openapi.json'), 'utf8')
const CONFIG = { api: { SNOWPLOW_API_BASE_URL: 'https://snowplow.test' }, params: { FRONTEND_NAMESPACE: 'krateo-system' } } as unknown as Config
const PET = restDefinitionPath('Pet')
const START = { apiGroup: 'petstore.example.io', baseUrl: 'https://petstore3.swagger.io/api/v3', name: 'petstore', specText: PETSTORE, verb: 'controllerStart' }

const RENDERED = { outcome: 'rendered', render: { objects: [{ apiVersion: 'apiextensions.k8s.io/v1', kind: 'CustomResourceDefinition', name: 'pets.petstore.example.io' }], problems: [], warnings: [] } }

afterEach(() => {
  cleanup()
  draftHistory.clear()
  clearComposeRefusals()
  publishedLocks.set(null)
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.mocked(renderController).mockReset()
  vi.mocked(renderController).mockResolvedValue(RENDERED as never)
  vi.mocked(buildClaimPublish).mockClear()
})

/** The provider's draft buses over a fresh store and a real gate. */
const mount = () => {
  const store: BlueprintDraftStore = createBlueprintDraftStore()
  const gate = createBlueprintGate()
  const Hosted = () => {
    useDraftFileBuses(store, gate, heldDraftIdentity)
    useBlueprintAuthoringBuses(store, gate, CONFIG, { handleActionSet: vi.fn(), sandboxNamespace: 'krateo-preview' })
    return null
  }
  render(<Hosted />)
  return { gate, store }
}

const deps = (over: Partial<VerbDeps> = {}): VerbDeps => ({ handleAction: vi.fn(), routePatterns: [], ...over })

/** Run one controller verb as the bridge does: the DRAFT registry's entry for it. */
const run = async (proposal: Record<string, unknown>, over: Partial<VerbDeps> = {}): Promise<string> => {
  const spec = DRAFT_VERB_REGISTRY[String(proposal.verb)]
  let label = ''
  await act(async () => { label = (await spec.apply(proposal as unknown as PortalActionProposal, deps(over)))?.label ?? '' })
  return label
}

const preview = async (proposal: Record<string, unknown> = {}): Promise<string> => {
  let label = ''
  await act(async () => { label = (await previewRestDefSpec.apply({ ...proposal, verb: 'previewRestDef' }, deps()))?.label ?? '' })
  return label
}

const refusals = () => getComposeRefusals() ?? []

const targets: BuilderTargets = {
  blueprint: { owner: '', repo: '' },
  blueprintTemplate: { owner: '', repo: '' },
  kog: { owner: 'krateo-platformops', repo: 'krateo-oas' },
  kogTemplate: { owner: 'krateo-blueprints', repo: 'builder-scaffold' },
  page: { owner: '', repo: '' },
  pageTemplate: { owner: '', repo: '' },
}

const publish = (store: BlueprintDraftStore, gate: ReturnType<typeof createBlueprintGate>) => publishDraft(
  { blueprintGate: gate, blueprintStore: store, builderTargets: targets, config: { api: { AUTOPILOT_GIT_HOST: 'github.com' } }, origin: { prompt: 'publish it', sessionId: 's1' } } as unknown as PublishDraftDeps,
  { verb: 'publishRestDef' },
)

describe('the controller verbs are declared, deny-by-default', () => {
  it('each is a registered DRAFT verb — never a read verb — and the Controller Builder allows it', () => {
    const builder = builderRegistry.get({ name: 'controller-builder' })?.spec
    for (const verb of CONTROLLER_VERBS) {
      expect(isDraftVerb(verb), verb).toBe(true)
      expect(isReadOnlyVerb(verb), verb).toBe(false)
      expect(builder?.verbs.allowed, verb).toContain(verb)
      expect(isComposeVerb(verb), verb).toBe(true)
      expect(routeProposal(verb), verb).toBe('apply')
    }
    expect(builder?.verbs.allowed).toEqual([
      'controllerStart', 'controllerPlace', 'controllerMapVerb', 'controllerSetIdentifiers', 'controllerSetStatusFields', 'controllerRemoveKind', 'previewRestDef', 'publishRestDef',
    ])
    expect(builder?.summarizer?.plugin).toBe('controller-model')
    expect(isDraftVerb('controllerDeleteEverything')).toBe(false)
  })
})

describe('petstore, end to end — start → place pet → settle findby → preview → publish', () => {
  it('reproduces what a person does in the composer, and publishes the held, previewed draft', async () => {
    const { gate, store } = mount()

    const started = await run(START)
    expect(started).toMatch(/^Started controller petstore \(Kinds served in petstore\.example\.io, requests sent to https:\/\/petstore3\.swagger\.io\/api\/v3\) from the document given\. Resource groups to place: pet, store, user\./)
    expect(store.get()?.kind).toBe('controller')
    expect(Object.keys(store.get()?.files ?? {}).sort()).toEqual(['Chart.yaml', 'templates/configmap-oas-petstore.yaml', 'values.schema.json', 'values.yaml'])

    const placed = await run({ group: 'pet', verb: 'controllerPlace' })
    expect(placed).toContain('Placed pet as Pet (templates/restdefinition-pet.yaml)')
    expect(placed).toContain('findby is a conflict (GET /pet/findByStatus or GET /pet/findByTags) — settle it with controllerMapVerb')
    expect(placed).toMatch(/Preview needed before it can be published$/)

    // The conflict is never resolved for the agent: the preview refuses to send it anywhere.
    const blocked = await preview()
    expect(blocked).toMatch(/^previewRestDef — this portal did not run it \(Fix these before previewing/)
    expect(blocked).toContain('Pet: 2 operations look like findby')
    expect(renderController).not.toHaveBeenCalled()

    const settled = await run({ kind: 'Pet', method: 'GET', path: '/pet/findByStatus', restAction: 'findby', verb: 'controllerMapVerb' })
    expect(settled).toMatch(/^Pet findby is GET \/pet\/findByStatus — verbs: create POST \/pet, get GET \/pet\/\{petId\}, findby GET \/pet\/findByStatus/)
    expect(refusals()).toEqual([])

    expect(await preview()).toBe('Previewed petstore — oasgen-render generated Pet; Publish is armed (publishRestDef)')
    expect(renderController).toHaveBeenCalledTimes(1)
    expect(gate.isArmed('petstore')).toBe(true)

    const outcome = await publish(store, gate)
    expect(outcome.compiled.denial).toBeNull()
    const [[claim]] = vi.mocked(buildClaimPublish).mock.calls
    expect(claim.slug).toBe('petstore')
    const pet = load(claim.files.find((file) => file.path === PET)?.content ?? '') as { spec: { resource: { verbsDescription: { action: string; path: string }[] } } }
    expect(pet.spec.resource.verbsDescription.find((entry) => entry.action === 'findby')?.path).toBe('/pet/findByStatus')
  })
})

describe('controllerStart — the Start modal\'s validation, caps and refusals', () => {
  it('refuses a reserved API group, and holds nothing', async () => {
    const { store } = mount()
    const label = await run({ ...START, apiGroup: 'composition.krateo.io' })
    expect(label).toMatch(/^controllerStart — this portal did not run it \(apiGroup: composition\.krateo\.io is a Krateo system group/)
    expect(store.get()).toBeNull()
    expect(refusals()).toEqual([expect.objectContaining({ tried: 'start controller petstore' })])
  })

  it('refuses a document over 8 MiB without parsing it', async () => {
    mount()
    const label = await run({ ...START, specText: `${'#'.repeat(8 * 1024 * 1024)}\nopenapi: 3.0.0\n` })
    expect(label).toMatch(/spec: The spec is 9 MiB — over the 8 MiB this builder reads/)
  })

  it('refuses YAML anchors and aliases', async () => {
    mount()
    const bomb = ['openapi: 3.0.0', 'info: { title: b, version: "1" }', 'x-a: &a [1, 1]', 'x-b: [*a, *a]', 'paths: {}'].join('\n')
    expect(await run({ ...START, specText: bomb })).toMatch(/YAML anchors and aliases/)
  })

  it('rewrites every servers list to the base URL, and says so', async () => {
    const { store } = mount()
    const doc = JSON.parse(PETSTORE) as { paths: Record<string, Record<string, unknown>> }
    doc.paths['/pet'].servers = [{ url: 'https://elsewhere.example' }]
    const label = await run({ ...START, specText: JSON.stringify(doc) })
    expect(label).toContain('The document names its own servers beside the root (paths./pet.servers); each is rewritten to https://petstore3.swagger.io/api/v3')
    expect(store.get()?.files['templates/configmap-oas-petstore.yaml']).not.toContain('elsewhere.example')
  })

  it('needs exactly one source for the document', async () => {
    mount()
    expect(await run({ ...START, specUrl: 'https://specs.example/petstore.json' })).toMatch(/name exactly one source for the OpenAPI document/)
    expect(await run({ ...START, specText: undefined })).toMatch(/name exactly one source/)
  })

  it('reads a URL as nobody, through the modal\'s reader', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(PETSTORE, { status: 200 })))
    vi.stubGlobal('fetch', fetchSpy)
    const { store } = mount()
    const label = await run({ ...START, specText: undefined, specUrl: 'https://specs.example/petstore.json' })
    expect(label).toMatch(/^Started controller petstore .* from https:\/\/specs\.example\/petstore\.json\./)
    expect(fetchSpy).toHaveBeenCalledWith('https://specs.example/petstore.json', expect.objectContaining({ credentials: 'omit' }))
    expect(store.get()?.kind).toBe('controller')
  })

  it('starts from the document attached in the rail, so the model never reproduces it', async () => {
    const { store } = mount()
    const label = await run({ ...START, specAttached: true, specText: undefined }, { readAttachedSpec: () => PETSTORE })
    expect(label).toMatch(/from the document attached in the rail\./)
    expect(store.get()?.kind).toBe('controller')
    expect(await run({ ...START, name: 'other', specAttached: true, specText: undefined }, { readAttachedSpec: () => null })).toMatch(/a draft is already open/)
  })

  it('never starts over a held draft', async () => {
    const { store } = mount()
    await run(START)
    const label = await run({ ...START, name: 'second' })
    expect(label).toMatch(/a draft is already open \(a controller petstore\)/)
    expect(store.get()?.files['Chart.yaml']).toContain('name: petstore')
  })
})

describe('the edit verbs — the inspector\'s and the palette\'s plans', () => {
  const started = async () => {
    const mounted = mount()
    await run(START)
    await run({ group: 'pet', verb: 'controllerPlace' })
    return mounted
  }

  it('with nothing held, every edit verb says to start a controller first', async () => {
    mount()
    // One at a time: each runs inside its own act(), and overlapping acts are not supported.
    for (const proposal of [
      { group: 'pet', verb: 'controllerPlace' },
      { kind: 'Pet', omit: true, restAction: 'findby', verb: 'controllerMapVerb' },
      { identifiers: ['id'], kind: 'Pet', verb: 'controllerSetIdentifiers' },
      { kind: 'Pet', statusFields: [], verb: 'controllerSetStatusFields' },
      { kind: 'Pet', verb: 'controllerRemoveKind' },
    ]) {
      // eslint-disable-next-line no-await-in-loop -- sequential is the point: one act() at a time.
      expect(await run(proposal), proposal.verb).toBe(`${proposal.verb} — this portal did not run it (${NO_CONTROLLER_HELD})`)
    }
  })

  it('refuses to edit a draft of another kind, by name', async () => {
    const { store } = mount()
    act(() => { store.set({ 'Chart.yaml': 'apiVersion: v2\nname: chart\nversion: 0.1.0\n', 'values.schema.json': '{"type":"object"}' }, 'blueprint') })
    expect(await run({ group: 'pet', verb: 'controllerPlace' })).toMatch(/the open draft is a blueprint chart, not a controller/)
  })

  it('refuses a group the document does not have, and one already placed', async () => {
    await started()
    expect(await run({ group: 'orders', verb: 'controllerPlace' })).toMatch(/The document has no operations under orders\./)
    expect(await run({ group: 'pet', verb: 'controllerPlace' })).toMatch(/pet is already placed as Pet\./)
  })

  it('maps only to an operation of the document, and only one way at a time', async () => {
    await started()
    expect(await run({ kind: 'Pet', method: 'GET', path: '/pet/findByColour', restAction: 'findby', verb: 'controllerMapVerb' })).toMatch(/GET \/pet\/findByColour is not an operation of the document\./)
    expect(await run({ kind: 'Pet', method: 'GET', omit: true, path: '/pet/findByTags', restAction: 'findby', verb: 'controllerMapVerb' })).toMatch(/exactly one of the two/)
    expect(await run({ kind: 'Pet', omit: true, restAction: 'list', verb: 'controllerMapVerb' })).toMatch(/restAction must be one of create, get, findby, update, delete/)
    expect(await run({ kind: 'Dog', omit: true, restAction: 'findby', verb: 'controllerMapVerb' })).toMatch(/Dog is not a placed Kind \(the Kinds placed: Pet\)/)
  })

  it('an omitted verb settles its conflict as omitted', async () => {
    const { store } = await started()
    expect(await run({ kind: 'pet', omit: true, restAction: 'findby', verb: 'controllerMapVerb' })).toMatch(/^Left findby out of Pet — verbs: /)
    const summary = summarizeController(store.get())
    expect(summary?.kinds[0]).toMatchObject({ kind: 'Pet', omitted: ['findby'] })
    expect(summary?.kinds[0].conflicts).toBeUndefined()
  })

  it('sets identifiers and status fields to exactly the list given, through the inspector\'s toggles', async () => {
    const { store } = await started()
    expect(await run({ identifiers: ['id', 'name'], kind: 'Pet', verb: 'controllerSetIdentifiers' })).toMatch(/^Pet identifiers: id, name — Preview needed/)
    expect(await run({ kind: 'Pet', statusFields: ['status'], verb: 'controllerSetStatusFields' })).toMatch(/^Pet status fields: status/)
    const pet = load(store.get()?.files[PET] ?? '') as { spec: { resource: { identifiers: string[]; additionalStatusFields: string[] } } }
    expect(pet.spec.resource.identifiers).toEqual(['id', 'name'])
    expect(pet.spec.resource.additionalStatusFields).toEqual(['status'])
    expect(await run({ identifiers: ['id', 'name'], kind: 'Pet', verb: 'controllerSetIdentifiers' })).toMatch(/already id, name — nothing changed/)
    expect(await run({ identifiers: [], kind: 'Pet', verb: 'controllerSetIdentifiers' })).toMatch(/a Kind needs at least one identifier/)
    expect(await run({ identifiers: 'id', kind: 'Pet', verb: 'controllerSetIdentifiers' })).toMatch(/identifiers must be the whole list/)
  })

  it('refuses a locked field of a published controller with the inspector\'s sentence', async () => {
    const { store } = await started()
    publishedLocks.set({ kind: 'controller', locked: lockedSnapshot(store.get()?.files ?? {}), name: 'petstore' })
    expect(await run({ identifiers: ['name'], kind: 'Pet', verb: 'controllerSetIdentifiers' })).toMatch(/cannot update Pet in place: identifiers is locked once published/)
    expect(await run({ kind: 'Pet', verb: 'controllerRemoveKind' })).toMatch(/Pet was published/)
  })

  it('removes a Kind, and its group can be placed again', async () => {
    const { store } = await started()
    expect(await run({ kind: 'Pet', verb: 'controllerRemoveKind' })).toMatch(/^Removed Pet \(templates\/restdefinition-pet\.yaml\); its resource group pet can be placed again/)
    expect(store.get()?.files[PET]).toBeUndefined()
  })
})

describe('previewRestDef and publishRestDef of a controller', () => {
  it('a bare previewRestDef with nothing held is told to start a controller', async () => {
    mount()
    expect(await preview()).toBe(`previewRestDef — this portal did not run it (${NO_CONTROLLER_HELD})`)
  })

  it('a failed render is refused with its problems, and nothing is armed', async () => {
    vi.mocked(renderController).mockResolvedValue({ outcome: 'failed', render: { objects: [], problems: ['oasgen-render: Pet has no identifiers'], warnings: [] } } as never)
    const { gate } = mount()
    await run(START)
    await run({ group: 'store', verb: 'controllerPlace' })
    const label = await preview()
    expect(label).toMatch(/The controller did not render, so it cannot be published yet\. Problems: oasgen-render: Pet has no identifiers/)
    expect(gate.isArmed('petstore')).toBe(false)
    expect(refusals().at(-1)).toMatchObject({ tried: 'preview petstore' })
  })

  it('publish before preview is refused before anyone is asked where it goes', async () => {
    const { gate, store } = mount()
    await run(START)
    await run({ group: 'store', verb: 'controllerPlace' })
    const outcome = await publish(store, gate)
    expect(outcome.compiled.denial).toBe('denied — preview first: a controller "petstore" has not rendered since it last changed. Preview it (previewRestDef) — a render with no problems arms publishing.')
    expect(buildClaimPublish).not.toHaveBeenCalled()
  })

  it('publish with an unsettled conflict is refused by the lint, by name', async () => {
    const { gate, store } = mount()
    await run(START)
    await run({ group: 'pet', verb: 'controllerPlace' })
    expect((await publish(store, gate)).compiled.denial).toMatch(/^denied — the draft fails the chart lint: Pet: 2 operations look like findby/)
  })

  it('publish with nothing held says to start a controller draft first', async () => {
    const { gate, store } = mount()
    expect((await publish(store, gate)).compiled.denial).toBe(NOTHING_HELD_CONTROLLER)
  })

  it('an edit after a preview disarms publish again', async () => {
    const { gate } = mount()
    await run(START)
    await run({ group: 'store', verb: 'controllerPlace' })
    await preview()
    expect(gate.isArmed('petstore')).toBe(true)
    await run({ kind: 'Store', statusFields: ['status'], verb: 'controllerSetStatusFields' })
    expect(gate.isArmed('petstore')).toBe(false)
  })
})

describe('the envelope — summarizer controller-model', () => {
  it('tells the agent the groups, each Kind\'s verbs and conflicts with candidates, the lint and the preview state', async () => {
    const { gate, store } = mount()
    await run(START)
    await run({ group: 'pet', verb: 'controllerPlace' })
    const held = store.get()
    const summary = summarizeController(held, { previewed: gate.isArmed(heldDraftIdentity(held)) })
    expect(summary).toMatchObject({ apiGroup: 'petstore.example.io', baseUrl: 'https://petstore3.swagger.io/api/v3', name: 'petstore', preview: 'needed' })
    expect(summary?.groups.map((group) => group.group)).toEqual(['pet', 'store', 'user'])
    expect(summary?.groups[0]).toMatchObject({ group: 'pet', placedAs: 'Pet' })
    expect(summary?.groups[0].operations).toContain('GET /pet/findByTags')
    expect(summary?.kinds[0]).toMatchObject({
      conflicts: [{ candidates: ['GET /pet/findByStatus', 'GET /pet/findByTags'], restAction: 'findby' }],
      file: PET,
      group: 'pet',
      kind: 'Pet',
    })
    expect(summary?.kinds[0].verbs).toContainEqual({ operation: 'POST /pet', restAction: 'create' })
    expect(summary?.problems?.[0]).toMatch(/^Pet: 2 operations look like findby/)
    // No file bytes ride the envelope: the document is hundreds of lines; its operations are enough.
    expect(JSON.stringify(summary)).not.toContain('"openapi"')
  })

  it('rides the envelope only for a controller, survives the redactor, and a change re-sends it', async () => {
    const { store } = mount()
    await run(START)
    const before = withHeldDraft({ route: '/controller-builder/compose', widgets: [] }, store.get(), { previewed: false })
    expect(before.controller?.name).toBe('petstore')
    expect(before.chart).toBeUndefined()
    expect(serializePageContext(before)).toContain('"apiGroup": "petstore.example.io"')
    await run({ group: 'store', verb: 'controllerPlace' })
    const after = withHeldDraft({ route: '/controller-builder/compose', widgets: [] }, store.get(), { previewed: false })
    expect(controllerFingerprint(after.controller)).not.toBe(controllerFingerprint(before.controller))
    expect(buildContextDelta(after, before)).toContain('<page_context>\nThe following')
    expect(buildContextDelta(after, after)).toMatch(/^<page_context>\nUnchanged/)
  })
})
