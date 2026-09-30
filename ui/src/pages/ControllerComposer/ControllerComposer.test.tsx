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

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { load } from 'js-yaml'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { builderRoutes } from '../../builders/host/builderRoutes'
import type { BlueprintDraftStore } from '../../components/Autopilot/blueprintDraftStore'
import { createBlueprintGate } from '../../components/Autopilot/blueprintGate'
import { emitDraftChanged } from '../../components/Autopilot/previewDraftChanged'
import { lintHeldDraft } from '../../components/Autopilot/proposedChart'
import { heldDraftIdentity } from '../../components/Autopilot/publishCompile'
import { publishedLocks } from '../../components/Autopilot/publishedLocks'
import { CONTROLLER_PREVIEW_UNAVAILABLE, useBlueprintAuthoringBuses } from '../../components/Autopilot/useBlueprintAuthoringBuses'
import { createBroadcastingDraftStore, useDraftFileBuses } from '../../components/Autopilot/useDraftFileBuses'
import { ConfigContext } from '../../context/ConfigContext'
import { ThemeModeProvider } from '../../context/ThemeModeContext'
import { installAntdShims } from '../PageComposer/composerTestHarness'

import { lockedSnapshot, readController, RESTDEFINITION_PATH } from './controllerChart'
import ControllerComposer from './ControllerComposer'
import { DRAG_GROUP } from './ControllerPalette'
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
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
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
    // Held as a controller, and its "preview" answered plainly: not available yet.
    expect(store.get()?.kind).toBe('controller')
    expect(screen.getByText(CONTROLLER_PREVIEW_UNAVAILABLE)).toBeTruthy()
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

    // Publish stays gated: nothing has rendered it, and Preview says why rather than faking one.
    expect(publishButton().disabled).toBe(true)
    const reason = document.getElementById(publishButton().getAttribute('aria-describedby') ?? '')
    expect(reason?.textContent).toBe('Preview needed — publishing stays off until Preview has rendered the controller exactly as it is now.')
    act(() => { screen.getByRole('button', { name: 'Preview' }).click() })
    expect(screen.getAllByText(CONTROLLER_PREVIEW_UNAVAILABLE).length).toBeGreaterThan(0)
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
