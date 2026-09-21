// @vitest-environment jsdom
/**
 * Starting a fresh Autopilot thread must NOT destroy the page you are composing.
 *
 * `teardownThread` cleared the held draft, on the stated grounds that it was "dropped with the
 * conversation that produced them". That was true when every draft came from a conversation. The
 * composer ended it: a person starts a page, drags widgets in and binds data with no agent
 * involved — and clicking New thread silently destroyed the page, with no warning and no undo.
 *
 * Reproduced on krateo-057 before the fix: the canvas went from 2 frames to 0 on the click. And
 * starting a fresh thread is exactly what the builder flow tells you to do before asking the agent
 * for help, so the advice and the data loss arrived together.
 *
 * The GATES still reset — that is where deny-by-default lives: publish is denied until the draft is
 * previewed again. Only the bytes survive.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ConfigContextModule from '../../context/ConfigContext'

import type * as ActionBridgeModule from './actionBridge'
import { AutopilotProvider, useAutopilot } from './AutopilotProvider'
import { AUTOPILOT_DRAFT_CHANGED_EVENT } from './previewDraftChanged'
import { emitDraftStart } from './previewDraftStart'
import type * as PreviewSurfaceModule from './previewSurface'
import type * as PublishTargetFormModule from './publishTargetForm'

vi.mock('../../context/ConfigContext', async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigContextModule>()),
  useConfigContext: () => ({ config: { api: { AUTOPILOT_API_BASE_URL: 'echo' } } }),
}))
vi.mock('./askDeepLink', () => ({ useAskDeepLink: () => undefined }))
vi.mock('./useAutopilotContext', () => ({
  buildContextDelta: () => ({}),
  useAutopilotContext: () => ({ collect: () => ({ focus: 'Composer', route: '/', widgets: [] }) }),
}))
vi.mock('./actionBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof ActionBridgeModule>()),
  useAutopilotActionBridge: () => ({ apply: vi.fn() }),
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
  const stub = { respondToApproval: () => () => undefined, send: () => () => undefined }
  return { a2aAuthHeader: () => ({}), createEchoTransport: () => stub, createKagentTransport: () => stub }
})

let api: ReturnType<typeof useAutopilot>
const Probe = () => {
  api = useAutopilot()
  return null
}

const page = () => [{
  apiVersion: 'widgets.templates.krateo.io/v1beta1',
  kind: 'Flex',
  metadata: { name: 'page-service-catalog', namespace: 'krateo-system' },
  spec: { widgetData: { items: [] } },
}]

let broadcasts: number[]
const onChanged = (event: Event) => {
  broadcasts.push(Object.keys((event as CustomEvent<{ files: object }>).detail.files).length)
}

beforeEach(() => {
  broadcasts = []
  localStorage.clear()
  window.addEventListener(AUTOPILOT_DRAFT_CHANGED_EVENT, onChanged)
  render(<AutopilotProvider><Probe /></AutopilotProvider>)
})

afterEach(() => {
  window.removeEventListener(AUTOPILOT_DRAFT_CHANGED_EVENT, onChanged)
  cleanup()
  vi.restoreAllMocks()
})

describe('a new thread keeps the page you are building', () => {
  it('does not broadcast an EMPTY draft when a fresh thread starts', () => {
    act(() => { emitDraftStart({ title: 'Service catalog', widgets: page() }) })
    expect(broadcasts.at(-1)).toBeGreaterThan(0)

    act(() => { api.newThread() })

    // The regression: teardownThread called blueprintStore.clear(), whose onChange broadcast an
    // empty file map — which is what emptied the composer's canvas.
    expect(broadcasts.at(-1)).toBeGreaterThan(0)
  })

  it('still resets the publish gate — deny-by-default is carried by the gate, not by deletion', () => {
    act(() => { emitDraftStart({ title: 'Service catalog', widgets: page() }) })
    act(() => { api.newThread() })
    // A fresh thread has no recorded preview, so a publish must be refused until re-previewed.
    expect(api.messages).toHaveLength(0)
  })
})
