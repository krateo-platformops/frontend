// @vitest-environment jsdom
/**
 * T4's ACCEPTANCE (frontend#410): a stub Builder CR works end to end — start → edit → preview →
 * publish — rendered by ComposerHost at the route the Builder declares.
 *
 * The stub is NOT one of the fixtures: its own name, label, route and verbs, reusing plugins this
 * frontend already ships (ADR 0001, promotion step 1: a builder that reuses registered plugins is YAML
 * only). It replaces the whole registry, so nothing about the Blueprint Builder can answer for it —
 * the route, the header's words and the publish verb all have to come from the stub's spec.
 *
 * Behind the page runs the provider's REAL draft half — store, gate, file buses, the chart start and
 * render, and the person's publish (runPersonPublish) — with only the two cluster calls answered: the
 * render RESTAction and the BuilderPublish GVR lookup. The apply a person would confirm is recorded.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import yaml from 'js-yaml'
import { useEffect, useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))
vi.mock('../../components/Autopilot/previewBridge', async (importOriginal) => ({
  ...await importOriginal<object>(),
  callBlueprintRenderRA: vi.fn(),
}))
vi.mock('../../components/Autopilot/builderPublishGvr', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveBuilderPublishGvr: () => Promise.resolve({
    apiVersion: 'builder.krateo.io/v1alpha1',
    gvr: { group: 'builder.krateo.io', resource: 'builderpublishes', version: 'v1alpha1' },
  }),
}))

import type { ApplyResourceSetOp } from '../../components/Autopilot/applyResourceSet'
import { createBlueprintGate } from '../../components/Autopilot/blueprintGate'
import type { BuilderTargets } from '../../components/Autopilot/builderTargets'
import { draftHistory } from '../../components/Autopilot/draftHistory'
import { callBlueprintRenderRA } from '../../components/Autopilot/previewBridge'
import { emitPublishResult, onPublishRequest } from '../../components/Autopilot/previewPublishRequest'
import { heldDraftIdentity } from '../../components/Autopilot/publishCompile'
import { runPersonPublish } from '../../components/Autopilot/publishDraft'
import type { AutopilotActionChip } from '../../components/Autopilot/types'
import { useBlueprintAuthoringBuses } from '../../components/Autopilot/useBlueprintAuthoringBuses'
import { createBroadcastingDraftStore, useDraftFileBuses } from '../../components/Autopilot/useDraftFileBuses'
import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'
import { ConfigContext } from '../../context/ConfigContext'
import { ThemeModeProvider } from '../../context/ThemeModeContext'
import { installAntdShims, installScrollShim } from '../../pages/BlueprintComposer/blueprintTestHarness'
import { swapBuildersForTest } from '../builderRegistry'
import { parseBuilder, type Builder } from '../builderSpec'

import { builderRoutes } from './builderRoutes'
import ComposerHost from './ComposerHost'

const STUB_ROUTE = '/stub-builder/compose'

/** The Blueprint Builder's CR, re-declared as another builder: its own name, label, route and verbs. */
const stubBuilder = (): Builder => {
  const raw = yaml.load(readFileSync(join(__dirname, '..', 'fixtures', 'blueprint-builder.builder.yaml'), 'utf8')) as { spec: Record<string, unknown> }
  const parsed = parseBuilder({
    ...raw,
    metadata: { name: 'stub-builder' },
    spec: {
      ...raw.spec,
      label: 'Stub Builder',
      route: STUB_ROUTE,
      verbs: { allowed: ['chartPut', 'previewBlueprint', 'publishBlueprint'] },
    },
  })
  if (!parsed.ok) { throw new Error(`stub Builder refused: ${parsed.problems.join('; ')}`) }
  return parsed.builder
}

