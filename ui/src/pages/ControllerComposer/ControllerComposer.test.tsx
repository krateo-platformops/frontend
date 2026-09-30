// @vitest-environment jsdom
/**
 * THE CONTROLLER COMPOSER, HEADLESS (T8, frontend#412) — petstore authored in the UI, with no rail.
 *
 * The composer is mounted as its route mounts it (the composer host, from the Controller Builder
 * fixture), beside the provider's REAL draft hooks: the store, the gate, the file buses and the
 * start/render buses. Nothing is stubbed between a click and the held files. The walk is the
 * acceptance line: start (the modal, the petstore document pasted) → place pet and store (one by its
 * Place button, one dragged onto Resources) → settle pet's findby conflict → auth (a header parameter
 * to the Configuration) → the chart tree, which T7's validator passes Kind by Kind.
 *
 * STRUCTURE SNAPSHOTS of the four states the mockup draws — empty, started, a Kind placed with its
 * conflict, auth — pin the DOM the way composerStructure.test.tsx pins the other two composers.
 * Ids are normalised (as there); a code block is collapsed to its line count, so a snapshot pins the
 * composer, not the 20 KB of petstore JSON the files pane highlights.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { load } from 'js-yaml'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { builderRoutes } from '../../builders/host/builderRoutes'
import type { BlueprintDraftStore } from '../../components/Autopilot/blueprintDraftStore'
import { createBlueprintGate } from '../../components/Autopilot/blueprintGate'
import type { SandboxWriter } from '../../components/Autopilot/blueprintRenderSandbox'
import type { BuilderTargets } from '../../components/Autopilot/builderTargets'
import { readDraftRecord, treeHash, type DraftRecordBody } from '../../components/Autopilot/draftRecord'
import { emitDraftChanged } from '../../components/Autopilot/previewDraftChanged'
import { emitDraftResume } from '../../components/Autopilot/previewDraftResume'
import { lintHeldDraft } from '../../components/Autopilot/proposedChart'
import { heldDraftIdentity } from '../../components/Autopilot/publishCompile'
import { publishDraft, REGISTRATION_PATH } from '../../components/Autopilot/publishDraft'
import { publishedLocks } from '../../components/Autopilot/publishedLocks'
import { CONTROLLER_RENDER_FAILED, CONTROLLER_RENDER_NOT_CONFIGURED, CONTROLLER_STARTED, useBlueprintAuthoringBuses } from '../../components/Autopilot/useBlueprintAuthoringBuses'
import { createDraftAutosave, type DraftAutosave } from '../../components/Autopilot/useDraftAutosave'
import { createBroadcastingDraftStore, useDraftFileBuses } from '../../components/Autopilot/useDraftFileBuses'
import { useDraftResumeBus } from '../../components/Autopilot/useDraftResumeBus'
import type { WriteOp } from '../../components/BlastRadius/buildBlastRadius'
import { ConfigContext } from '../../context/ConfigContext'
import { ThemeModeProvider } from '../../context/ThemeModeContext'
import { installAntdShims } from '../PageComposer/composerTestHarness'

import { lockedSnapshot, readController, RESTDEFINITION_PATH } from './controllerChart'
import ControllerComposer from './ControllerComposer'
import { DRAG_GROUP } from './ControllerPalette'
import { CONTROLLER_FAILED_CAPTION, CONTROLLER_STALE_CAPTION, RENDERED_FAILED_PLACEHOLDER } from './controllerPreviewPayload'
import { CONTROLLER_DRAFT_KEY, CONTROLLER_PURPOSE_LABEL } from './controllerRender'
import { validateControllerRestDefinition } from './restDefinitionBuild'

const PETSTORE = readFileSync(join(__dirname, '__fixtures__', 'petstore-v3.openapi.json'), 'utf8')

beforeAll(() => {
  installAntdShims()
  Element.prototype.scrollIntoView = () => undefined
})
afterEach(() => {
  publishedLocks.set(null)
  cleanup()
  act(() => emitDraftChanged({ files: {}, kind: null }))
})

const REACT_ID = /_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g
const ID_ATTRS = new Set(['id', 'for', 'aria-describedby', 'aria-labelledby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'data-node-key'])

/** The element tree as indented lines (composerStructure.test.tsx's outline), code blocks collapsed. */
const outline = (root: Element): string => {
  const ids = new Map<string, string>()
  const idOf = (raw: string): string => raw.split(/\s+/).filter(Boolean).map((one) => {
    if (!ids.has(one)) { ids.set(one, `id${ids.size + 1}`) }
    return ids.get(one) as string
  })
    .join(' ')
  const lines: string[] = []
  const walk = (node: Node, depth: number) => {
    const pad = '  '.repeat(depth)
    if (node.nodeType === Node.TEXT_NODE) {
      // The save indicator's time is local wall-clock time: masked, so the snapshot is the same in every TZ.
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/\bSaved · \d{1,2}:\d{2}\b/g, 'Saved · HH:MM')
      if (text) { lines.push(`${pad}"${text}"`) }
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) { return }
    const element = node as Element
    const attrs = [...element.attributes]
      .map((attr) => ({ name: attr.name, value: ID_ATTRS.has(attr.name) ? idOf(attr.value) : attr.value.replace(REACT_ID, (raw) => idOf(raw)) }))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, value }) => `${name}="${value}"`)
    lines.push(`${pad}<${element.tagName.toLowerCase()}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`)
    if (element.tagName === 'PRE') {
      lines.push(`${pad}  …${(element.textContent ?? '').split('\n').length} lines`)
      return
    }
    element.childNodes.forEach((child) => walk(child, depth + 1))
  }
  walk(root, 0)
  return lines.join('\n')
}

