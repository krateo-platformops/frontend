// @vitest-environment jsdom
/**
 * Screen 5 — placing: one gesture on a palette row, one batch (the node AND its template), answered
 * by the provider's REAL draft hooks, and — like every write to a chart — Publish off until Preview
 * renders it again. A native button's Enter and Space ARE its click, so `.click()` is the keyboard
 * path here too (jsdom does not synthesise the activation).
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { draftHistory } from '../../components/Autopilot/draftHistory'
import { AUTOPILOT_PREVIEW_FILES_BATCH_EVENT, onFilesBatch, type FilesBatchDetail } from '../../components/Autopilot/previewFilesBatch'
import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'
import { invalidateAccessTokenCache } from '../../utils/getAccessToken'

import { CRDS, PALETTE_STATUS, golden } from './__fixtures__/s4a'
import { ARCHITECTURE_TEMPLATE_PATH } from './architecture'
import { hold, installAntdShims, installScrollShim, listen, mountWithConfig, mountWithProvider, routeFetch, scrolled, seededChart, type HeldProvider } from './blueprintTestHarness'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

beforeAll(() => {
  installAntdShims()
  installScrollShim()
})
beforeEach(() => {
  graphDouble.reset()
  draftHistory.clear()
  scrolled.mockClear()
  invalidateAccessTokenCache()
  localStorage.setItem('K_user', JSON.stringify({ accessToken: 'tok-admin' }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  invalidateAccessTokenCache()
  draftHistory.clear()
})

const CRD_URL = 'resource=customresourcedefinitions'
const routes = (crds: Record<string, { status: number; body?: unknown }> = {}) => routeFetch({
  'name=blueprint-palette': { body: { status: PALETTE_STATUS }, status: 200 },
  ...Object.fromEntries(Object.entries(CRDS).map(([name, crd]) => [`${CRD_URL}&apiVersion=apiextensions.k8s.io%2Fv1&name=${name}`, crds[name] ?? { body: crd, status: 200 }])),
})

const palette = () => screen.getByRole('region', { name: 'Add' })
const inspector = () => screen.getByLabelText('Inspector')
const card = (id: string) => screen.getByTestId(`node-card-${id}`)
const filter = (text: string) => act(() => { fireEvent.change(within(palette()).getByLabelText('Filter by kind or group'), { target: { value: text } }) })
const row = (name: RegExp) => within(palette()).getByRole('button', { name })
const crdReads = (fetched: ReturnType<typeof routeFetch>) =>
  fetched.mock.calls.map(([url]) => url).filter((url) => url.includes(CRD_URL)).map((url) => new URL(url).searchParams.get('name'))

/** Start `name` in the provider, armed as if Preview had rendered it, and wait for the palette. */
const start = async (name = 'orders', crds?: Record<string, { status: number; body?: unknown }>) => {
  const fetched = routes(crds)
  const provider = mountWithProvider()
  act(() => { provider.store.set(seededChart(name), 'blueprint') })
  act(() => { provider.gate.recordPreview(name) })
  await waitFor(() => expect(within(palette()).getByText('72 kinds · 4 groups')).toBeTruthy())
  return { fetched, provider }
}

/** Activate a row and let its CRD read and the batch land. */
const place = async (name: RegExp) => {
  await act(async () => {
    row(name).click()
    await Promise.resolve()
  })
  await act(async () => { await Promise.resolve() })
}

const placeRepository = async (provider: HeldProvider) => {
  filter('Repository')
  await place(/^Repository · v2022-11-28/)
  return provider.store.get()?.files ?? {}
}

