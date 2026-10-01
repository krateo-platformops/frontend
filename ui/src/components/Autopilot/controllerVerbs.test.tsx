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

import { builderRegistry, swapBuildersForTest } from '../../builders/builderRegistry'
import type { Config } from '../../context/ConfigContext'
import { lockedSnapshot, planBindPathParam, planSetItemsPath, restDefinitionPath } from '../../pages/ControllerComposer/controllerChart'
import { renderController } from '../../pages/ControllerComposer/controllerRender'
import type * as ControllerRenderModule from '../../pages/ControllerComposer/controllerRender'

import type { PortalActionProposal } from './actionBridge'
import { isComposeVerb } from './actionBridge'
import { isApplySetAllowed, RESTDEFINITION_WRITE_DENIAL } from './applyResourceSet'
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
import { compilePublishOps, heldDraftIdentity } from './publishCompile'
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
      'controllerStart', 'controllerPlace', 'controllerMapVerb', 'controllerSetIdentifiers', 'controllerSetStatusFields', 'controllerRemoveKind',
      'controllerBindId', 'controllerSetExcludedFields', 'controllerSetItemsPath', 'controllerSetConfigurationFields', 'previewRestDef', 'publishRestDef',
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
    // Review of #434: the collection PUT is OFFERED as the update, and the agent confirms it like a person.
    expect(settled).toContain('update is a conflict (PUT /pet) — settle it with controllerMapVerb')
    expect(await run({ kind: 'Pet', method: 'PUT', path: '/pet', restAction: 'update', verb: 'controllerMapVerb' })).toMatch(/^Pet update is PUT \/pet — /)
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
    expect(await run({ kind: 'pet', omit: true, restAction: 'update', verb: 'controllerMapVerb' })).toMatch(/^Left update out of Pet — verbs: /)
    const summary = summarizeController(store.get())
    expect(summary?.kinds[0]).toMatchObject({ kind: 'Pet', omitted: ['findby', 'update'] })
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
      conflicts: [{ candidates: ['GET /pet/findByStatus', 'GET /pet/findByTags'], restAction: 'findby' }, { candidates: ['PUT /pet'], restAction: 'update' }],
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

