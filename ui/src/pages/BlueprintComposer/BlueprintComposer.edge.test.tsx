// @vitest-environment jsdom
/**
 * Screen 6 — drawing an edge: the keyboard's route (select a card, then Add dependency) and the
 * pointer's (a drag onto a card) end in the SAME pending edge, which the edge inspector asks about.
 * Nothing is written until Accept. The chart is the one the composer itself builds (__fixtures__/s4b):
 * repository, repo (when), localresource (forEach), pullrequest (waits for every localresource), mongodb.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { draftHistory } from '../../components/Autopilot/draftHistory'
import { AUTOPILOT_PREVIEW_FILES_BATCH_EVENT, type FilesBatchDetail } from '../../components/Autopilot/previewFilesBatch'
import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'
import { invalidateAccessTokenCache } from '../../utils/getAccessToken'

import { CRDS, PALETTE_STATUS } from './__fixtures__/s4a'
import { applyPlan, edgeChart } from './__fixtures__/s4b'
import { installAntdShims, installScrollShim, listen, mountWithProvider, routeFetch, type Answer } from './blueprintTestHarness'
import { planEdge } from './planEdge'
import { CUSTOM_NOTE } from './readinessOptions'
import { conditionReadyWhen } from './readyWhen'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

beforeAll(() => {
  installAntdShims()
  installScrollShim()
})
beforeEach(() => {
  graphDouble.reset()
  draftHistory.clear()
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

const REPOSITORY_CRD = 'repositories.github.krateo.io'

/** The palette and the CRDs by name; `crds` overrides one CRD's answer. */
const routes = (crds: Record<string, Answer> = {}) => routeFetch({
  'name=blueprint-palette': { body: { status: PALETTE_STATUS }, status: 200 },
  ...Object.fromEntries(Object.entries(CRDS).map(([name, crd]) => [`name=${name}`, crds[name] ?? { body: crd, status: 200 }])),
})

/** The screen-6 chart held by the provider's real hooks, armed as if Preview had rendered it. */
const start = async (files: Record<string, string> = edgeChart(), crds: Record<string, Answer> = {}) => {
  routes(crds)
  const provider = mountWithProvider()
  act(() => { provider.store.set(files, 'blueprint') })
  act(() => { provider.gate.recordPreview('orders') })
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Add' })).getByText('72 kinds · 4 groups')).toBeTruthy())
  return provider
}

const inspector = () => screen.getByLabelText('Inspector')
const card = (id: string) => screen.getByTestId(`node-card-${id}`)
/** Let every pending promise, the pointerup microtask, and the renders they cause land. */
const settle = () => act(async () => {
  await new Promise((resolve) => { setTimeout(resolve, 0) })
})

/** Enter on a card (a button's Enter IS its click), then open Add dependency. Returns its options by id. */
const openAddDependency = async (from: string) => {
  act(() => { card(from).click() })
  const select = within(inspector()).getByLabelText('Add dependency').closest('.ant-select') as HTMLElement
  await act(async () => {
    fireEvent.mouseDown(select.querySelector('.ant-select-content') as HTMLElement)
    await Promise.resolve()
  })
  const options = [...document.querySelectorAll<HTMLElement>('.ant-select-item-option')]
  return new Map(options.map((option) => [option.querySelector('span > span')?.textContent ?? '', option]))
}

/** Choose `to` in Add dependency — the keyboard's route to a pending edge. */
const addDependency = async (from: string, to: string) => {
  const options = await openAddDependency(from)
  act(() => { fireEvent.click(options.get(to) as HTMLElement) })
  await settle()
}

const radio = (name: RegExp) => screen.getByRole<HTMLInputElement>('radio', { name })
const eyebrow = () => within(screen.getByLabelText('Architecture')).queryByText(/^Drawing: /)?.textContent ?? null

