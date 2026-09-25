// @vitest-environment jsdom
/**
 * Preview, publish, undo and close — the four things a person does to a held chart from the header.
 *
 * THE RULE UNDER TEST (S3 decision 2): a blueprint publishes only after a successful render of
 * exactly the held bytes, and any edit turns Publish off until the next Preview. The gate itself
 * is the provider's; what is asserted here is that the page shows it honestly — "Preview needed"
 * only as the exception, Publish off with the reason said, every Preview outcome in the person's
 * words, and only the signals that exist (the lint and the render — no invented gate verdict).
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { draftHistory } from '../../components/Autopilot/draftHistory'
import { AUTOPILOT_PREVIEW_EVENT } from '../../components/Autopilot/previewBus'
import { AUTOPILOT_PREVIEW_DRAFT_CLOSE_EVENT } from '../../components/Autopilot/previewDraftClose'
import { AUTOPILOT_DRAFT_RENDER_REQUEST_EVENT, type DraftRenderRequestDetail } from '../../components/Autopilot/previewDraftRender'
import { AUTOPILOT_PREVIEW_DRAFT_UNDO_EVENT } from '../../components/Autopilot/previewDraftUndo'
import { AUTOPILOT_PREVIEW_FILE_EDIT_EVENT, type FileEditDetail } from '../../components/Autopilot/previewFileEdit'
import { AUTOPILOT_PUBLISH_REQUEST_EVENT, emitPublishResult, type PublishRequestDetail } from '../../components/Autopilot/previewPublishRequest'
import { AutopilotPreviewDrawer } from '../../components/Autopilot/previewSurface'
import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'
import { ThemeModeProvider } from '../../context/ThemeModeContext'

import BlueprintComposer from './BlueprintComposer'
import { answer, hold, installAntdShims, installScrollShim, listen, mount, renderedPayload, seededChart } from './blueprintTestHarness'
import { STALE_RENDER_CAPTION, UNRENDERED_CAPTION } from './heldBlueprintPayload'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

beforeAll(() => {
  installAntdShims()
  installScrollShim()
})
beforeEach(() => {
  graphDouble.reset()
  draftHistory.clear()
})
afterEach(cleanup)

const publishButton = (): HTMLButtonElement => screen.getByRole('button', { name: /Publish/ })

/** Press Preview and return the id the provider must answer. */
const pressPreview = (): string => {
  const asked = listen<DraftRenderRequestDetail>(AUTOPILOT_DRAFT_RENDER_REQUEST_EVENT)
  act(() => { screen.getByRole('button', { name: 'Preview' }).click() })
  asked.stop()
  expect(asked.seen).toHaveLength(1)
  return asked.seen[0].id
}

const OBJECTS = [
  { kind: 'ConfigMap', name: 'builder-publish-architecture', yaml: 'kind: ConfigMap\n' },
  { kind: 'Repository', name: 'builder-publish-repo', yaml: 'kind: Repository\n' },
]

describe('BlueprintComposer — "Preview needed", and only as the exception', () => {
  it('shows the pill when the held chart is not previewed', () => {
    mount()
    hold(seededChart(), { previewed: false })
    expect(screen.getByText('Preview needed')).toBeTruthy()
  })

  it('marks nothing when the preview stands — a healthy default is never decorated', () => {
    mount()
    hold(seededChart(), { previewed: true })
    expect(screen.queryByText('Preview needed')).toBeNull()
    expect(screen.queryByText(/preview clean/i)).toBeNull()
  })

  it('claims nothing either way when the gate is unknown (no `previewed` on the broadcast)', () => {
    mount()
    hold(seededChart())
    expect(screen.queryByText('Preview needed')).toBeNull()
  })
})

