// @vitest-environment jsdom
/**
 * THE PREVIEW-DATA TRAMPOLINE, against the REAL AutopilotProvider (frontend#442 D10).
 *
 * A specialist hands back a page; Agentiko previews it live; the portal reads what the preview
 * rendered. These pin the wiring around that read: a render with problems sends ONE hidden follow-up
 * turn naming them, a clean render sends nothing, a page nobody delegated is not chased, the loop
 * stops at its bound, and a person who has already asked something else is never interrupted by a
 * check of the previous request.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ConfigContextModule from '../../context/ConfigContext'
import { getUserInfo } from '../../utils/getUserInfo'

import type * as ActionBridgeModule from './actionBridge'
import { AutopilotProvider, useAutopilot } from './AutopilotProvider'
import { autopilotConversationStore } from './conversationStore'
import { draftOwner } from './draftRecord'
import { getPreviewRender, setPreviewRender } from './previewBus'
import type * as PreviewRenderModule from './previewRender'
import { sandboxDraftName } from './previewSandbox'
import type * as PreviewSurfaceModule from './previewSurface'
import type * as PublishTargetFormModule from './publishTargetForm'
import type { AutopilotFrame } from './types'

const SANDBOX = 'krateo-preview'

const harness = vi.hoisted(() => ({
  apply: vi.fn(),
  rendered: [] as PreviewRenderModule.RenderedWidgetState[],
  sends: [] as { onFrame: (frame: AutopilotFrame) => void; text: string }[],
}))

vi.mock('../../context/ConfigContext', async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigContextModule>()),
  useConfigContext: () => ({ config: { api: { AUTOPILOT_API_BASE_URL: 'echo', PREVIEW_SANDBOX_NAMESPACE: 'krateo-preview' } } }),
}))
vi.mock('./askDeepLink', () => ({ useAskDeepLink: () => undefined }))
vi.mock('./useAutopilotContext', () => ({
  buildContextDelta: () => ({}),
  useAutopilotContext: () => ({ collect: () => ({ focus: 'Home', route: '/', widgets: [] }), readRenderedWidgets: () => harness.rendered }),
}))
// The wait is previewRender.test.ts's to pin; here the render is already settled.
vi.mock('./previewRender', async (importOriginal) => {
  const actual = await importOriginal<typeof PreviewRenderModule>()
  return { ...actual, awaitSettledPreview: (read: () => PreviewRenderModule.RenderedWidgetState[]) => Promise.resolve({ states: read(), timedOut: false }) }
})
vi.mock('./actionBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof ActionBridgeModule>()),
  useAutopilotActionBridge: () => ({ apply: harness.apply }),
}))
vi.mock('./previewSurface', async (importOriginal) => ({
  ...(await importOriginal<typeof PreviewSurfaceModule>()),
  AutopilotPreviewDrawer: () => null,
}))
vi.mock('./publishTargetForm', async (importOriginal) => ({
  ...(await importOriginal<typeof PublishTargetFormModule>()),
  PublishTargetFormHost: () => null,
}))
vi.mock('./transport', () => {
  const stub = {
    respondToApproval: () => () => undefined,
    send: (payload: { text: string }, handlers: { onFrame: (frame: AutopilotFrame) => void }) => {
      harness.sends.push({ ...handlers, text: payload.text })
      return () => undefined
    },
  }
  return { a2aAuthHeader: () => ({}), createEchoTransport: () => stub, createKagentTransport: () => stub }
})

let api: ReturnType<typeof useAutopilot>
const Probe = () => {
  api = useAutopilot()
  return null
}

const WIDGETS = [
  { kind: 'Flex', metadata: { name: 'page-pods' } },
  { kind: 'Table', metadata: { name: 'pods-table' } },
]
const LIVE_CHIP = { label: 'live preview — 2 drafts → krateo-preview', readOnly: false, rendered: true, verb: 'previewPage' }

const tableServing = (dataSource: unknown[]): PreviewRenderModule.RenderedWidgetState => ({
  data: { kind: 'Table', status: { widgetData: { dataSource } } },
  endpoint: `/call?resource=tables&apiVersion=widgets.templates.krateo.io/v1beta1&name=${sandboxDraftName('pods-table', draftOwner(getUserInfo().username))}&namespace=${SANDBOX}`,
  loadState: 'ready',
  updatedAt: Date.now() + 60_000,
})

/** One agent turn: optionally a delegation to frontend-agent, then the previewPage it carries. */
const streamPreviewTurn = (turn: number, { delegated = true } = {}) => {
  const { onFrame } = harness.sends[turn]
  if (delegated) {
    onFrame({ args: { request: 'a table of the pods' }, id: `call-${turn}`, kind: 'tool_call', name: 'krateo_system__NS__frontend_agent' })
    onFrame({ id: `call-${turn}`, kind: 'tool_result', name: 'krateo_system__NS__frontend_agent', output: 'the page' })
  }
  onFrame({ delta: 'Previewing the page now.', kind: 'text' })
  onFrame({ args: { verb: 'previewPage', widgets: WIDGETS }, kind: 'tool_call', name: 'propose_portal_action' })
  onFrame({ kind: 'done' })
}

