// @vitest-environment jsdom
/**
 * A pause opened from an approval LINK (`?agentiko=<contextId>`) is EXPLICIT ONLY (Diego,
 * 2026-11-21): the provider's thread teardown, which DENIES a pause this rail's own turn hit, must
 * leave a linked one paused, because the task was started by the person's own agent, maybe hours
 * ago, and a new thread or a switched conversation is not a decision about it. The control is the
 * same teardown over a rail-started pause, which must still send the reject.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ConfigContextModule from '../../context/ConfigContext'

import type * as ActionBridgeModule from './actionBridge'
import { AgentikoProvider, useAgentiko } from './AgentikoProvider'
import { createApprovalGovernor, createExplicitApprovalGovernor, type ApprovalPause } from './approval'
import { agentikoConversationStore } from './conversationStore'
import type * as PreviewSurfaceModule from './previewSurface'
import type * as PublishTargetFormModule from './publishTargetForm'
import type { AgentikoFrame } from './types'
import type { ApprovalLinkWiring } from './useApprovalLink'

const harness = vi.hoisted(() => ({
  apply: vi.fn(),
  responses: [] as { decision: unknown; pause: unknown }[],
  sends: [] as { onFrame: (frame: AgentikoFrame) => void }[],
  wiring: null as null | ApprovalLinkWiring,
}))

vi.mock('../../context/ConfigContext', async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigContextModule>()),
  useConfigContext: () => ({ config: { api: { AUTOPILOT_API_BASE_URL: 'echo' } } }),
}))
vi.mock('./askDeepLink', () => ({ useAskDeepLink: () => undefined }))
// Capture the wiring the provider hands the link hook: what is under test here is the provider's
// teardown rule for a pause the hook installs (useApprovalLink.test.tsx covers the hook itself).
vi.mock('./useApprovalLink', () => ({
  useApprovalLink: (wiring: ApprovalLinkWiring) => { harness.wiring = wiring },
}))
vi.mock('./useAgentikoContext', () => ({
  buildContextDelta: () => ({}),
  useAgentikoContext: () => ({ collect: () => ({ focus: 'Home', route: '/', widgets: [] }) }),
}))
vi.mock('./actionBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof ActionBridgeModule>()),
  useAgentikoActionBridge: () => ({ apply: harness.apply }),
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
    respondToApproval: (decision: unknown, pause: unknown) => {
      harness.responses.push({ decision, pause })
      return () => undefined
    },
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

const PAUSE: ApprovalPause = {
  contextId: 'ctx-1',
  requests: [{ argumentsPreview: 'name: payments-api', requestId: 'conf-1', toolName: 'k8s_delete_resource' }],
  taskId: 't-paused',
}

const install = (pause: ApprovalPause, governor = pause.origin === 'link' ? createExplicitApprovalGovernor() : createApprovalGovernor(() => undefined)) => {
  const wiring = harness.wiring!
  act(() => {
    wiring.approvalRef.current = { governor, pause }
    wiring.setPendingApproval(pause)
  })
}

beforeEach(() => {
  harness.responses.length = 0
  harness.sends.length = 0
  harness.wiring = null
  localStorage.clear()
  agentikoConversationStore.reset()
  render(<AgentikoProvider><Probe /></AgentikoProvider>)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('a linked pause survives what denies a rail-started one', () => {
  it('a new thread leaves a LINKED pause paused: nothing is sent', () => {
    install({ ...PAUSE, origin: 'link' })
    expect(api.pendingApproval?.origin).toBe('link')
    act(() => { api.newThread() })
    expect(harness.responses).toEqual([])
    expect(api.pendingApproval).toBeNull()
  })

  it('control: the same new thread over a rail-started pause still DENIES it', () => {
    install(PAUSE)
    act(() => { api.newThread() })
    expect(harness.responses).toHaveLength(1)
    expect(harness.responses[0]).toMatchObject({ decision: { type: 'reject' }, pause: { taskId: 't-paused' } })
  })

  it('Approve on a linked pause is sent, once, on the paused task', () => {
    install({ ...PAUSE, origin: 'link' })
    act(() => { api.approvePending() })
    act(() => { api.approvePending() })
    expect(harness.responses).toHaveLength(1)
    expect(harness.responses[0]).toMatchObject({ decision: { type: 'approve' }, pause: { contextId: 'ctx-1', origin: 'link', taskId: 't-paused' } })
  })
})