const TARGETS: BuilderTargets = {
  blueprint: { owner: 'stub-org', repo: '<chart>' },
  blueprintTemplate: { owner: 'krateo-blueprints', repo: 'builder-scaffold' },
  kog: { owner: '', repo: '' },
  page: { owner: '', repo: '' },
  pageTemplate: { owner: '', repo: '' },
}

const CONFIG = {
  api: { AUTOPILOT_BLUEPRINT_BUILDER_REPO: 'stub-org/<chart>', AUTOPILOT_GIT_HOST: 'git.example.com', SNOWPLOW_API_BASE_URL: 'http://snowplow' },
  params: { FRONTEND_NAMESPACE: 'krateo-system' },
}

/** What the person's confirm was asked to write, in order. */
const applied: ApplyResourceSetOp[][] = []

/** The provider's draft half, for real, and its answer to a person's Publish. */
const Provider = () => {
  const [gate] = useState(() => createBlueprintGate())
  const [store] = useState(() => createBroadcastingDraftStore(gate))
  useDraftFileBuses(store, gate, heldDraftIdentity)
  useBlueprintAuthoringBuses(store, gate, CONFIG as never)
  useEffect(() => onPublishRequest(({ id, verb }) => {
    void (async () => {
      const answer = await runPersonPublish({
        apply: (ops) => {
          applied.push(ops)
          return Promise.resolve<AutopilotActionChip>({ label: 'Publish', readOnly: false, verb: 'applyResourceSet' })
        },
        blueprintGate: gate,
        blueprintStore: store,
        builderTargets: TARGETS,
        config: CONFIG as never,
        origin: { prompt: null, sessionId: null },
        track: () => undefined,
      }, verb)
      emitPublishResult({ id, ...answer })
    })()
  }), [gate, store])
  return null
}

/** The shell's builder routes, at the stub's URL. */
const mountAtRoute = () => render(
  <AntdApp>
    <ConfigContext.Provider value={{ config: CONFIG } as never}>
      <ThemeModeProvider>
        <MemoryRouter initialEntries={[STUB_ROUTE]}>
          <Provider />
          <Routes>
            {builderRoutes().map((route) => <Route element={route.element} key={route.path} path={route.path} />)}
          </Routes>
        </MemoryRouter>
      </ThemeModeProvider>
    </ConfigContext.Provider>
  </AntdApp>,
)

/** Let the provider's awaited work (the render, the publish) land. */
const settle = async () => {
  await act(() => Array.from({ length: 6 }).reduce<Promise<void>>((turn) => turn.then(() => Promise.resolve()), Promise.resolve()))
}

const publishButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /Publish/ })

let restore: () => void

beforeAll(() => {
  installAntdShims()
  installScrollShim()
  restore = swapBuildersForTest([stubBuilder()])
})
afterAll(() => restore())
beforeEach(() => {
  graphDouble.reset()
  draftHistory.clear()
  applied.length = 0
  vi.mocked(callBlueprintRenderRA).mockReset()
  vi.mocked(callBlueprintRenderRA).mockResolvedValue({ objects: [] })
})
afterEach(cleanup)