const page = (container: HTMLElement) => outline(container.firstElementChild as Element)

const CONFIG = { config: { api: { AUTOPILOT_KOG_BUILDER_REPO: 'krateo-platformops/krateo-oas', AUTOPILOT_KOG_BUILDER_TEMPLATE: 'krateo-blueprints/builder-scaffold' } } }

/** The composer beside the provider's real draft hooks; the store, once mounted. */
const mount = () => {
  const held: { store: BlueprintDraftStore | null } = { store: null }
  const Provider = () => {
    const [gate] = useState(() => createBlueprintGate())
    const [store] = useState(() => createBroadcastingDraftStore(gate))
    held.store = store
    useDraftFileBuses(store, gate, heldDraftIdentity)
    useBlueprintAuthoringBuses(store, gate, undefined)
    return null
  }
  const view = render(
    <AntdApp>
      <MemoryRouter>
        <ConfigContext.Provider value={CONFIG as never}>
          <ThemeModeProvider><ControllerComposer /><Provider /></ThemeModeProvider>
        </ConfigContext.Provider>
      </MemoryRouter>
    </AntdApp>,
  )
  if (!held.store) { throw new Error('the provider did not mount') }
  return { container: view.container, store: held.store }
}

const type = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label, { selector: 'input,textarea' }), { target: { value } })
}

/** Start petstore through the modal, as a person does. */
const startPetstore = () => {
  act(() => { screen.getByRole('button', { name: 'Start a controller' }).click() })
  const dialog = screen.getByRole('dialog')
  type('Controller name', 'petstore')
  type('API group', 'petstore.example.io')
  type('OpenAPI spec', PETSTORE)
  type('Base URL the controller calls', 'https://petstore3.swagger.io/api/v3')
  expect(within(dialog).getByTestId('derived-spec').textContent).toBe('OpenAPI 3.0.4 · Swagger Petstore - OpenAPI 3.0 · 13 paths · 19 operations · 2 security schemes · 33 KiB')
  expect(within(dialog).getByTestId('derived-group').textContent).toBe('petstore.example.io/v1alpha1')
  expect(within(dialog).getByTestId('derived-registration').textContent).toBe('CompositionDefinition petstore')
  act(() => { within(dialog).getByRole('button', { name: 'Start' }).click() })
}

const publishButton = (): HTMLButtonElement => screen.getByRole<HTMLButtonElement>('button', { name: /Publish/ })

describe('the Controller Builder has its composer', () => {
  it('is served at /controller-builder/compose', () => {
    expect(builderRoutes().map((route) => route.path)).toContain('/controller-builder/compose')
  })
})

