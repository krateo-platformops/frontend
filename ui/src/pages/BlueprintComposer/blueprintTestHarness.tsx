// @vitest-environment jsdom
/**
 * Shared scaffolding for the Blueprint Composer suites — the mirror of the Page Composer's
 * composerTestHarness, and bare in the same sense: NO AutopilotProvider. The provider's part is
 * played here on the buses it would answer on (the draft broadcast, the render result, the publish
 * result), which is exactly the seam the page is written against.
 *
 * A SUITE MUST MOCK THE GRAPH ITSELF — jsdom has no canvas — with the two lines below, at the top of
 * the test file (vi.mock is hoisted per file, so it cannot live in this module for them):
 *
 *   vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
 *   vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))
 *
 * WHY A MemoryRouter. The parked-page state links to the Portal Builder with a client-side `Link`
 * (a full load would drop the held page draft), and a Link needs a router. Production always has
 * one — this route is a child of the shell route — so it is fidelity, not scaffolding. The bare
 * mount in the lifecycle suite stays bare: nothing held renders no link.
 *
 * THE PALETTE READS THROUGH `fetch` (S4a), so `routeFetch` answers it by URL — the blueprint-palette
 * RESTAction and each CRD — and `mountWithProvider` mounts the provider's REAL draft hooks (store,
 * gate, file buses) beside the page, for the suites that need a placement answered, disarmed and
 * made an Undo step exactly as the provider does it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, render } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'

import type { BlueprintDraftStore } from '../../components/Autopilot/blueprintDraftStore'
import { createBlueprintGate, type BlueprintGate } from '../../components/Autopilot/blueprintGate'
import { emitDraftChanged, type DraftChangedDetail } from '../../components/Autopilot/previewDraftChanged'
import { emitDraftRenderResult, type DraftRenderResultDetail } from '../../components/Autopilot/previewDraftRender'
import { heldDraftIdentity } from '../../components/Autopilot/publishCompile'
import { createBroadcastingDraftStore, useDraftFileBuses } from '../../components/Autopilot/useDraftFileBuses'
import { ConfigContext } from '../../context/ConfigContext'
import { ThemeModeProvider } from '../../context/ThemeModeContext'

import { ARCHITECTURE_API_VERSION, ARCHITECTURE_KIND, ARCHITECTURE_TEMPLATE_PATH, serializeArchitecture, wrapAsConfigMapTemplate, type ResourceNode } from './architecture'
import BlueprintComposer from './BlueprintComposer'
import { startChart } from './startChart'

export { installAntdShims } from '../PageComposer/composerTestHarness'

/** What Chart files calls to reveal a focused file — jsdom implements no scrolling of its own. */
export const scrolled = vi.fn()

export const installScrollShim = (): void => {
  Element.prototype.scrollIntoView = scrolled
}

const tree = (config?: unknown, provider?: React.ReactNode) => {
  const page = <ThemeModeProvider>{provider}<BlueprintComposer /></ThemeModeProvider>
  return (
    <AntdApp>
      <MemoryRouter>
        {config ? <ConfigContext.Provider value={config as never}>{page}</ConfigContext.Provider> : page}
      </MemoryRouter>
    </AntdApp>
  )
}

export const mount = () => render(tree())

/** With the install config that names the blueprint builder's publish target (`owner/repo`). */
export const mountWithOwner = (slug = 'krateo-blueprints/blueprints') =>
  render(tree({ config: { api: { AUTOPILOT_BLUEPRINT_BUILDER_REPO: slug } } }))

/** The install config the palette reads: snowplow's URL and the namespace its RESTActions live in. */
export const PALETTE_CONFIG = { config: { api: { SNOWPLOW_API_BASE_URL: 'http://snowplow' }, params: { FRONTEND_NAMESPACE: 'krateo-system' } } }

export const mountWithConfig = (config: unknown = PALETTE_CONFIG) => render(tree(config))

/** The provider's draft half, for real: its store, its gate and the file buses answering on them. */
export interface HeldProvider { store: BlueprintDraftStore; gate: BlueprintGate }

/**
 * The page beside the provider's REAL draft hooks. Returns the live store and gate once mounted —
 * a suite starts a chart with `store.set(files, 'blueprint')`, and arms it with `gate.recordPreview`.
 */