describe('BlueprintComposer — Publish is on only for a previewed, lint-clean chart', () => {
  it('is off before a preview, and says why to a reader who cannot hover', () => {
    mount()
    hold(seededChart(), { previewed: false })
    expect(publishButton().disabled).toBe(true)
    const reason = document.getElementById(publishButton().getAttribute('aria-describedby') ?? '')
    expect(reason?.textContent).toMatch(/^Preview needed — publishing stays off until Preview has rendered the chart exactly as it is now/)
  })

  it('is off while lint problems stand, names them, and lists them once — above, not again under the canvas', () => {
    mount()
    hold(seededChart(), { previewed: true, problems: ['values.schema.json: an object default wedges the CompositionDefinition'] })
    expect(publishButton().disabled).toBe(true)
    expect(document.getElementById(publishButton().getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/Fix the 1 problem listed above/)
    expect(screen.getAllByText('values.schema.json: an object default wedges the CompositionDefinition')).toHaveLength(1)
  })

  it('is on once the chart is previewed and clean — and describes nothing', () => {
    mount()
    hold(seededChart(), { previewed: true })
    expect(publishButton().disabled).toBe(false)
    expect(publishButton().getAttribute('aria-describedby')).toBeNull()
  })
})

describe('BlueprintComposer — Preview, and every answer in the person\'s words', () => {
  it('asks the provider to render the held chart, and waits — Publish is off while it does', () => {
    mount()
    hold(seededChart(), { previewed: true })
    pressPreview()
    expect(screen.getByRole('button', { name: /Previewing/ })).toBeTruthy()
    expect(publishButton().disabled).toBe(true)
  })

  it('rendered: Source is populated and the count is said; "Preview needed" clears on the broadcast, not before', () => {
    const files = seededChart()
    mount()
    hold(files, { previewed: false })
    const id = pressPreview()
    answer({ id, message: null, outcome: 'rendered', payload: renderedPayload(files, OBJECTS) })
    expect(screen.getByText(/Rendered 2 objects — read them in Source/)).toBeTruthy()
    // The page does not decide the gate: the pill is the broadcast's to clear.
    expect(screen.getByText('Preview needed')).toBeTruthy()
    hold(files, { previewed: true })
    expect(screen.queryByText('Preview needed')).toBeNull()
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Source' })) })
    expect(screen.getByText('builder-publish-repo')).toBeTruthy()
  })

  it('failed: the render error, in Source, and the outcome says where to read it', () => {
    const files = seededChart()
    mount()
    hold(files, { previewed: false })
    const id = pressPreview()
    answer({ id, message: 'The chart did not render, so it cannot be published yet.', outcome: 'failed', payload: renderedPayload(files, [], 'template: builder-publish/templates/x.yaml:3: function "nope" not defined') })
    expect(screen.getByText(/did not render, so it cannot be published yet\. The render error is in Source/)).toBeTruthy()
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Source' })) })
    expect(screen.getByText(/function "nope" not defined/)).toBeTruthy()
    expect(screen.getByText(/The last preview did not render/)).toBeTruthy()
  })

  it('refused: the lint problems that stopped it, one per line — nothing was sent', () => {
    mount()
    hold(seededChart(), { previewed: false })
    const id = pressPreview()
    answer({ id, message: 'Fix these files before previewing — nothing was sent to the cluster.', outcome: 'refused', problems: ['Chart.yaml has no version'] })
    expect(screen.getByText('Fix these files before previewing — nothing was sent to the cluster.')).toBeTruthy()
    expect(screen.getByText('Chart.yaml has no version')).toBeTruthy()
  })

  it('stale: the chart changed while it rendered — preview again', () => {
    mount()
    hold(seededChart(), { previewed: false })
    const id = pressPreview()
    answer({ id, message: 'The chart changed while it was rendering — preview it again.', outcome: 'stale' })
    expect(screen.getByText('The chart changed while it rendered — preview again.')).toBeTruthy()
  })

  it('unavailable: the provider\'s message, as it said it', () => {
    mount()
    hold(seededChart(), { previewed: false })
    const id = pressPreview()
    answer({ id, message: 'This portal has no chart render configured, so the chart cannot be previewed here. It is still held.', outcome: 'unavailable' })
    expect(screen.getByText(/no chart render configured/)).toBeTruthy()
  })

  it('ignores another surface\'s answer', () => {
    mount()
    hold(seededChart(), { previewed: false })
    pressPreview()
    answer({ id: 'someone-else', message: null, outcome: 'rendered', payload: renderedPayload(seededChart(), OBJECTS) })
    expect(screen.queryByText(/Rendered 2 objects/)).toBeNull()
    expect(screen.getByRole('button', { name: /Previewing/ })).toBeTruthy()
  })

  it('shows ONLY the real signals — no gate verdict pills the portal cannot see', () => {
    const files = seededChart()
    mount()
    hold(files, { previewed: false })
    answer({ id: pressPreview(), message: null, outcome: 'rendered', payload: renderedPayload(files, OBJECTS) })
    for (const invented of [/kube-linter/i, /helm lint --strict/i, /dry-run · admission/i, /schema validate/i]) {
      expect(screen.queryByText(invented)).toBeNull()
    }
  })

  it('says Source is OLD once the chart changes after the render — measured against the rendered files', () => {
    const files = seededChart()
    mount()
    hold(files, { previewed: false })
    expect(screen.getByText(UNRENDERED_CAPTION)).toBeTruthy()
    answer({ id: pressPreview(), message: null, outcome: 'rendered', payload: renderedPayload(files, OBJECTS) })
    hold(files, { previewed: true })
    expect(screen.queryByText(STALE_RENDER_CAPTION)).toBeNull()
    hold({ ...files, 'values.yaml': 'replicas: 2\n' }, { previewed: false })
    expect(screen.getByText(STALE_RENDER_CAPTION)).toBeTruthy()
  })

  it('shows the AGENT\'s preview of the held chart — the drawer defers it here and must not open', () => {
    const files = seededChart()
    render(
      <AntdApp>
        <MemoryRouter>
          <ThemeModeProvider>
            <BlueprintComposer />
            <AutopilotPreviewDrawer />
          </ThemeModeProvider>
        </MemoryRouter>
      </AntdApp>,
    )
    hold(files, { previewed: true })
    act(() => {
      window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_EVENT, { detail: renderedPayload(files, OBJECTS) }))
    })
    expect(document.querySelector('.ant-drawer-open')).toBeNull()
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Source' })) })
    expect(screen.getByText('builder-publish-repo')).toBeTruthy()
  })
})

