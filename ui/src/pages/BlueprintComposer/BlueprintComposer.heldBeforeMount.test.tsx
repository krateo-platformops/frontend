// @vitest-environment jsdom
/**
 * A chart HELD BEFORE the composer mounts — a navigation away and back, or a chart Autopilot started
 * on another page — must be as editable as one started here (review of #427).
 *
 * The provider answers a replay synchronously. The host once asked for it in the same effect that put
 * its own listener on, BEFORE the blueprint workbench's listener existed; the workbench, which plans a
 * placement from the last broadcast it heard, then planned against an empty draft and refused every
 * row with "Add templates/architecture.yaml first". Here the provider's REAL hooks hold and arm the
 * chart first, and only then is the composer mounted.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBlueprintGate } from '../../components/Autopilot/blueprintGate'
import { draftHistory } from '../../components/Autopilot/draftHistory'
import { AUTOPILOT_PREVIEW_FILES_BATCH_EVENT, type FilesBatchDetail } from '../../components/Autopilot/previewFilesBatch'
import { heldDraftIdentity } from '../../components/Autopilot/publishCompile'
import { createBroadcastingDraftStore, useDraftFileBuses } from '../../components/Autopilot/useDraftFileBuses'
import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'
import { ConfigContext } from '../../context/ConfigContext'
import { ThemeModeProvider } from '../../context/ThemeModeContext'
import { invalidateAccessTokenCache } from '../../utils/getAccessToken'

import { CRDS, PALETTE_STATUS } from './__fixtures__/s4a'
import { ARCHITECTURE_TEMPLATE_PATH } from './architecture'
import BlueprintComposer from './BlueprintComposer'
import { installAntdShims, installScrollShim, listen, PALETTE_CONFIG, routeFetch, seededChart } from './blueprintTestHarness'

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

const CRD_URL = 'resource=customresourcedefinitions'

type Held = { store: ReturnType<typeof createBroadcastingDraftStore>; gate: ReturnType<typeof createBlueprintGate>; showComposer: () => void }

/** The provider's draft half, mounted alone; the composer only when asked. */
const mountProviderFirst = (): Held => {
  const held: { current: Held | null } = { current: null }
  const Page = () => {
    const [gate] = useState(() => createBlueprintGate())
    const [store] = useState(() => createBroadcastingDraftStore(gate))
    const [composer, setComposer] = useState(false)
    useDraftFileBuses(store, gate, heldDraftIdentity)
    held.current = { gate, showComposer: () => setComposer(true), store }
    return composer ? <BlueprintComposer /> : null
  }
  render(
    <AntdApp>
      <MemoryRouter>
        <ConfigContext.Provider value={PALETTE_CONFIG as never}>
          <ThemeModeProvider><Page /></ThemeModeProvider>
        </ConfigContext.Provider>
      </MemoryRouter>
    </AntdApp>,
  )
  if (!held.current) { throw new Error('the provider did not mount') }
  return held.current
}

describe('BlueprintComposer — a chart held before it mounted', () => {
  it('places Repository as ONE batch, planned against the held chart', async () => {
    routeFetch({
      'name=blueprint-palette': { body: { status: PALETTE_STATUS }, status: 200 },
      ...Object.fromEntries(Object.entries(CRDS).map(([name, crd]) => [`${CRD_URL}&apiVersion=apiextensions.k8s.io%2Fv1&name=${name}`, { body: crd, status: 200 }])),
    })
    const provider = mountProviderFirst()
    // Held and armed while no composer is on the page.
    act(() => { provider.store.set(seededChart('orders'), 'blueprint') })
    act(() => { provider.gate.recordPreview('orders') })

    // Now the composer mounts, and hears the held chart only through the replay it asks for.
    act(() => { provider.showComposer() })
    const palette = () => screen.getByRole('region', { name: 'Add' })
    await waitFor(() => expect(within(palette()).getByText('72 kinds · 4 groups')).toBeTruthy())

    const batches = listen<FilesBatchDetail>(AUTOPILOT_PREVIEW_FILES_BATCH_EVENT)
    act(() => { fireEvent.change(within(palette()).getByLabelText('Filter by kind or group'), { target: { value: 'Repository' } }) })
    await act(async () => {
      within(palette()).getByRole('button', { name: /^Repository · v2022-11-28/ }).click()
      await Promise.resolve()
    })
    await act(async () => { await Promise.resolve() })
    batches.stop()

    expect(within(palette()).queryByText(/Add templates\/architecture\.yaml first/)).toBeNull()
    expect(batches.seen).toHaveLength(1)
    expect(Object.keys(batches.seen[0].edit ?? {})).toEqual([ARCHITECTURE_TEMPLATE_PATH])
    expect(provider.store.get()?.files['templates/repository.yaml']).toBeTruthy()
  })
})