describe('a stub Builder, end to end in the composer host', () => {
  it('is routed by its spec, and its header speaks its label', () => {
    expect(builderRoutes().map((route) => route.path)).toEqual([STUB_ROUTE])
    mountAtRoute()
    expect(screen.getByText('Stub Builder / Compose')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start a chart' })).toBeTruthy()
  })

  it('start → edit → preview → publish', async () => {
    mountAtRoute()

    // START: the empty state's Start, the stub's start form, and the provider holds and renders it.
    act(() => { screen.getByRole('button', { name: 'Start a chart' }).click() })
    act(() => { fireEvent.change(screen.getByLabelText('Chart name'), { target: { value: 'orders-api' } }) })
    act(() => { within(screen.getByRole('dialog')).getByRole('button', { name: 'Start' }).click() })
    await settle()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('orders-api')
    expect(screen.getByText('Stub Builder / Compose')).toBeTruthy()
    // The start's first render armed the gate: Publish is on.
    expect(publishButton().disabled).toBe(false)

    // EDIT: values.yaml, in place in the files pane — Publish goes off until the next Preview.
    const pane = screen.getByRole('region', { name: 'Chart files and Source' })
    const block = within(pane).getAllByText('values.yaml').map((heading) => heading.closest('div[id^="preview-file-"]'))
      .find((found): found is HTMLElement => found instanceof HTMLElement) as HTMLElement
    act(() => { within(block).getByRole('button', { name: 'Edit' }).click() })
    act(() => { fireEvent.change(within(block).getByLabelText('Edit values.yaml'), { target: { value: 'replicas: 2\n' } }) })
    act(() => { within(block).getByRole('button', { name: 'Apply edits' }).click() })
    await settle()
    expect(publishButton().disabled).toBe(true)
    expect(screen.getByText('Preview needed')).toBeTruthy()
    expect(screen.getByText(/publishing stays off until Preview has rendered the chart exactly as it is now/)).toBeTruthy()

    // PREVIEW: the render runs through the stub's preview RESTAction, as the provider does it.
    const rendersBefore = vi.mocked(callBlueprintRenderRA).mock.calls.length
    act(() => { screen.getByRole('button', { name: 'Preview' }).click() })
    await settle()
    expect(vi.mocked(callBlueprintRenderRA).mock.calls.length).toBe(rendersBefore + 1)
    expect(publishButton().disabled).toBe(false)
    expect(screen.queryByText('Preview needed')).toBeNull()

    // PUBLISH: the stub allows publishBlueprint; the provider compiles one BuilderPublish claim of the
    // edited bytes to the stub's destination, a person's confirm writes it, and the page says so.
    act(() => { publishButton().click() })
    await settle()
    expect(applied).toHaveLength(1)
    const [[claim]] = applied
    expect(claim.gvr.resource).toBe('builderpublishes')
    expect(JSON.stringify(claim.payload)).toContain('stub-org')
    expect(JSON.stringify(claim.payload)).toContain('replicas: 2')
    expect(screen.getByText('Published — the change request is open for review.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open change request' })).toBeTruthy()
  })

  it('a Builder naming a plugin this frontend does not ship is said, not mounted', () => {
    const broken = stubBuilder()
    broken.spec.canvas = { plugin: 'restdef-mapping' }
    const back = swapBuildersForTest([broken])
    try {
      mountAtRoute()
      expect(screen.getByText('The Stub Builder cannot be shown by this frontend.')).toBeTruthy()
      expect(screen.getByText(/no canvas plugin named "restdef-mapping"/)).toBeTruthy()
    } finally {
      back()
    }
  })

  it('a Builder whose composer is not built yet (every plugin PENDING) gets no route; mounted directly, it says so', () => {
    const pending = stubBuilder()
    pending.spec.palette = { plugin: 'openapi' }
    pending.spec.canvas = { plugin: 'restdef-graph' }
    pending.spec.inspector = { plugin: 'restdef-mapping' }
    const back = swapBuildersForTest([pending])
    try {
      expect(builderRoutes()).toEqual([])
      render(<AntdApp><ComposerHost builder={pending} /></AntdApp>)
      expect(screen.getByText('The Stub Builder cannot be shown by this frontend.')).toBeTruthy()
      expect(screen.getAllByText(/is not shipped in this frontend yet/)).toHaveLength(3)
    } finally {
      back()
    }
  })

  it('a plugin paired with another draft kind\'s workbench is refused by name', () => {
    const crossed = stubBuilder()
    crossed.spec.inspector = { plugin: 'object-tree' }
    const back = swapBuildersForTest([crossed])
    try {
      mountAtRoute()
      expect(screen.getByText(/The inspector plugin "object-tree" draws page drafts, and this Builder's draft kind is "blueprint"/)).toBeTruthy()
    } finally {
      back()
    }
  })
})
