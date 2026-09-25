// @vitest-environment jsdom
/**
 * The composer against the provider's REAL hooks — the store, the gate, the file buses and the
 * chart render — rather than a harness speaking for them. Two defects lived exactly in the seam the
 * bare suites stand in for, so these two are held to the real thing:
 *
 *   - an edit the provider REFUSES (over the byte cap) used to be shown as applied: Chart files kept
 *     the refused text while the held bytes — the ones Publish commits — stayed the old ones;
 *   - a drawer already open on the held chart stayed open when the composer claimed the surface,
 *     and its one-shot Files tab wrote stale bytes over the composer's edit.
 *
 * Only the render transport is stubbed (it is a snowplow `/call`); everything else is the code the
 * provider runs.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BlueprintDraftStore } from '../../components/Autopilot/blueprintDraftStore'
import { createBlueprintGate } from '../../components/Autopilot/blueprintGate'
import { buildBlueprintPreviewPayload } from '../../components/Autopilot/blueprintPreviewPayload'
import { draftHistory } from '../../components/Autopilot/draftHistory'
import { callBlueprintRenderRA } from '../../components/Autopilot/previewBridge'
import { AUTOPILOT_PREVIEW_EVENT } from '../../components/Autopilot/previewBus'
import { emitChartStart } from '../../components/Autopilot/previewDraftRender'
import { AutopilotPreviewDrawer } from '../../components/Autopilot/previewSurface'
import { heldDraftIdentity } from '../../components/Autopilot/publishCompile'
import { useBlueprintAuthoringBuses } from '../../components/Autopilot/useBlueprintAuthoringBuses'
import { createBroadcastingDraftStore, useDraftFileBuses } from '../../components/Autopilot/useDraftFileBuses'
import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'
import { ThemeModeProvider } from '../../context/ThemeModeContext'

import BlueprintComposer from './BlueprintComposer'
import { installAntdShims, installScrollShim, seededChart } from './blueprintTestHarness'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

vi.mock('../../components/Autopilot/previewBridge', async (importOriginal) => ({
  ...await importOriginal<object>(),
  callBlueprintRenderRA: vi.fn(),
}))

beforeAll(() => {
  installAntdShims()
  installScrollShim()
})
beforeEach(() => {
  graphDouble.reset()
  draftHistory.clear()
  vi.mocked(callBlueprintRenderRA).mockReset()
  vi.mocked(callBlueprintRenderRA).mockResolvedValue({ objects: [] })
})
afterEach(cleanup)

const config = { api: { SNOWPLOW_API_BASE_URL: 'http://snowplow' }, params: { FRONTEND_NAMESPACE: 'krateo-system' } } as never

let held: BlueprintDraftStore | null = null

/** The provider's draft half: its store, its gate and the two hooks that answer the buses. */
const Provider = () => {
  const [gate] = useState(() => createBlueprintGate())
  const [store] = useState(() => createBroadcastingDraftStore(gate))
  held = store
  useDraftFileBuses(store, gate, heldDraftIdentity)
  useBlueprintAuthoringBuses(store, gate, config)
  return null
}

const Page = ({ composer, drawer = false }: { composer: boolean; drawer?: boolean }) => (
  <AntdApp>
    <MemoryRouter>
      <ThemeModeProvider>
        <Provider />
        {drawer ? <AutopilotPreviewDrawer /> : null}
        {composer ? <div data-testid='composer'><BlueprintComposer /></div> : null}
      </ThemeModeProvider>
    </MemoryRouter>
  </AntdApp>
)

/** Start a chart through the provider and let its first render land: held, rendered, armed. */
const startAndRender = async (files: Record<string, string>): Promise<void> => {
  await act(async () => {
    emitChartStart({ files, id: 'start-1' })
    await Promise.resolve()
  })
  await act(async () => { await Promise.resolve() })
}

const fileBlock = (scope: HTMLElement, path: string): HTMLElement =>
  within(scope).getByText(path).closest('div[id^="preview-file-"]') as HTMLElement

const editFile = (block: HTMLElement, path: string, text: string): void => {
  act(() => { within(block).getByRole('button', { name: 'Edit' }).click() })
  act(() => { fireEvent.change(within(block).getByLabelText(`Edit ${path}`), { target: { value: text } }) })
  act(() => { within(block).getByRole('button', { name: 'Apply edits' }).click() })
}

describe('BlueprintComposer + the provider — an edit the provider refuses', () => {
  it('is said where it was made, and Chart files keeps showing the bytes that will publish', async () => {
    render(<Page composer />)
    const files = seededChart()
    await startAndRender(files)
    const publish = screen.getByRole<HTMLButtonElement>('button', { name: /Publish/ })
    expect(publish.disabled).toBe(false)

    // Over the 512 KiB tree cap: the store refuses it.
    const composer = screen.getByTestId('composer')
    editFile(fileBlock(composer, 'values.yaml'), 'values.yaml', `# ${'x'.repeat(600 * 1024)}\n{}\n`)

    expect(held?.get()?.files['values.yaml']).toBe(files['values.yaml'])
    expect(screen.getByText('This edit was not applied')).toBeTruthy()
    expect(screen.getByText(/over the 512 KiB cap/)).toBeTruthy()
    // The editor stays open on the person's text, so they can trim it rather than retype it…
    expect(within(fileBlock(composer, 'values.yaml')).getByLabelText<HTMLTextAreaElement>('Edit values.yaml').value.length).toBeGreaterThan(600 * 1024)
    // …and cancelling it shows the held bytes — what Publish (still on, for those bytes) commits.
    act(() => { within(fileBlock(composer, 'values.yaml')).getByRole('button', { name: 'Cancel' }).click() })
    expect(fileBlock(composer, 'values.yaml').textContent?.length).toBeLessThan(1024)
    expect(publish.disabled).toBe(false)
  })
})

describe('BlueprintComposer + the provider — a drawer already open when the composer claims the surface', () => {
  it('closes: one surface per draft, so a stale Files tab cannot write over the composer', async () => {
    const view = render(<Page composer={false} drawer />)
    const files = seededChart()
    await startAndRender(files)
    // The agent's previewBlueprint of the held chart, on another route — nothing claims it, so the drawer opens.
    act(() => {
      window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_EVENT, {
        detail: buildBlueprintPreviewPayload({ held: true, name: 'builder-publish', rawTemplates: files, rendered: { objects: [] } }),
      }))
    })
    expect(document.querySelector('.ant-drawer-open')).not.toBeNull()

    // The person navigates to the composer.
    view.rerender(<Page composer drawer />)
    expect(screen.getByTestId('composer').textContent).toContain('builder-publish')
    expect(document.querySelector('.ant-drawer-open')).toBeNull()
  })

  it('leaves a drawer showing something the composer does not own — an inspection — open', () => {
    const view = render(<Page composer={false} drawer />)
    act(() => {
      window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_EVENT, { detail: { builder: 'inspect', summary: ['repos'], title: 'Describe — repos' } }))
    })
    expect(document.querySelector('.ant-drawer-open')).not.toBeNull()
    view.rerender(<Page composer drawer />)
    expect(document.querySelector('.ant-drawer-open')).not.toBeNull()
  })
})