describe('BlueprintComposer — placing (screen 5)', () => {
  it('1. Repository: its CRD is read by name, then EXACTLY ONE batch — the template (golden) and the descriptor', async () => {
    const { fetched, provider } = await start()
    const batches = listen<FilesBatchDetail>(AUTOPILOT_PREVIEW_FILES_BATCH_EVENT)
    const files = await placeRepository(provider)
    batches.stop()
    expect(crdReads(fetched)).toEqual(['repositories.github.krateo.io'])
    expect(batches.seen).toHaveLength(1)
    expect(batches.seen[0].add).toEqual({ 'templates/repository.yaml': golden('repository') })
    expect(Object.keys(batches.seen[0].edit ?? {})).toEqual([ARCHITECTURE_TEMPLATE_PATH])
    expect(batches.seen[0].kind).toBe('blueprint')
    expect(files['templates/repository.yaml']).toBe(golden('repository'))
  })

  it('2. the provider answers and disarms: "Preview needed", Publish off with its reason, ONE Undo step', async () => {
    const { provider } = await start()
    const publish = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Publish' })
    expect(publish().disabled).toBe(false)
    await placeRepository(provider)
    expect(screen.getByText('Preview needed')).toBeTruthy()
    expect(publish().disabled).toBe(true)
    const reason = document.getElementById(publish().getAttribute('aria-describedby') ?? '')
    expect(reason?.textContent).toMatch(/^Preview needed — publishing stays off/)
    expect(draftHistory.depth()).toBe(1)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Undo' }).disabled).toBe(false)
  })

  it('3. the card appears, selected; the inspector shows the node, its class, its missing readiness and what placing did', async () => {
    const { provider } = await start()
    await placeRepository(provider)
    expect(card('repository').getAttribute('aria-pressed')).toBe('true')
    const panel = within(inspector())
    expect(panel.getByText('repository')).toBeTruthy()
    expect(panel.getByText('custom')).toBeTruthy()
    expect(panel.getByText('no readyWhen — declare one')).toBeTruthy()
    expect(panel.getByTestId('placed-note').textContent).toBe('Placing this node changed the chart, so publishing is off until Preview renders it again. The chart has 5 files, and there is no cap on how many it can have.')
  })

  it('4. Chart files reveals the new template', async () => {
    const { provider } = await start()
    await placeRepository(provider)
    await waitFor(() => expect(scrolled.mock.contexts.map((element) => (element as HTMLElement).id)).toContain('preview-file-templates-repository-yaml'))
  })

  it('5. a second Repository is repository-2 — and the row stays a button, marked placed', async () => {
    const { provider } = await start()
    await placeRepository(provider)
    expect(row(/^Repository · v2022-11-28 · default_branch · placed$/)).toBeTruthy()
    await place(/^Repository · v2022-11-28/)
    expect(Object.keys(provider.store.get()?.files ?? {})).toContain('templates/repository-2.yaml')
    expect(card('repository-2')).toBeTruthy()
  })

  it('6. a blueprint is placed at its served version, v1-8-40, from builderpublishes.composition.krateo.io', async () => {
    const { fetched, provider } = await start()
    await place(/^builder-publish → BuilderPublish/)
    expect(crdReads(fetched)).toEqual(['builderpublishes.composition.krateo.io'])
    expect(provider.store.get()?.files['templates/builderpublish.yaml']).toBe(golden('builderpublish'))
    expect(within(inspector()).getByText('BuilderPublish · composition.krateo.io/v1-8-40')).toBeTruthy()
    expect(within(inspector()).getByText('Ready=True and Synced=True')).toBeTruthy()
  })

  it('7. the provider refuses: said in the pane, and no node appears', async () => {
    routes()
    const stop = onFilesBatch((_batch, respond) => respond({ error: 'the change brings the draft to 513 KiB — over the 512 KiB cap', ok: false }))
    mountWithConfig()
    hold(seededChart())
    await place(/^Deployment/)
    stop()
    expect(within(palette()).getByRole('alert').textContent).toContain('Nothing was placed — the change brings the draft to 513 KiB — over the 512 KiB cap')
    expect(screen.queryByTestId('node-card-deployment')).toBeNull()
    expect(within(inspector()).getByText(/Select a node/)).toBeTruthy()
  })

  it('8. a CRD it may not read still places — spec {} and the note that says why', async () => {
    const { provider } = await start('orders', { 'repositories.github.krateo.io': { status: 403 } })
    await placeRepository(provider)
    const template = provider.store.get()?.files['templates/repository.yaml'] ?? ''
    expect(template).toContain('{{- /* Its CRD could not be read (snowplow answered 403), so spec is empty — fill it in. */}}')
    expect(template).toContain('\nspec: {}\n')
    expect(within(inspector()).getByTestId('placed-note').textContent)
      .toContain('Its CRD could not be read (snowplow answered 403), so spec is empty — fill it in Chart files.')
  })

  it('9. a native Deployment: no read, the golden skeleton, and its readiness in its own words', async () => {
    const { fetched, provider } = await start()
    await place(/^Deployment/)
    expect(crdReads(fetched)).toEqual([])
    expect(provider.store.get()?.files['templates/deployment.yaml']).toBe(golden('deployment'))
    expect(within(inspector()).getByText('kstatus · available')).toBeTruthy()
  })

  it('10. One per item of .Values.files: one batch, and the card says ×N; a template reshaped by hand is refused', async () => {
    const { provider } = await start()
    filter('LocalResource')
    await place(/^LocalResource/)
    const batches = listen<FilesBatchDetail>(AUTOPILOT_PREVIEW_FILES_BATCH_EVENT)
    act(() => { fireEvent.change(within(inspector()).getByLabelText('One per item of'), { target: { value: '.Values.files' } }) })
    act(() => { within(inspector()).getByRole('button', { name: 'Set' }).click() })
    batches.stop()
    expect(batches.seen).toHaveLength(1)
    expect(Object.keys(batches.seen[0].edit ?? {}).sort()).toEqual([ARCHITECTURE_TEMPLATE_PATH, 'templates/localresource.yaml'])
    expect(within(card('localresource')).getByText('×N')).toBeTruthy()
    expect(draftHistory.depth()).toBe(2)

    const files = provider.store.get()?.files ?? {}
    act(() => { provider.store.updateFile('templates/localresource.yaml', files['templates/localresource.yaml'].replace('apiVersion:', '{{- if .Values.enabled }}\napiVersion:').replace('{{- end }}', '{{- end }}\n{{- end }}')) })
    act(() => { fireEvent.change(within(inspector()).getByLabelText('One per item of'), { target: { value: '' } }) })
    act(() => { within(inspector()).getByRole('button', { name: 'Set' }).click() })
    expect(within(inspector()).getByRole('alert').textContent).toBe('templates/localresource.yaml has changed shape since it was placed — set forEach in Chart files.')
  })

  it('11. no resources yet: the screen-3 empty state', async () => {
    await start()
    const state = within(screen.getByLabelText('Architecture')).getByTestId('canvas-state')
    expect(within(state).getByText('No resources yet')).toBeTruthy()
    expect(state.querySelector('p:not(:first-of-type)')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('Add a Kubernetes resource, a custom resource this cluster knows, or another blueprint from the left. Each one becomes a node here and a file in templates/. Draw an edge from A to B to say A depends on B.')
  })

  it('while its CRD is read, the row is busy and says so', async () => {
    let release: (answer: { status: number; body?: unknown }) => void = () => undefined
    const { provider } = await start()
    // The palette has been read; from here the CRD answers only when released.
    routeFetch({
      'name=blueprint-palette': { body: { status: PALETTE_STATUS }, status: 200 },
      'name=repositories.github.krateo.io': () => new Promise((resolve) => { release = resolve }),
    })
    filter('Repository')
    act(() => { row(/^Repository · v2022-11-28/).click() })
    const busy = row(/^Repository · v2022-11-28 · default_branch · placing$/)
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(within(busy).getByText('Placing…')).toBeTruthy()
    await act(async () => {
      release({ body: CRDS['repositories.github.krateo.io'], status: 200 })
      await Promise.resolve()
    })
    await waitFor(() => expect(provider.store.get()?.files['templates/repository.yaml']).toBe(golden('repository')))
    expect(row(/^Repository · v2022-11-28 · default_branch · placed$/).getAttribute('aria-busy')).toBeNull()
  })

  it('no descriptor: placing is refused with the way to add one, before any read', async () => {
    const fetched = routes()
    const { [ARCHITECTURE_TEMPLATE_PATH]: _gone, ...files } = seededChart()
    mountWithConfig()
    hold(files)
    await waitFor(() => expect(within(palette()).getByText('72 kinds · 4 groups')).toBeTruthy())
    await place(/^builder-publish/)
    expect(within(palette()).getByRole('alert').textContent).toContain('Add templates/architecture.yaml first — the canvas has the button.')
    expect(crdReads(fetched)).toEqual([])
  })
})