/** Let finalize, the detached render check and the follow-up's send all run. */
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- draining queued microtasks and timers in turn
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    }
  })
}

beforeEach(() => {
  harness.sends.length = 0
  harness.rendered = []
  harness.apply.mockReset()
  harness.apply.mockResolvedValue(LIVE_CHIP)
  autopilotConversationStore.reset()
  setPreviewRender(null)
  render(<AutopilotProvider><Probe /></AutopilotProvider>)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('a live preview of a specialist\'s page is read back', () => {
  it('an empty table sends ONE hidden follow-up naming it, and the page context carries it', async () => {
    harness.rendered = [tableServing([])]
    act(() => api.send('build me a page of the pods'))
    act(() => streamPreviewTurn(0))
    await settle()

    expect(harness.sends).toHaveLength(2)
    expect(harness.sends[1].text).toContain('- Table pods-table: empty — empty: 0 rows')
    expect(harness.sends[1].text).toContain('frontend-agent')
    expect(getPreviewRender()).toEqual({ problems: ['Table pods-table: empty — empty: 0 rows'], rendered: [] })
    // Hidden: the person typed one message, and sees one user bubble.
    expect(api.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    const previewing = api.messages.find((message) => message.text === 'Previewing the page now.')
    expect(previewing?.actions?.map((chip) => chip.label)).toEqual([LIVE_CHIP.label, 'preview rendered with 1 problem: Table pods-table: empty — empty: 0 rows'])
  })

  it('a clean render sends nothing more, and its chip says what rendered', async () => {
    harness.rendered = [tableServing([{ name: 'a' }, { name: 'b' }])]
    act(() => api.send('build me a page of the pods'))
    act(() => streamPreviewTurn(0))
    await settle()

    expect(harness.sends).toHaveLength(1)
    const previewing = api.messages.find((message) => message.text === 'Previewing the page now.')
    expect(previewing?.actions?.at(-1)?.label).toBe('Preview rendered: Table pods-table: 2 rows')
  })

  it('a page no specialist authored this request is not chased', async () => {
    harness.rendered = [tableServing([])]
    act(() => api.send('preview it again'))
    act(() => streamPreviewTurn(0, { delegated: false }))
    await settle()

    expect(harness.sends).toHaveLength(1)
  })

  it('stops at its bound: the same problems twice turn into a report, then nothing', async () => {
    harness.rendered = [tableServing([])]
    act(() => api.send('build me a page of the pods'))
    act(() => streamPreviewTurn(0))
    await settle()
    expect(harness.sends[1].text).toMatch(/automatic check 1 of 3/)

    act(() => streamPreviewTurn(1))
    await settle()
    expect(harness.sends).toHaveLength(3)
    expect(harness.sends[2].text).toMatch(/same problems the previous check reported/)

    // The report turn obeys and previews nothing; even if it did, the loop has stopped.
    act(() => streamPreviewTurn(2))
    await settle()
    expect(harness.sends).toHaveLength(3)
  })

  it('a check that settles after the person asked something else sends nothing', async () => {
    harness.rendered = [tableServing([])]
    let release: (chip: unknown) => void = () => undefined
    harness.apply.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    act(() => api.send('build me a page of the pods'))
    act(() => streamPreviewTurn(0))
    // The person asks something else while the preview is still being applied, and that answer
    // delegates too — so only the request the check belongs to can tell the two apart.
    act(() => api.send('what time is it?'))
    act(() => {
      const [, { onFrame }] = harness.sends
      onFrame({ args: {}, id: 'call-x', kind: 'tool_call', name: 'krateo_system__NS__k8s_agent' })
      onFrame({ delta: 'It is noon.', kind: 'text' })
      onFrame({ kind: 'done' })
    })
    act(() => { release(LIVE_CHIP) })
    await settle()

    expect(harness.sends.map(({ text }) => text)).toEqual(['build me a page of the pods', 'what time is it?'])
  })
})