export const mountWithProvider = (config: unknown = PALETTE_CONFIG): HeldProvider => {
  const held: { current: HeldProvider | null } = { current: null }
  const Provider = () => {
    const [gate] = useState(() => createBlueprintGate())
    const [store] = useState(() => createBroadcastingDraftStore(gate))
    held.current = { gate, store }
    useDraftFileBuses(store, gate, heldDraftIdentity)
    return null
  }
  render(tree(config, <Provider />))
  if (!held.current) { throw new Error('the provider did not mount') }
  return held.current
}

/** A fetch answer: the status, and the body `json()` resolves to. */
export interface Answer { status: number; body?: unknown }

/**
 * `fetch`, answered by URL: the first route whose key the URL contains wins. Anything unrouted is a
 * 404 — so a read the suite did not expect shows up as a sentence, not a hang. Returns the mock.
 */
export const routeFetch = (routes: Record<string, Answer | (() => Promise<Answer>)>) => {
  const mock = vi.fn(async (url: string) => {
    const hit = Object.keys(routes).find((key) => url.includes(key))
    const route = hit ? routes[hit] : { status: 404 }
    const answer = typeof route === 'function' ? await route() : route
    return { json: () => Promise.resolve(answer.body ?? {}), ok: answer.status >= 200 && answer.status < 300, status: answer.status }
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

/** A fresh chart, exactly as Start seeds it. */
export const seededChart = (name = 'builder-publish', version = '0.1.0'): Record<string, string> => {
  const started = startChart({ description: '', name, version })
  if (!started.ok) { throw new Error(`fixture chart refused: ${JSON.stringify(started.problems)}`) }
  return started.files
}

/** A seeded chart whose architecture file carries these resources (and state names). */
export const chartWith = (resources: ResourceNode[], states?: { name: string }[], name = 'builder-publish'): Record<string, string> => {
  const descriptor = serializeArchitecture({ apiVersion: ARCHITECTURE_API_VERSION, chart: name, kind: ARCHITECTURE_KIND, resources, states })
  return { ...seededChart(name), [ARCHITECTURE_TEMPLATE_PATH]: wrapAsConfigMapTemplate(descriptor, name) }
}

/**
 * builder-publish's real machine — the checked-in descriptor the extractor reproduces (S2) — as
 * the chart's templates/architecture.yaml, with a template file per resource.
 */
export const builderPublishChart = (): Record<string, string> => {
  const descriptor = readFileSync(join(__dirname, '__fixtures__', 'builder-publish', 'expected.architecture.yaml'), 'utf8')
  const withStates = `${descriptor.trimEnd()}\nstates:\n  - { name: repository-only }\n  - { name: seeding }\n  - { name: committing }\n  - { name: change-request-open }\n`
  return {
    ...seededChart(),
    [ARCHITECTURE_TEMPLATE_PATH]: wrapAsConfigMapTemplate(withStates, 'builder-publish'),
    'templates/localresources.yaml': 'kind: LocalResource\n',
    'templates/pullrequest.yaml': 'kind: PullRequest\n',
    'templates/repo.yaml': 'kind: Repo\n',
    'templates/repository.yaml': 'kind: Repository\n',
    'templates/username-secret.yaml': 'kind: Secret\n',
  }
}

/** The provider's broadcast of a held chart. `previewed` and `problems` as the gate and lint say. */
export const hold = (files: Record<string, string>, extra: Partial<DraftChangedDetail> = {}) => {
  act(() => emitDraftChanged({ files, kind: 'blueprint', problems: [], ...extra }))
}

/** Every detail dispatched on `event` while listening, oldest first. */
export const listen = <T, >(event: string) => {
  const seen: T[] = []
  const listener = (raw: Event) => { seen.push((raw as CustomEvent<T>).detail) }
  window.addEventListener(event, listener)
  return { seen, stop: () => window.removeEventListener(event, listener) }
}

/** The provider's answer to a start or a preview. */
export const answer = (detail: DraftRenderResultDetail) => {
  act(() => emitDraftRenderResult(detail))
}

/** A render payload as useBlueprintAuthoringBuses builds it: the held tree, and its objects or error. */
export const renderedPayload = (files: Record<string, string>, objects: { kind: string; name: string; yaml: string }[], error?: string) => ({
  builder: 'blueprint' as const,
  files: Object.entries(files).map(([path, content]) => ({ content, path })),
  objects,
  title: 'Blueprint preview — builder-publish',
  ...(error ? { error } : {}),
})