describe('petstore, authored in the UI with no rail', () => {
  it('start → place pet and store → settle the findby conflict → auth → a chart tree T7\'s validator passes', () => {
    const { container, store } = mount()
    expect(screen.getByText(/No controller open\. Start one here, or ask Autopilot to draft one/)).toBeTruthy()
    expect(page(container)).toMatchSnapshot('empty')

    startPetstore()
    // Held as a controller, and its start answered plainly: nothing to render until a Kind is placed.
    expect(store.get()?.kind).toBe('controller')
    expect(screen.getByText(CONTROLLER_STARTED)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('petstore 0.1.0 · petstore.example.io')
    expect(page(container)).toMatchSnapshot('started')

    // pet, by its Place button: a Kind with its findby CONFLICT left for the person.
    act(() => { screen.getByRole('button', { name: 'Place pet as a Kind' }).click() })
    const inspector = () => within(screen.getByRole('region', { name: 'Inspector' }))
    expect(inspector().getByRole('radiogroup', { name: 'Which operation is findby' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Pet — create, get, update, delete; findby to choose$/ }).getAttribute('aria-pressed')).toBe('true')
    expect(store.get()?.files && lintHeldDraft(store.get()!.files, 'controller')).toEqual([
      'Pet: 2 operations look like findby (GET /pet/findByStatus, GET /pet/findByTags) — choose one in the inspector, or leave findby out.',
    ])
    expect(publishButton().disabled).toBe(true)
    expect(page(container)).toMatchSnapshot('kind placed with conflict')

    // Settled by a person's choice, never by the composer.
    act(() => { fireEvent.click(inspector().getByRole('radio', { name: 'GET /pet/findByStatus' })) })
    expect(inspector().queryByRole('radiogroup', { name: 'Which operation is findby' })).toBeNull()

    // store, DRAGGED from the palette onto Resources.
    const canvas = screen.getByRole('region', { name: /Resources canvas/ })
    act(() => {
      fireEvent.drop(canvas, { dataTransfer: { getData: (kind: string) => (kind === DRAG_GROUP ? 'store' : ''), types: [DRAG_GROUP] } })
    })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('petstore 0.1.0 · Pet, Store · petstore.example.io')

    // Auth: back on Pet, its header parameter moves to the Configuration.
    act(() => { screen.getByRole('button', { name: /^Pet — / }).click() })
    expect(inspector().getByText(/used: the PetConfiguration carries authentication\.apiKey/)).toBeTruthy()
    expect(inspector().getByText(/skipped: oauth2 is not generated/)).toBeTruthy()
    act(() => { fireEvent.click(inspector().getByRole('checkbox', { name: /api_key \(header\)/ })) })
    expect(page(container)).toMatchSnapshot('auth')

    // THE CHART TREE.
    const held = store.get()
    expect(held?.kind).toBe('controller')
    const { files } = (held!)
    expect(Object.keys(files).sort()).toEqual([
      'Chart.yaml',
      'templates/configmap-oas-petstore.yaml',
      'templates/restdefinition-pet.yaml',
      'templates/restdefinition-store.yaml',
      'values.schema.json',
      'values.yaml',
    ])
    expect(lintHeldDraft(files, 'controller')).toEqual([])
    const model = readController(files)
    const { doc } = model.spec!.oas
    for (const path of Object.keys(files).filter((entry) => RESTDEFINITION_PATH.test(entry))) {
      // T7's validator, on the RestDefinition as an install would read it (the release namespace named).
      const installed = JSON.parse(JSON.stringify(load(files[path])).split('{{ .Release.Namespace }}').join('krateo-system')) as Record<string, unknown>
      expect(validateControllerRestDefinition(installed, doc).errors, path).toEqual([])
    }
    const pet = load(files['templates/restdefinition-pet.yaml']) as { spec: { resource: Record<string, unknown> } }
    expect(pet.spec.resource).toMatchObject({
      configurationFields: [{ fromOpenAPI: { in: 'header', name: 'api_key' }, fromRestDefinition: { actions: ['delete'] } }],
      identifiers: ['id'],
      kind: 'Pet',
    })
    expect((pet.spec.resource.verbsDescription as { action: string; method: string; path: string }[]).map((verb) => `${verb.action} ${verb.method} ${verb.path}`)).toEqual([
      'create POST /pet',
      'get GET /pet/{petId}',
      'findby GET /pet/findByStatus',
      'update PUT /pet',
      'delete DELETE /pet/{petId}',
    ])

    // Publish stays gated: nothing has rendered it, and Preview — with no render configured in this mount — says why rather than faking one.
    expect(publishButton().disabled).toBe(true)
    const reason = document.getElementById(publishButton().getAttribute('aria-describedby') ?? '')
    expect(reason?.textContent).toBe('Preview needed — publishing stays off until Preview has rendered the controller exactly as it is now.')
    act(() => { screen.getByRole('button', { name: 'Preview' }).click() })
    expect(screen.getAllByText(CONTROLLER_RENDER_NOT_CONFIGURED).length).toBeGreaterThan(0)
    expect(publishButton().disabled).toBe(true)
  }, 120_000)

  it('a document that does not read says why, on its line, in the modal — and nothing is held', () => {
    const { store } = mount()
    act(() => { screen.getByRole('button', { name: 'Start a controller' }).click() })
    type('OpenAPI spec', 'openapi: 3.0.0\npaths: {\n  /x: [\n')
    expect(screen.getByText(/The spec could not be read on line \d+/)).toBeTruthy()
    act(() => { within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' }).click() })
    expect(store.get()).toBeNull()
  })

  it('another builder\'s draft is PARKED, named, with the way to it', () => {
    mount()
    act(() => emitDraftChanged({ files: { 'Chart.yaml': 'apiVersion: v2\nname: orders\nversion: 0.1.0\n' }, kind: 'blueprint' }))
    expect(screen.getByText(/A blueprint chart draft is open in this thread\. The Controller Builder edits controllers/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open it in the Blueprint Builder' }).getAttribute('href')).toBe('/blueprint-builder/compose')
  })

  it('review of #428: the modal says what it rewrites and what happens to the draft; Chart files opens first; a published Kind refuses a locked change', () => {
    const { store } = mount()
    act(() => { screen.getByRole('button', { name: 'Start a controller' }).click() })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('The draft is saved in your drafts as you work. Nothing is published before the change request.')).toBeTruthy()
    const doc = JSON.parse(PETSTORE) as { paths: Record<string, Record<string, unknown>> }
    doc.paths['/pet'].servers = [{ url: 'https://attacker.example' }]
    type('Controller name', 'petstore')
    type('API group', 'petstore.example.io')
    type('OpenAPI spec', JSON.stringify(doc))
    type('Base URL the controller calls', 'https://petstore3.swagger.io/api/v3')
    expect(within(dialog).getByText(/names its own servers beside the root \(paths\.\/pet\.servers\); each is rewritten to https:\/\/petstore3\.swagger\.io\/api\/v3/)).toBeTruthy()
    act(() => { within(dialog).getByRole('button', { name: 'Start' }).click() })

    // Chart files is the tab the files pane opens on, while Rendered has nothing to show.
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Chart files')

    // Place pet, then its publish lands (the lock the autosave keeps): a locked field refuses.
    act(() => { screen.getByRole('button', { name: 'Place pet as a Kind' }).click() })
    act(() => { publishedLocks.set({ kind: 'controller', locked: lockedSnapshot(store.get()!.files), name: 'petstore' }) })
    const inspector = within(screen.getByRole('region', { name: 'Inspector' }))
    expect(inspector.getByText(/Pet is published: its kind, group, identifiers, configuration fields and status fields cannot change in place/)).toBeTruthy()
    const before = store.get()!.files
    act(() => { fireEvent.click(inspector.getByRole('checkbox', { name: /^name/ })) })
    expect(inspector.getByText(/^cannot update Pet in place: identifiers is locked once published \(\["id"\] → \["id","name"\]\)/)).toBeTruthy()
    expect(store.get()!.files).toBe(before)
  }, 120_000)
})

/**
 * T9 (frontend#413) — PREVIEW RENDERS THE CONTROLLER, and the publish acceptance #412 moved here.
 *
 * The provider's real hooks as AutopilotProvider mounts them — the store with the draft-record
 * autosave, the gate, the file buses, the authoring buses WITH a config and the audited sandbox
 * writer, and the resume bus. The only fakes are at the wire: the sandbox writer (it records every
 * op and answers OK) and `fetch` — snowplow /call, answering controller-render-draft with the three
 * shapes portal#277 documents (ok, problems, service down) and the builder-publish
 * CompositionDefinition the claim's GVR is resolved from. The live end-to-end waits on the oasgen
 * 0.25.0 roll (render.enabled) and portal#277.
 */
describe('T9 — Preview renders the controller through controller-render-draft', () => {
  const SANDBOX = 'krateo-preview'
  const T9_CONFIG = {
    api: {
      AUTOPILOT_GIT_HOST: 'github.com',
      AUTOPILOT_KOG_BUILDER_REPO: 'krateo-platformops/krateo-oas',
      AUTOPILOT_KOG_BUILDER_TEMPLATE: 'krateo-blueprints/builder-scaffold',
      SNOWPLOW_API_BASE_URL: 'https://snowplow.test',
    },
    params: { FRONTEND_NAMESPACE: 'krateo-system' },
  }
  const TARGETS: BuilderTargets = {
    blueprint: { owner: '', repo: '' },
    blueprintTemplate: { owner: '', repo: '' },
    kog: { owner: 'krateo-platformops', repo: 'krateo-oas' },
    kogTemplate: { owner: 'krateo-blueprints', repo: 'builder-scaffold' },
    page: { owner: '', repo: '' },
    pageTemplate: { owner: '', repo: '' },
  }

  const crd = (kind: string, plural: string, spec: Record<string, unknown>) => ({
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
    metadata: { name: `${plural}.petstore.example.io` },
    spec: {
      group: 'petstore.example.io',
      names: { kind, plural },
      scope: 'Namespaced',
      versions: [{ name: 'v1alpha1', schema: { openAPIV3Schema: { properties: { spec: { properties: spec, type: 'object' }, status: { type: 'object' } }, type: 'object' } }, served: true, storage: true }],
    },
  })
  const CRDS = [
    crd('Pet', 'pets', { configurationRef: { properties: { name: { type: 'string' } }, type: 'object' }, photoUrls: { items: { type: 'string' }, type: 'array' }, status: { enum: ['available', 'pending', 'sold'], type: 'string' } }),
    crd('Store', 'stores', { quantity: { type: 'integer' } }),
  ]
  const CONFIGURATION_CRDS = [crd('PetConfiguration', 'petconfigurations', { authentication: { type: 'object' } })]
  const SKIPPED = `${SANDBOX}/petstore-pet: security scheme not supported, skipped: petstore_auth (type: oauth2, in: )`
  const DOWN = 'Controller preview needs oasgen-render (oasgen-provider ≥0.25.0 with render.enabled): Post "http://oasgen-provider-render.krateo-system.svc:80/render": dial tcp: lookup oasgen-provider-render.krateo-system.svc: no such host'
  const FINDING = `${SANDBOX}/petstore-store spec.resource.verbsDescription[0]: response schema has no identifier`
  /** controller-render-draft's `.status`, as portal#277's filter shapes each answer. */
  const RA = {
    down: { error: DOWN, objects: [], problems: [DOWN], warnings: [] },
    ok: {
      configurationCrds: CONFIGURATION_CRDS,
      crds: CRDS,
      errors: [],
      objects: [...CRDS, ...CONFIGURATION_CRDS].map((object) => ({ apiVersion: object.apiVersion, kind: object.kind, name: object.metadata.name, namespace: '', yaml: JSON.stringify(object) })),
      problems: [],
      skipped: [{ restDefinition: `${SANDBOX}/petstore-pet`, scheme: 'petstore_auth (type: oauth2, in: )' }],
      warnings: [SKIPPED],
    },
    problems: { error: FINDING, objects: [], problems: [FINDING], warnings: [] },
  }
  const BUILDER_PUBLISH_CD = { status: { managed: { group: 'composition.krateo.io', versionInfo: [{ served: true, version: 'v0-2-0' }] }, resource: 'builderpublishes' } }

  /** snowplow /call: the RESTAction's status (switchable), the builder-publish CompositionDefinition, and every URL asked. */
  const stubSnowplow = (initial: Record<string, unknown> | number) => {
    let answer = initial
    const urls: string[] = []
    const fetchMock = vi.fn((url: string) => {
      urls.push(url)
      if (url.includes('resource=compositiondefinitions')) {
        return Promise.resolve({ json: () => Promise.resolve(BUILDER_PUBLISH_CD), ok: true, status: 200 })
      }
      if (typeof answer === 'number') {
        return Promise.resolve({ json: () => Promise.resolve(null), ok: false, status: answer })
      }
      return Promise.resolve({ json: () => Promise.resolve({ kind: 'RESTAction', status: answer }), ok: true, status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    return { set: (next: Record<string, unknown> | number) => { answer = next }, urls }
  }

  /** The audited sandbox writer, faked at its edge: every op recorded, every op answered OK. */
  const sandboxWriter = () => {
    const ops: WriteOp[] = []
    const writer: SandboxWriter = {
      handleActionSet: (batch) => {
        ops.push(...batch)
        return Promise.resolve(batch.map((op, index) => ({ index, message: 'OK', ok: true, status: op.verb === 'POST' ? 201 : 200 })))
      },
      sandboxNamespace: SANDBOX,
    }
    return { ops, writer }
  }

  const nameOf = (op: WriteOp): string => ((op.payload as { metadata?: { name?: string } } | undefined)?.metadata?.name) ?? new URL(op.path, 'http://x').searchParams.get('name') ?? ''

  const mountWired = () => {
    const held: { store: BlueprintDraftStore | null; gate: ReturnType<typeof createBlueprintGate> | null } = { gate: null, store: null }
    const sandbox = sandboxWriter()
    const Provider = () => {
      const [gate] = useState(() => createBlueprintGate())
      const [autosave] = useState((): DraftAutosave => {
        const created = createDraftAutosave({ now: () => new Date('2026-09-30T10:00:00Z'), username: () => 'diego' })
        created.setWriter(sandbox.writer)
        return created
      })
      const [store] = useState(() => createBroadcastingDraftStore(gate, autosave.onHeldChange))
      held.store = store
      held.gate = gate
      useDraftFileBuses(store, gate, heldDraftIdentity)
      useBlueprintAuthoringBuses(store, gate, T9_CONFIG as never, sandbox.writer, autosave)
      useDraftResumeBus(store, gate, { autosave, sandboxWriter: sandbox.writer })
      return null
    }
    const view = render(
      <AntdApp>
        <MemoryRouter>
          <ConfigContext.Provider value={{ config: T9_CONFIG } as never}>
            <ThemeModeProvider><ControllerComposer /><Provider /></ThemeModeProvider>
          </ConfigContext.Provider>
        </MemoryRouter>
      </AntdApp>,
    )
    if (!held.store || !held.gate) { throw new Error('the provider did not mount') }
    return { container: view.container, gate: held.gate, ops: sandbox.ops, store: held.store }
  }

  /** Petstore as #412 authors it: pet placed with findby settled, store placed — a lint-clean chart. */
  const authorPetstore = () => {
    startPetstore()
    act(() => { screen.getByRole('button', { name: 'Place pet as a Kind' }).click() })
    act(() => { fireEvent.click(within(screen.getByRole('region', { name: 'Inspector' })).getByRole('radio', { name: 'GET /pet/findByStatus' })) })
    act(() => { screen.getByRole('button', { name: 'Place store as a Kind' }).click() })
  }

  const preview = async () => {
    await act(async () => {
      screen.getByRole('button', { name: 'Preview' }).click()
      // Let the render's promise chain (flush, write, /call, delete) start inside act.
      await Promise.resolve()
    })
  }

  const publishDeps = (gate: ReturnType<typeof createBlueprintGate>, store: BlueprintDraftStore) =>
    ({ blueprintGate: gate, blueprintStore: store, builderTargets: TARGETS, config: T9_CONFIG, initiator: 'person', origin: { prompt: null, sessionId: null } }) as unknown as Parameters<typeof publishDraft>[0]

  afterEach(() => {
    vi.unstubAllGlobals()
    // unstubAllGlobals takes the antd shims' matchMedia with it.
    installAntdShims()
  })

  it('OK: lint → draft.json into the sandbox → controller-render-draft over /call → Publish ARMED; Rendered is each Kind\'s create form, Source the CRDs', async () => {
    const snowplow = stubSnowplow(RA.ok)
    const { container, ops, store } = mountWired()
    authorPetstore()
    expect(lintHeldDraft(store.get()!.files, 'controller')).toEqual([])
    expect(publishButton().disabled).toBe(true)

    await preview()
    await waitFor(() => expect(publishButton().disabled).toBe(false))

    // WRITE: one ConfigMap in the sandbox, draft.json = the RestDefinitions + the documents by exact oasPath.
    const renderWrites = ops.filter((op) => nameOf(op).startsWith('ctl-preview-'))
    expect(renderWrites.map((op) => op.verb)).toEqual(['POST', 'DELETE'])
    const configMap = renderWrites[0].payload as { data: Record<string, string>; metadata: { labels: Record<string, string>; name: string; namespace: string } }
    expect(configMap.metadata).toMatchObject({ labels: { 'krateo.io/purpose': CONTROLLER_PURPOSE_LABEL }, namespace: SANDBOX })
    expect(configMap.metadata.name).toMatch(/^ctl-preview-petstore-[a-z0-9]+$/)
    expect(Object.keys(configMap.data)).toEqual([CONTROLLER_DRAFT_KEY])
    const draft = JSON.parse(configMap.data[CONTROLLER_DRAFT_KEY]) as { restDefinitions: { metadata: { name: string; namespace: string }; spec: { oasPath: string } }[]; oas: Record<string, string> }
    const oasPath = `configmap://${SANDBOX}/petstore-oas/openapi.json`
    expect(draft.restDefinitions.map((entry) => [entry.metadata.namespace, entry.metadata.name, entry.spec.oasPath])).toEqual([
      [SANDBOX, 'petstore-pet', oasPath],
      [SANDBOX, 'petstore-store', oasPath],
    ])
    expect(Object.keys(draft.oas)).toEqual([oasPath])
    expect((JSON.parse(draft.oas[oasPath]) as { servers: unknown }).servers).toEqual([{ url: 'https://petstore3.swagger.io/api/v3' }])
    expect(configMap.data[CONTROLLER_DRAFT_KEY]).not.toContain('.Release.Namespace')
    // The DELETE is the same ConfigMap: the draft does not outlive its render.
    expect(nameOf(renderWrites[1])).toBe(configMap.metadata.name)
    // WRITE-AHEAD: the draft record was stored before the render wrote anything.
    const firstRender = ops.findIndex((op) => nameOf(op).startsWith('ctl-preview-'))
    expect(ops.slice(0, firstRender).some((op) => nameOf(op).startsWith('draft-controller-'))).toBe(true)

    // RENDER: the Builder's RESTAction by name, as the caller, only the ConfigMap's name in ?extras. No widgetEndpoint.
    const call = new URL(snowplow.urls.find((url) => url.includes('resource=restactions'))!)
    expect(call.pathname).toBe('/call')
    expect(Object.fromEntries(call.searchParams)).toEqual({
      apiVersion: 'templates.krateo.io/v1',
      extras: JSON.stringify({ name: configMap.metadata.name, namespace: SANDBOX }),
      name: 'controller-render-draft',
      namespace: 'krateo-system',
      resource: 'restactions',
    })
    expect(snowplow.urls.some((url) => /widgetEndpoint/i.test(url))).toBe(false)

    // RENDERED: the create form of every generated CRD, the skipped scheme said above them.
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Rendered')
    expect(screen.getByText('Pet — create form')).toBeTruthy()
    expect(screen.getByText('Store — create form')).toBeTruthy()
    expect(screen.getByText('PetConfiguration — create form')).toBeTruthy()
    expect(screen.getByText(SKIPPED)).toBeTruthy()
    expect(screen.getByText(/^Rendered 3 objects/)).toBeTruthy()
    expect(page(container)).toMatchSnapshot('rendered')

    // SOURCE: the CRDs themselves.
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Source' })) })
    expect(screen.getByText('pets.petstore.example.io')).toBeTruthy()
    expect(screen.getByText('petconfigurations.petstore.example.io')).toBeTruthy()
  }, 120_000)

  it('an EDIT disarms Publish and dates the render; Preview RE-ARMS it; the publish path then builds the BuilderPublish claim (#412 acceptance, to the cluster)', async () => {
    stubSnowplow(RA.ok)
    const { gate, store } = mountWired()
    authorPetstore()
    await preview()
    await waitFor(() => expect(publishButton().disabled).toBe(false))

    // An edit — a person's, in the inspector — turns Publish off, and the render is said to be old.
    act(() => { screen.getByRole('button', { name: /^Pet — / }).click() })
    act(() => { fireEvent.click(within(screen.getByRole('region', { name: 'Inspector' })).getByRole('checkbox', { name: /^name/ })) })
    await waitFor(() => expect(publishButton().disabled).toBe(true))
    expect(screen.getByText(CONTROLLER_STALE_CAPTION)).toBeTruthy()
    const refused = await publishDraft(publishDeps(gate, store), { label: 'Publish', verb: 'publishRestDef' })
    expect(refused.compiled.ops).toBeNull()
    expect(refused.compiled.denial).toMatch(/preview/i)

    // Preview re-arms it.
    await preview()
    await waitFor(() => expect(publishButton().disabled).toBe(false))

    // THE PUBLISH PATH: one BuilderPublish claim, builder=controller, seeded from builder-scaffold,
    // the chart files verbatim plus compositiondefinition.yaml.
    const { files } = store.get()!
    const published = await publishDraft(publishDeps(gate, store), { label: 'Publish', verb: 'publishRestDef' })
    expect(published.compiled.denial).toBeNull()
    expect(published.compiled.ops).toHaveLength(1)
    const [op] = published.compiled.ops!
    expect(op.verb).toBe('POST')
    expect(op.gvr).toEqual({ group: 'composition.krateo.io', resource: 'builderpublishes', version: 'v0-2-0' })
    const claim = op.payload as { apiVersion: string; kind: string; spec: { builder: string; files: { path: string; content: string }[]; source?: { url: string }; target: Record<string, string> } }
    expect(claim).toMatchObject({ apiVersion: 'composition.krateo.io/v0-2-0', kind: 'BuilderPublish' })
    expect(claim.spec.builder).toBe('controller')
    expect(claim.spec.source?.url).toBe('https://github.com/krateo-blueprints/builder-scaffold.git')
    expect(claim.spec.target).toMatchObject({ base: 'main', namespace: 'krateo-platformops', repo: 'petstore' })
    expect(claim.spec.files.map((file) => file.path).sort()).toEqual([
      'Chart.yaml',
      REGISTRATION_PATH,
      'templates/configmap-oas-petstore.yaml',
      'templates/restdefinition-pet.yaml',
      'templates/restdefinition-store.yaml',
      'values.schema.json',
      'values.yaml',
    ])
    for (const file of claim.spec.files.filter((entry) => entry.path !== REGISTRATION_PATH)) {
      expect(file.content, file.path).toBe(files[file.path])
    }
    expect(load(claim.spec.files.find((file) => file.path === REGISTRATION_PATH)!.content)).toMatchObject({
      kind: 'CompositionDefinition',
      spec: { chart: { url: 'oci://ghcr.io/krateo-platformops/charts/petstore', version: '0.1.0' } },
    })
  }, 120_000)

  it('RESUME re-arms only when the record\'s renderedHash is the held tree\'s', async () => {
    stubSnowplow(RA.ok)
    const { gate, ops, store } = mountWired()
    authorPetstore()
    await preview()
    await waitFor(() => expect(publishButton().disabled).toBe(false))
    const rendered = store.get()!.files
    const records = ops.filter((op) => nameOf(op).startsWith('draft-controller-')).map((op) => readDraftRecord(op.payload)).filter((body): body is DraftRecordBody => body !== null)
    const record = records.at(-1)!
    expect(record.renderedHash).toBe(treeHash(rendered))

    // The record as stored: re-armed.
    act(() => { emitDraftResume({ id: 'r1', record, replace: true }) })
    expect(gate.isArmed(heldDraftIdentity(store.get()))).toBe(true)
    await waitFor(() => expect(publishButton().disabled).toBe(false))

    // A record whose tree moved on after its render (the hash names another tree): held, NOT armed.
    const edited = { ...rendered, 'values.yaml': `${rendered['values.yaml']}# edited after the preview\n` }
    act(() => { emitDraftResume({ id: 'r2', record: { ...record, files: edited }, replace: true }) })
    expect(store.get()!.files).toEqual(edited)
    expect(gate.isArmed(heldDraftIdentity(store.get()))).toBe(false)
    await waitFor(() => expect(publishButton().disabled).toBe(true))
  }, 120_000)

  it('PROBLEMS: a severity:error finding fails the preview — Publish stays off, the problems are said and in Source', async () => {
    stubSnowplow(RA.problems)
    mountWired()
    authorPetstore()
    await preview()
    await waitFor(() => expect(screen.getByText(`${CONTROLLER_RENDER_FAILED} Its problems are in Source.`)).toBeTruthy())
    expect(publishButton().disabled).toBe(true)
    expect(screen.getAllByText(FINDING).length).toBeGreaterThan(0)
    expect(screen.getByText(CONTROLLER_FAILED_CAPTION)).toBeTruthy()
    // Review of #430: the pane lands where the caption points — Source, with the problems alert.
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Source')
    expect(screen.getByText('Validation errors — publishing this draft would be rejected')).toBeTruthy()
    // Nothing rendered: Rendered says why, Source carries the problems alert.
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Rendered' })) })
    expect(screen.getByText(RENDERED_FAILED_PLACEHOLDER)).toBeTruthy()
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Source' })) })
    expect(screen.getByText('Validation errors — publishing this draft would be rejected')).toBeTruthy()
  }, 120_000)

  it('SERVICE DOWN: oasgen-render missing is the RESTAction\'s own sentence, and Publish stays off; a portal without the RESTAction says so too', async () => {
    const snowplow = stubSnowplow(RA.down)
    mountWired()
    authorPetstore()
    await preview()
    await waitFor(() => expect(screen.getByText(DOWN)).toBeTruthy())
    expect(publishButton().disabled).toBe(true)
    // Review of #430: a render that could not run is a warning; only CONTROLLER_STARTED is info.
    expect(screen.getByText(DOWN).closest('[role="alert"]')?.className).toContain('ant-alert-warning')
    // No fake success: nothing rendered, nothing in Rendered.
    expect(screen.queryByText(/— create form$/)).toBeNull()

    snowplow.set(404)
    await preview()
    await waitFor(() => expect(screen.getByText(/^controller-render-draft RESTAction responded 404 — this portal cannot preview a controller without its controller-render-draft RESTAction \(portal#277\)/)).toBeTruthy())
    expect(publishButton().disabled).toBe(true)
  }, 120_000)
})