describe('review fixes — the closed bypasses', () => {
  const RESTDEF = {
    apiVersion: 'ogen.krateo.io/v1alpha1',
    kind: 'RestDefinition',
    metadata: { name: 'refund', namespace: 'krateo-system' },
    spec: { oasPath: 'https://api.example.com/openapi.json', resource: { identifiers: ['id'], kind: 'Refund', verbsDescription: [{ action: 'get', method: 'GET', path: '/refunds' }] }, resourceGroup: 'composition.krateo.io' },
  }
  const write = [{ gvr: { group: 'ogen.krateo.io', resource: 'restdefinitions', version: 'v1alpha1' }, namespace: 'krateo-system', payload: RESTDEF, verb: 'POST' as const }]

  it('an inline previewRestDef arms nothing, and a RestDefinition set is refused by name and by the kernel', async () => {
    const { gate } = mount()
    // The inspection still opens (nothing held), but it is not a draft and arms no gate.
    expect(await preview({ restDefinition: RESTDEF })).toMatch(/RestDefinition preview/)
    expect(gate.isArmed('refund')).toBe(false)
    // The write that would have followed it: refused before any confirm, whatever any gate says.
    expect(compilePublishOps(write, { allowed: true }, null, { prompt: null, sessionId: null })).toEqual({ denial: RESTDEFINITION_WRITE_DENIAL, ops: null })
    expect(RESTDEFINITION_WRITE_DENIAL).toMatch(/author controllers through the Controller Builder/)
    expect(isApplySetAllowed(write)).toBe(false)
    expect(isApplySetAllowed([{ ...write[0], gvr: { group: 'lookalike.krateo.io', resource: 'restdefinitions', version: 'v1' } }])).toBe(false)
  })

  it('a verb the Controller Builder does not allow is refused as such — not as a wrong-kind draft', async () => {
    const controller = builderRegistry.all().find((builder) => builder.spec.draftKind === 'controller')
    const others = builderRegistry.all().filter((builder) => builder !== controller)
    if (!controller) { throw new Error('no controller Builder loaded in the test registry') }
    mount()
    await run(START)
    const restore = swapBuildersForTest([...others, { ...controller, spec: { ...controller.spec, verbs: { allowed: ['previewRestDef', 'publishRestDef'] } } }])
    try {
      expect(await run({ group: 'pet', verb: 'controllerPlace' })).toBe('controllerPlace — this portal did not run it (the Controller Builder on this cluster does not allow controllerPlace — it is not in the Builder\'s verbs.allowed)')
    } finally {
      restore()
    }
  })

  it('controllerStart is gated on verbs.allowed too', async () => {
    const controller = builderRegistry.all().find((builder) => builder.spec.draftKind === 'controller')
    const others = builderRegistry.all().filter((builder) => builder !== controller)
    if (!controller) { throw new Error('no controller Builder loaded in the test registry') }
    const { store } = mount()
    const restore = swapBuildersForTest([...others, { ...controller, spec: { ...controller.spec, verbs: { allowed: ['previewRestDef', 'publishRestDef'] } } }])
    try {
      expect(await run(START)).toMatch(/does not allow controllerStart — it is not in the Builder's verbs\.allowed/)
      expect(store.get()).toBeNull()
    } finally {
      restore()
    }
  })

  it('a base URL carrying a credential is refused, and the credential is echoed nowhere', async () => {
    const { store } = mount()
    for (const baseUrl of ['https://alice:s3cr3t-value@petstore.example/api', 'https://petstore.example/api?API_KEY=s3cr3t-value', 'https://petstore.example/api?X-Amz-Signature=s3cr3t-value']) {
      // eslint-disable-next-line no-await-in-loop -- one act() at a time.
      const label = await run({ ...START, baseUrl })
      expect(label, baseUrl).toMatch(/baseUrl: The URL( carries a user name or password|'s query carries a credential-like parameter)/)
      expect(label).not.toContain('s3cr3t-value')
      expect(JSON.stringify(refusals())).not.toContain('s3cr3t-value')
    }
    expect(store.get()).toBeNull()
  })

  it('a spec URL carrying a credential is never fetched', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    mount()
    const label = await run({ ...START, specText: undefined, specUrl: 'https://specs.example/petstore.json?token=s3cr3t-value' })
    expect(label).toMatch(/credential-like parameter \(token\)/)
    expect(label).not.toContain('s3cr3t-value')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a spec URL body is streamed, counted and abandoned past 8 MiB — with no redirect followed and no referrer sent', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x20)
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulled += 1
        controller.enqueue(chunk)
      },
    })
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(body, { status: 200 })))
    vi.stubGlobal('fetch', fetchSpy)
    mount()
    const label = await run({ ...START, specText: undefined, specUrl: 'https://specs.example/endless.json' })
    expect(label).toMatch(/The URL served more than 8 MiB/)
    expect(pulled).toBeLessThan(12)
    expect(fetchSpy).toHaveBeenCalledWith('https://specs.example/endless.json', expect.objectContaining({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' }))
  })

  it('a base URL hand-edited to carry a credential is masked on the envelope and named by the lint', async () => {
    const { store } = mount()
    await run(START)
    const held = store.get()
    if (!held) { throw new Error('nothing held') }
    const files = { ...held.files, 'Chart.yaml': held.files['Chart.yaml'].replace('https://petstore3.swagger.io/api/v3', 'https://petstore3.swagger.io/api/v3?apikey=s3cr3t-value') }
    const summary = summarizeController({ ...held, files })
    expect(JSON.stringify(summary)).not.toContain('s3cr3t-value')
    expect(summary?.baseUrl).toBe('(a URL carrying a credential, not shown)')
    expect(summary?.problems?.some((problem) => /Chart\.yaml: the base URL — The URL's query carries a credential-like parameter \(apikey\)/.test(problem))).toBe(true)
  })
})

describe('round 2 (frontend#405) — the agent reaches every new inspector gesture, through the same plans', () => {
  const fixture = (file: string) => readFileSync(join(__dirname, '..', '..', 'pages', 'ControllerComposer', '__fixtures__', file), 'utf8')
  const KMS = { apiGroup: 'kms.example.io', baseUrl: 'https://kms.example.test', name: 'kms', specText: fixture('aruba-like-kms.oas.yaml'), verb: 'controllerStart' }
  const DBAAS = { apiGroup: 'dbaas.example.io', baseUrl: 'https://dbaas.example.test', name: 'dbaas', specText: fixture('aruba-like-dbaas.oas.yaml'), verb: 'controllerStart' }
  const KM = restDefinitionPath('Km')
  const PROJECT = restDefinitionPath('Project')
  const resourceOf = (store: BlueprintDraftStore, path: string) => (load(store.get()?.files[path] ?? '') as { spec: { resource: Record<string, unknown> } }).spec.resource

  it('kms: the envelope and the ambiguous id are told to the agent, and settled with controllerSetItemsPath + controllerBindId — the inspector\'s bytes exactly', async () => {
    const { store } = mount()
    await run(KMS)
    const placed = await run({ group: 'kms', verb: 'controllerPlace' })
    expect(placed).toContain('{keyId} is read from status.keyId but waits for a confirm (status.keyId or status.id) — settle it with controllerBindId')
    const summary = summarizeController(store.get(), {})
    expect(summary?.servedAs).toBe('kms.example.io/v1alpha1 (the document says 1.0.4; pinned)')
    expect(summary?.sourceSpecVersion).toBe('1.0.4')
    expect(summary?.kinds[0]).toMatchObject({
      itemsPathChoices: ['.data', '.included'],
      pathIds: [{ choices: ['status.keyId', 'status.id'], confirm: '{keyId} could be keyId or id — keyId is suggested; confirm it or choose another.', field: 'status.keyId', param: 'keyId' }],
    })

    const before = store.get()?.files ?? {}
    const byPlan = planSetItemsPath(before, KM, '.data')
    expect(await run({ itemsPath: '.data', kind: 'Km', verb: 'controllerSetItemsPath' })).toMatch(/^Km findby itemsPath: \.data — /)
    expect(byPlan.ok && store.get()?.files[KM]).toBe(byPlan.ok ? byPlan.edit?.[KM] : '')

    const beforeBind = store.get()?.files ?? {}
    const bindPlan = planBindPathParam(beforeBind, KM, 'keyId', 'status.id')
    expect(await run({ field: 'status.id', kind: 'Km', param: '{keyId}', verb: 'controllerBindId' })).toMatch(/^Km reads \{keyId\} from status\.id \(confirmed\)/)
    expect(bindPlan.ok && store.get()?.files[KM]).toBe(bindPlan.ok ? bindPlan.edit?.[KM] : '')
    expect(summarizeController(store.get(), {})?.problems).toBeUndefined()
  })

  it('dbaas: excluded fields and configuration fields are whole lists; actions come from the Kind, never from the agent', async () => {
    const { store } = mount()
    await run(DBAAS)
    await run({ group: 'projects', verb: 'controllerPlace' })
    expect(await run({ excludedFields: ['properties.flavor'], kind: 'Project', verb: 'controllerSetExcludedFields' })).toMatch(/^Project spec leaves out: properties\.flavor/)
    expect(resourceOf(store, PROJECT).excludedSpecFields).toEqual(['properties.flavor'])
    const label = await run({ configurationFields: [{ in: 'header', name: 'api-version' }, { in: 'query', name: 'limit' }], kind: 'Project', verb: 'controllerSetConfigurationFields' })
    expect(label).toMatch(/^Project reads api-version \(header\), limit \(query\) from its Configuration/)
    expect(resourceOf(store, PROJECT).configurationFields).toEqual([
      { fromOpenAPI: { in: 'header', name: 'api-version' }, fromRestDefinition: { actions: ['*'] } },
      { fromOpenAPI: { in: 'query', name: 'limit' }, fromRestDefinition: { actions: ['findby'] } },
    ])
    expect(await run({ configurationFields: [{ in: 'query', name: 'page' }], kind: 'Project', verb: 'controllerSetConfigurationFields' }))
      .toMatch(/page \(query\) is not a header or query parameter of Project's verbs/)
    expect(await run({ configurationFields: [], kind: 'Project', verb: 'controllerSetConfigurationFields' })).toMatch(/^Project reads none from its Configuration/)
    expect(resourceOf(store, PROJECT).configurationFields).toBeUndefined()
    // The alias {dbaasId}/{id} waits for a confirm, for the agent as for the person.
    expect(await run({ field: 'status.metadata.id', kind: 'Project', param: 'id', verb: 'controllerBindId' })).toMatch(/^Project reads \{id\} from status\.metadata\.id \(confirmed\)/)
    expect(summarizeController(store.get(), {})?.problems).toBeUndefined()
  })

  it('refuses a binding to something that is not a field, and an itemsPath with no findby', async () => {
    mount()
    await run(START)
    await run({ group: 'pet', verb: 'controllerPlace' })
    expect(await run({ field: 'id', kind: 'Pet', param: 'petId', verb: 'controllerBindId' })).toMatch(/id is not a field of the resource — bind \{petId\} to spec\.<field> or status\.<field>/)
    expect(await run({ itemsPath: '.data', kind: 'Pet', verb: 'controllerSetItemsPath' })).toMatch(/There is no findby verb to set an itemsPath on/)
    expect(await run({ excludedFields: 'id', kind: 'Pet', verb: 'controllerSetExcludedFields' })).toMatch(/excludedFields must be the whole list/)
    // Review of #434: only the inspector's candidates — what a status binding reads and what create sends.
    expect(await run({ excludedFields: ['id', 'spec.nothere'], kind: 'Pet', verb: 'controllerSetExcludedFields' }))
      .toMatch(/spec\.nothere is not a field Pet's spec could leave out — the candidates are what a status binding reads and what create sends: id, name, category, photoUrls, tags, status, category\.id, category\.name/)
  })
})
