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
import { AgentikoProvider, useAgentiko } from './AgentikoProvider'
import { agentikoConversationStore } from './conversationStore'
import type * as PreviewSurfaceModule from './previewSurface'
import type * as PublishTargetFormModule from './publishTargetForm'
import type { AgentikoFrame } from './types'

const harness = vi.hoisted(() => ({ sends: [] as { onFrame: (frame: AgentikoFrame) => void }[] }))

vi.mock('../../context/ConfigContext', async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigContextModule>()),
  useConfigContext: () => ({ config: { api: { AUTOPILOT_API_BASE_URL: 'echo' } } }),
}))
vi.mock('./askDeepLink', () => ({ useAskDeepLink: () => undefined }))
vi.mock('./useAgentikoContext', () => ({
  buildContextDelta: () => ({}),
  useAgentikoContext: () => ({ collect: () => ({ focus: 'Home', route: '/', widgets: [] }) }),
}))
vi.mock('./actionBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof ActionBridgeModule>()),
  useAgentikoActionBridge: () => ({ apply: vi.fn() }),
}))
vi.mock('./previewSurface', async (importOriginal) => ({
  ...(await importOriginal<typeof PreviewSurfaceModule>()),
  AgentikoPreviewDrawer: () => null,
}))
vi.mock('./publishTargetForm', async (importOriginal) => ({
  ...(await importOriginal<typeof PublishTargetFormModule>()),
  PublishTargetFormHost: () => null,
}))
vi.mock('./transport', () => {
  const stub = {
    respondToApproval: () => () => undefined,
    send: (_payload: unknown, handlers: { onFrame: (frame: AgentikoFrame) => void }) => {
      harness.sends.push(handlers)
      return () => undefined
    },
  }
  return { a2aAuthHeader: () => ({}), createEchoTransport: () => stub, createKagentTransport: () => stub }
})

let api: ReturnType<typeof useAgentiko>
const Probe = () => {
  api = useAgentiko()
  return null
}

const streamingAssistant = () => api.messages.filter((message) => message.streaming)[0]

beforeEach(() => {
  harness.sends.length = 0
  localStorage.clear()
  agentikoConversationStore.reset()
  render(<AgentikoProvider><Probe /></AgentikoProvider>)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('evidence is published while the turn is still streaming', () => {
  it('a tool call reaches the STREAMING message, not only the finished one', () => {
    act(() => { api.send('what is broken?') })
    const [{ onFrame }] = harness.sends

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
    const [{ onFrame }] = harness.sends
    act(() => { onFrame({ args: {}, id: 'c1', kind: 'tool_call', name: 'get_resource' }) })
    act(() => { onFrame({ id: 'c1', kind: 'tool_result', name: 'get_resource', output: 'ok' }) })

    const live = streamingAssistant()
    expect(live.streaming).toBe(true)
    expect(live.evidence?.[0].done).toBe(true)
    expect(live.evidence?.[0].failed).toBeUndefined()
  })

  it('survives the turn: the finished message still carries the evidence', () => {
    act(() => { api.send('what is broken?') })
    const [{ onFrame }] = harness.sends
    act(() => { onFrame({ args: {}, id: 'c1', kind: 'tool_call', name: 'get_resource' }) })
    act(() => { onFrame({ delta: 'done looking', kind: 'text' }) })
    act(() => { onFrame({ kind: 'done' }) })

    const finished = api.messages.filter((message) => message.role === 'assistant').at(-1)
    expect(finished?.streaming).toBe(false)
    expect(finished?.evidence?.map((entry) => entry.tool)).toEqual(['get_resource'])
  })
})

describe('the run timeline’s clocks come from frame arrival', () => {
  it('stamps a call when its frame arrives and its result when that arrives', () => {
    const now = vi.spyOn(Date, 'now')
    act(() => { api.send('what is broken?') })
    const [{ onFrame }] = harness.sends
    now.mockReturnValue(1_000_000)
    act(() => { onFrame({ args: {}, id: 'c1', kind: 'tool_call', name: 'k8s_get_resources' }) })
    now.mockReturnValue(1_000_400)
    act(() => { onFrame({ id: 'c1', kind: 'tool_result', name: 'k8s_get_resources', output: 'ok' }) })
    const [entry] = streamingAssistant().evidence ?? []
    expect([entry.startedAt, entry.endedAt]).toEqual([1_000_000, 1_000_400])
  })

  it('answer text is an event too: it stamps lastEventAt, so a turn writing its answer is not "silent"', () => {
    const now = vi.spyOn(Date, 'now')
    act(() => { api.send('what is broken?') })
    const [{ onFrame }] = harness.sends
    now.mockReturnValue(2_000_000)
    act(() => { onFrame({ delta: 'It is', kind: 'text' }) })
    expect(streamingAssistant().lastEventAt).toBe(2_000_000)
  })
})

describe('an approval pause is stamped on the turn that paused', () => {
  it('so the timeline can render it as that turn’s step', () => {
    act(() => { api.send('fix it') })
    const [{ onFrame }] = harness.sends
    const assistantId = streamingAssistant().id
    act(() => {
      onFrame({ kind: 'require_approval', pause: { requests: [{ argumentsPreview: 'kind: X', requestId: 'r1', toolName: 'k8s_apply_manifest' }], taskId: 't1' } })
    })
    act(() => { onFrame({ kind: 'done' }) })
    const paused = api.messages.find((message) => message.id === assistantId)
    expect(typeof paused?.approvalAt).toBe('number')
    expect(api.pendingApproval?.taskId).toBe('t1')
  })
})