describe('BlueprintComposer — Chart files, edited in place', () => {
  it('an accepted edit rides the file-edit bus, tagged as a blueprint', () => {
    const edits = listen<FileEditDetail>(AUTOPILOT_PREVIEW_FILE_EDIT_EVENT)
    mount()
    hold(seededChart(), { previewed: true })
    const block = screen.getByText('values.yaml').closest('div')?.parentElement?.parentElement as HTMLElement
    act(() => { within(block).getByRole('button', { name: 'Edit' }).click() })
    act(() => { fireEvent.change(screen.getByLabelText('Edit values.yaml'), { target: { value: 'replicas: 2\n' } }) })
    act(() => { screen.getByRole('button', { name: 'Apply edits' }).click() })
    edits.stop()
    expect(edits.seen).toEqual([{ content: 'replicas: 2\n', kind: 'blueprint', path: 'values.yaml' }])
  })

  it('shows the bytes the provider holds NOW — an undo arriving on the broadcast replaces what is shown', () => {
    const files = seededChart()
    mount()
    // The highlighter splits a line into tokens, so the block's text is what is compared.
    const shown = () => document.getElementById('preview-file-values-yaml')?.textContent ?? ''
    hold({ ...files, 'values.yaml': 'replicas: 2\n' })
    expect(shown()).toContain('replicas')
    hold(files)
    expect(shown()).not.toContain('replicas')
    expect(shown()).toContain('Defaults for this blueprint')
  })
})

