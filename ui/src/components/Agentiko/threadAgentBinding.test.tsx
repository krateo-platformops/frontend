// @vitest-environment jsdom
/**
 * A stored thread is continued only with the agent it was opened against — the provider half,
 * through the real AgentikoProvider after a page reload (conversationStore.agent.test.ts covers
 * the store on its own).
 *
 * The scenario: the orchestrator is renamed from `autopilot` to `agentiko`, and the portal's A2A
 * endpoint changes with it. kagent looks a session up by `(contextId, user)` only and refuses a
 * write to a session another agent owns, so replaying the stored contextId would fail every turn.
 * The thread's messages stay on screen; the next turn goes out with no contextId, and the one the
 * server assigns is stored against the new agent.
 *
 * Each test seeds localStorage with a literal record, then imports the provider fresh, so the
 * conversation store's module-level rehydration reads that record exactly as a reload would.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ConfigContextModule from '../../context/ConfigContext'

import type * as ActionBridgeModule from './actionBridge'
import type * as ProviderModule from './AgentikoProvider'
import type * as PreviewSurfaceModule from './previewSurface'
import type * as PublishTargetFormModule from './publishTargetForm'
import type { AgentikoFrame, AgentikoSendRequest } from './types'

const AUTOPILOT_ENDPOINT = 'https://gateway.example/api/a2a/krateo-system/autopilot'
const AGENTIKO_ENDPOINT = 'https://gateway.example/api/a2a/krateo-system/agentiko'

const harness = vi.hoisted(() => ({
  endpoint: '',
  sends: [] as { request: AgentikoSendRequest; onFrame: (frame: AgentikoFrame) => void }[],
}))

vi.mock('../../context/ConfigContext', async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigContextModule>()),
  useConfigContext: () => ({ config: { api: { AGENTIKO_API_BASE_URL: harness.endpoint } } }),
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
    send: (request: AgentikoSendRequest, handlers: { onFrame: (frame: AgentikoFrame) => void }) => {
      harness.sends.push({ onFrame: handlers.onFrame, request })
      return () => undefined
    },
  }
  return { a2aAuthHeader: () => ({}), createEchoTransport: () => stub, createKagentTransport: () => stub }
})

const CURRENT = 'krateo.agentiko.current.v1'

const userTurn = (text: string) => ({ createdAt: 1, id: `u-${text}`, role: 'user', text })
const assistantTurn = (text: string) => ({ createdAt: 2, id: `a-${text}`, role: 'assistant', text })

const HISTORY = [userTurn('why is the composition not ready?'), assistantTurn('Because its provider is paused.')]

/** A live thread as persisted; `agent` is spread in only when the test's record carries it. */
const storedThread = (extra: Record<string, unknown>) => ({
  contextId: 'ctx-old',
  messages: HISTORY,
  sessionId: 's_live_01',
  title: 'why is the composition not ready?',
  updatedAt: 1762300000000,
  ...extra,
})

const storedCurrent = (): Record<string, unknown> | null => {
  const raw = localStorage.getItem(CURRENT)
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
}

type Api = ReturnType<typeof ProviderModule.useAgentiko>

/** Seed the stored thread, set the endpoint, then import + mount the provider as a reload would. */
const reloadWith = async (record: Record<string, unknown>, endpoint: string): Promise<{ api: () => Api }> => {
  localStorage.setItem(CURRENT, JSON.stringify(record))
  harness.endpoint = endpoint
  vi.resetModules()
  const { AgentikoProvider, useAgentiko } = await import('./AgentikoProvider')
  let api: Api | undefined
  const Probe = () => {
    api = useAgentiko()
    return null
  }
  render(<AgentikoProvider><Probe /></AgentikoProvider>)
  return { api: () => api as Api }
}

beforeEach(() => {
  harness.sends.length = 0
  localStorage.clear()
  // The availability probe GETs the endpoint; answer it so it settles quietly.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200 })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a thread opened against autopilot, after the portal moved to agentiko', () => {
  it('sends the next turn with no contextId, keeps the history, and stores the new contextId against agentiko', async () => {
    const { api } = await reloadWith(storedThread({ agent: 'autopilot' }), AGENTIKO_ENDPOINT)

    // The old conversation is still on screen.
    expect(api().messages.map((message) => message.text)).toEqual(['why is the composition not ready?', 'Because its provider is paused.'])

    act(() => { api().send('and now?') })

    expect(harness.sends).toHaveLength(1)
    expect(harness.sends[0].request.contextId).toBeUndefined()
    // History rendered, with the new turn appended after it rather than replacing it.
    expect(api().messages.filter((message) => message.role === 'user').map((message) => message.text))
      .toEqual(['why is the composition not ready?', 'and now?'])

    act(() => { harness.sends[0].onFrame({ contextId: 'ctx-new', kind: 'session' }) })

    expect(storedCurrent()).toMatchObject({ agent: 'agentiko', contextId: 'ctx-new', sessionId: 's_live_01' })

    // And the thread now continues with agentiko under the new contextId.
    act(() => {
      harness.sends[0].onFrame({ delta: 'ok', kind: 'text' })
      harness.sends[0].onFrame({ kind: 'done' })
    })
    act(() => { api().send('and after that?') })
    expect(harness.sends[1].request.contextId).toBe('ctx-new')
  })
})

describe('a thread stored with no agent field (opened before this change)', () => {
  it('continues with its contextId while the portal calls autopilot', async () => {
    const { api } = await reloadWith(storedThread({}), AUTOPILOT_ENDPOINT)

    act(() => { api().send('and now?') })

    expect(harness.sends[0].request.contextId).toBe('ctx-old')
  })

  it('starts fresh when the portal calls agentiko', async () => {
    const { api } = await reloadWith(storedThread({}), AGENTIKO_ENDPOINT)

    act(() => { api().send('and now?') })

    expect(harness.sends[0].request.contextId).toBeUndefined()
    expect(api().messages.filter((message) => message.role === 'user')).toHaveLength(2)
  })

  it('the same-origin proxy path `/autopilot` reaches autopilot, so the thread continues', async () => {
    const { api } = await reloadWith(storedThread({}), '/autopilot')

    act(() => { api().send('and now?') })

    expect(harness.sends[0].request.contextId).toBe('ctx-old')
  })
})

describe('the same agent', () => {
  it('continues the stored thread unchanged', async () => {
    const { api } = await reloadWith(storedThread({ agent: 'agentiko' }), AGENTIKO_ENDPOINT)

    act(() => { api().send('and now?') })

    expect(harness.sends[0].request.contextId).toBe('ctx-old')
    expect(storedCurrent()).toMatchObject({ agent: 'agentiko', contextId: 'ctx-old' })
  })
})