describe('BlueprintComposer — drawing an edge (screen 6)', () => {
  it('1. the keyboard: Enter on localresource, then Add dependency — repository, repo and mongodb; pullrequest would be a cycle', async () => {
    await start()
    const options = await openAddDependency('localresource')
    expect([...options.keys()]).toEqual(['repository', 'repo', 'pullrequest', 'mongodb'])
    for (const id of ['repository', 'repo', 'mongodb']) {
      expect(options.get(id)?.getAttribute('aria-disabled')).not.toBe('true')
    }
    expect(options.get('pullrequest')?.getAttribute('aria-disabled')).toBe('true')
    expect(options.get('pullrequest')?.textContent).toBe('pullrequestwould be a cycle')
  })

  it('2. choosing repository opens the pending edge: waiting for readiness, the CRD\'s status fields, default_branch preselected', async () => {
    await start()
    await addDependency('localresource', 'repository')
    const edge = screen.getByTestId('edge-inspector')
    expect(within(edge).getByText('localresource → repository')).toBeTruthy()
    expect(within(edge).getByRole('switch', { name: 'Wait for readiness' }).getAttribute('aria-checked')).toBe('true')
    // Exactly the scalar fields Repository's CRD declares under status, and Ready because it declares conditions.
    expect(within(edge).getAllByRole<HTMLInputElement>('radio').map((input) => input.value)).toEqual([
      '.status.clone_url', '.status.default_branch', '.status.full_name', '.status.html_url', '.status.id', '.status.name', '.status.node_id', '.status.ssh_url',
      conditionReadyWhen('Ready'),
    ])
    expect(within(edge).getByText('.status.conditions[type=Ready]')).toBeTruthy()
    expect(radio(/\.status\.default_branch/).checked).toBe(true)
    expect(within(edge).getByText(CUSTOM_NOTE)).toBeTruthy()
    expect(within(edge).queryByText(/Waits for every item/)).toBeNull()
  })

  it('2b. onto a forEach target the edge waits for every item; onto a composition, Ready and Synced is the default', async () => {
    await start()
    await addDependency('mongodb', 'localresource')
    expect(within(screen.getByTestId('edge-inspector')).getByText('Waits for every item — localresource is one per item of .Values.files.')).toBeTruthy()
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }) })
    await addDependency('repo', 'mongodb')
    expect(radio(/Ready=True and Synced=True/).checked).toBe(true)
  })

  it('3 + 4. nothing is written before Accept; the palette is disabled and the canvas says what is drawn', async () => {
    const provider = await start()
    const before = provider.store.get()?.files
    const batches = listen<FilesBatchDetail>(AUTOPILOT_PREVIEW_FILES_BATCH_EVENT)
    await addDependency('localresource', 'repository')
    act(() => { fireEvent.click(radio(/\.status\.html_url/)) })
    batches.stop()
    expect(batches.seen).toEqual([])
    expect(provider.store.get()?.files).toBe(before)
    expect(within(screen.getByRole('region', { name: 'Add' })).getByRole('group', { name: 'Palette' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('Palette dims while an edge is being drawn.')).toBeTruthy()
    expect(eyebrow()).toBe('Drawing: localresource → repository')
  })

  it('5. a drag makes the same pending edge — drawSource and legalTarget set on the live graph, no re-layout', async () => {
    await start()
    const renders = graphDouble.renders.length
    act(() => { expect(graphDouble.startEdge('localresource')).toBe(true) })
    const lit = graphDouble.stateUpdates[graphDouble.stateUpdates.length - 1]
    expect(lit.localresource).toContain('drawSource')
    for (const id of ['repository', 'repo', 'mongodb']) { expect(lit[id]).toContain('legalTarget') }
    expect(lit.pullrequest).not.toContain('legalTarget')
    expect(card('repository').textContent).toContain('legal target · no readyWhen')
    expect(card('mongodb').textContent).toContain('legal target · Ready+Synced')
    expect(eyebrow()).toBe('Drawing: localresource → …')
    act(() => { graphDouble.dropEdge('localresource', 'repository') })
    await settle()
    expect(screen.getByTestId('edge-inspector')).toBeTruthy()
    expect(eyebrow()).toBe('Drawing: localresource → repository')
    const pending = graphDouble.stateUpdates[graphDouble.stateUpdates.length - 1]
    expect(pending.localresource).toContain('pendingFrom')
    expect(pending.repository).toContain('pendingTo')
    expect(graphDouble.renders).toHaveLength(renders)
  })

  it('6. a drop on a card that never lit is refused a moment ago — the loop, and where it could go', async () => {
    const provider = await start()
    const before = provider.store.get()?.files
    act(() => { graphDouble.drawEdge('localresource', 'pullrequest') })
    await settle()
    const refused = screen.getByTestId('refused-moment')
    expect(within(refused).getByText('Refused a moment ago')).toBeTruthy()
    expect(within(refused).getByText('pullrequest → localresource → pullrequest would be a cycle. Nothing was written. It could depend on repository, repo or mongodb instead.')).toBeTruthy()
    expect(screen.queryByTestId('edge-inspector')).toBeNull()
    expect(provider.store.get()?.files).toBe(before)
  })

  it('7. waiting for readiness with nothing picked for a custom target: Accept is off, and says why', async () => {
    const statusless = structuredClone(CRDS[REPOSITORY_CRD]) as { spec: { versions: { schema: { openAPIV3Schema: { properties: { status: { properties: Record<string, unknown> } } } } }[] } }
    const status = statusless.spec.versions[0].schema.openAPIV3Schema.properties.status.properties
    delete status.default_branch
    await start(edgeChart(), { [REPOSITORY_CRD]: { body: statusless, status: 200 } })
    await addDependency('localresource', 'repository')
    const accept = screen.getByRole<HTMLButtonElement>('button', { name: 'Accept edge' })
    expect(within(screen.getByTestId('edge-inspector')).getAllByRole<HTMLInputElement>('radio').some((input) => input.checked)).toBe(false)
    expect(accept.disabled).toBe(true)
    expect(document.getElementById(accept.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Pick what “ready” means for repository — a custom resource has no default. Or turn off Wait for readiness: then it only has to exist.')
    act(() => { fireEvent.click(screen.getByRole('switch', { name: 'Wait for readiness' })) })
    expect(accept.disabled).toBe(false)
    expect(accept.getAttribute('aria-describedby')).toBeNull()
  })

  it('8. Esc lets the pending edge go, from anywhere in the composer', async () => {
    await start()
    await addDependency('localresource', 'repository')
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }) })
    expect(screen.queryByTestId('edge-inspector')).toBeNull()
    expect(eyebrow()).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Add' })).getByRole('group', { name: 'Palette' }).getAttribute('aria-disabled')).toBeNull()
  })

  it('9. a drop on the empty canvas cancels', async () => {
    await start()
    act(() => { graphDouble.startEdge('localresource') })
    expect(eyebrow()).toBe('Drawing: localresource → …')
    act(() => { graphDouble.dropEdge('localresource', null) })
    await settle()
    expect(eyebrow()).toBeNull()
    expect(screen.queryByTestId('edge-inspector')).toBeNull()
    expect(screen.queryByTestId('refused-moment')).toBeNull()
  })

  it('10. a CRD 403, and a CRD that declares no status, each say so', async () => {
    await start(edgeChart(), { [REPOSITORY_CRD]: { status: 403 } })
    await addDependency('localresource', 'repository')
    expect(within(screen.getByTestId('edge-inspector')).getByText(`You may not read the CustomResourceDefinition ${REPOSITORY_CRD}, so its status fields cannot be listed. Ask a platform admin for read access, or turn off Wait for readiness.`)).toBeTruthy()
    cleanup()
    const bare = structuredClone(CRDS[REPOSITORY_CRD]) as { spec: { versions: { schema: { openAPIV3Schema: { properties: Record<string, unknown> } } }[] } }
    delete bare.spec.versions[0].schema.openAPIV3Schema.properties.status
    await start(edgeChart(), { [REPOSITORY_CRD]: { body: bare, status: 200 } })
    await addDependency('localresource', 'repository')
    expect(within(screen.getByTestId('edge-inspector')).getByText('Repository\'s CRD declares no status fields, so there is nothing to wait on. Turn off Wait for readiness (it only has to exist).')).toBeTruthy()
  })

  it('11. a readyWhen that is the target\'s, not the edge\'s: the other dependents are named before Accept', async () => {
    let files = edgeChart()
    files = applyPlan(files, planEdge(files, { from: 'repo', op: 'add', ready: true, readyWhen: '.status.default_branch', to: 'repository' }))
    await start(files)
    await addDependency('localresource', 'repository')
    expect(radio(/\.status\.default_branch/).checked).toBe(true)
    expect(screen.queryByTestId('regate-warning')).toBeNull()
    act(() => { fireEvent.click(radio(/\.status\.html_url/)) })
    expect(screen.getByTestId('regate-warning').textContent).toBe('This also changes what repo waits for — readyWhen belongs to repository, not to one edge.')
  })
})