describe('BlueprintComposer — publish, undo, close', () => {
  it('Publish asks the provider with publishBlueprint — the person confirms the write there, not here', () => {
    const asked = listen<PublishRequestDetail>(AUTOPILOT_PUBLISH_REQUEST_EVENT)
    mount()
    hold(seededChart(), { previewed: true })
    act(() => { publishButton().click() })
    asked.stop()
    expect(asked.seen).toHaveLength(1)
    expect(asked.seen[0].verb).toBe('publishBlueprint')
    expect(screen.getByRole('button', { name: /Publishing…/ })).toBeTruthy()
  })

  it('reports the change request when the publish lands, a refusal as a refusal, and ignores other surfaces', () => {
    const asked = listen<PublishRequestDetail>(AUTOPILOT_PUBLISH_REQUEST_EVENT)
    mount()
    hold(seededChart(), { previewed: true })
    act(() => { publishButton().click() })
    asked.stop()
    act(() => { emitPublishResult({ deepLink: null, denial: 'not ours', id: 'someone-else' }) })
    expect(screen.queryByText('not ours')).toBeNull()
    act(() => { emitPublishResult({ deepLink: 'https://example.invalid/pulls/1', denial: null, id: asked.seen[0].id }) })
    expect(screen.getByText('Published — the change request is open for review.')).toBeTruthy()
    expect(screen.getByText('Open change request').closest('a')?.href).toContain('example.invalid')
  })

  it('a declined publish reads as declined', () => {
    const asked = listen<PublishRequestDetail>(AUTOPILOT_PUBLISH_REQUEST_EVENT)
    mount()
    hold(seededChart(), { previewed: true })
    act(() => { publishButton().click() })
    asked.stop()
    act(() => { emitPublishResult({ deepLink: null, denial: 'publish cancelled — destination not confirmed', id: asked.seen[0].id }) })
    expect(screen.getByText(/destination not confirmed/)).toBeTruthy()
  })

  it('Undo is off with no history, and on with one: it asks the provider for one step back', () => {
    const undos = vi.fn()
    window.addEventListener(AUTOPILOT_PREVIEW_DRAFT_UNDO_EVENT, undos)
    mount()
    hold(seededChart())
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Undo' }).disabled).toBe(true)
    act(() => draftHistory.push({ files: seededChart(), kind: 'blueprint' }))
    act(() => { screen.getByRole('button', { name: 'Undo' }).click() })
    window.removeEventListener(AUTOPILOT_PREVIEW_DRAFT_UNDO_EVENT, undos)
    expect(undos).toHaveBeenCalledTimes(1)
  })

  it('Close draft confirms, then asks the provider to discard — and this page forgets the render', () => {
    const closes = vi.fn()
    window.addEventListener(AUTOPILOT_PREVIEW_DRAFT_CLOSE_EVENT, closes)
    const files = seededChart()
    mount()
    hold(files, { previewed: false })
    answer({ id: pressPreview(), message: null, outcome: 'rendered', payload: renderedPayload(files, OBJECTS) })
    act(() => { screen.getByRole('button', { name: 'Close draft' }).click() })
    expect(screen.getByText('Discard this chart draft? Its unpublished files are deleted.')).toBeTruthy()
    act(() => { screen.getByRole('button', { name: 'Discard' }).click() })
    window.removeEventListener(AUTOPILOT_PREVIEW_DRAFT_CLOSE_EVENT, closes)
    expect(closes).toHaveBeenCalledTimes(1)
    // The provider answers with an empty broadcast; the next chart starts with nothing of this one's.
    hold({}, { kind: null })
    expect(screen.getByText(/No chart open/)).toBeTruthy()
    hold(files, { previewed: false })
    expect(screen.queryByText(/Rendered 2 objects/)).toBeNull()
    expect(screen.getByText(UNRENDERED_CAPTION)).toBeTruthy()
  })
})
