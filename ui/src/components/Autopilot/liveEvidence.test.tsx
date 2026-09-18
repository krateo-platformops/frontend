// @vitest-environment jsdom
/**
 * The provider half: evidence must reach the message WHILE it is still streaming.
 *
 * This is the actual defect. Tool frames were recorded into a ref, and a ref does not re-render —
 * so the rail could not have shown activity during a turn even though every step was already being
 * reported. Testing it through the real provider rather than a mock is the point: the ref is an
 * implementation detail, and what a consumer can observe is the message.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ConfigContextModule from '../../context/ConfigContext'

import type * as ActionBridgeModule from './actionBridge'
import { AutopilotProvider, useAutopilot } from './AutopilotProvider'
import { autopilotConversationStore } from './conversationStore'
import type * as PreviewSurfaceModule from './previewSurface'
import type * as PublishTargetFormModule from './publishTargetForm'
import type { AutopilotFrame } from './types'

const harness = vi.hoisted(() => ({ sends: [] as { onFrame: (frame: AutopilotFrame) => void }[] }))

vi.mock('../../context/ConfigContext', async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigContextModule>()),
  useConfigContext: () => ({ config: { api: { AUTOPILOT_API_BASE_URL: 'echo' } } }),
}))
vi.mock('./askDeepLink', () => ({ useAskDeepLink: () => undefined }))
vi.mock('./useAutopilotContext', () => ({
  buildContextDelta: () => ({}),
  useAutopilotContext: () => ({ collect: () => ({ focus: 'Home', route: '/', widgets: [] }) }),
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
  const stub = {
    respondToApproval: () => () => undefined,
    send: (_payload: unknown, handlers: { onFrame: (frame: AutopilotFrame) => void }) => {
      harness.sends.push(handlers)
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

const streamingAssistant = () => api.messages.filter((message) => message.streaming)[0]

beforeEach(() => {
  harness.sends.length = 0
  localStorage.clear()
  autopilotConversationStore.reset()
  render(<AutopilotProvider><Probe /></AutopilotProvider>)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('evidence is published while the turn is still streaming', () => {
  it('a tool call reaches the STREAMING message, not only the finished one', () => {
    act(() => { api.send('what is broken?') })
    const { onFrame } = harness.sends[0]

    act(() => { onFrame({ args: {}, id: 'c1', kind: 'tool_call', name: 'get_resource' }) })

    const live = streamingAssistant()
    expect(live).toBeTruthy()
    expect(live.streaming).toBe(true)
    expect(live.evidence?.map((entry) => entry.tool)).toEqual(['get_resource'])
    // …and it is not yet marked finished, which is what the strip renders as "running".
    expect(live.evidence?.[0].done).toBeUndefined()
  })

  it('the result marks that same entry done, still mid-turn', () => {
    act(() => { api.send('what is broken?') })
    const { onFrame } = harness.sends[0]
    act(() => { onFrame({ args: {}, id: 'c1', kind: 'tool_call', name: 'get_resource' }) })
    act(() => { onFrame({ id: 'c1', kind: 'tool_result', name: 'get_resource', output: 'ok' }) })

    const live = streamingAssistant()
    expect(live.streaming).toBe(true)
    expect(live.evidence?.[0].done).toBe(true)
    expect(live.evidence?.[0].failed).toBeUndefined()
  })

  it('survives the turn: the finished message still carries the evidence', () => {
    act(() => { api.send('what is broken?') })
    const { onFrame } = harness.sends[0]
    act(() => { onFrame({ args: {}, id: 'c1', kind: 'tool_call', name: 'get_resource' }) })
    act(() => { onFrame({ delta: 'done looking', kind: 'text' }) })
    act(() => { onFrame({ kind: 'done' }) })

    const finished = api.messages.filter((message) => message.role === 'assistant').at(-1)
    expect(finished?.streaming).toBe(false)
    expect(finished?.evidence?.map((entry) => entry.tool)).toEqual(['get_resource'])
  })
})
