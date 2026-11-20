// @vitest-environment jsdom
/**
 * Portal tool calls against the REAL AgentikoProvider: a call the agentiko-portal server accepted runs at
 * finalize, a refused one does not, the call is never an evidence row, and chips come from
 * suggestFollowups. Same harness as claimCheckTurn.test.tsx.
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

const harness = vi.hoisted(() => ({
  apply: vi.fn(),
  sends: [] as { payload: { text: string }; onFrame: (frame: AgentikoFrame) => void }[],
}))

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
vi.mock('./claimTelemetry', () => ({ recordUnbackedClaims: vi.fn() }))
vi.mock('./transport', () => {
  const stub = {
    respondToApproval: () => () => undefined,
    send: (payload: { text: string }, handlers: { onFrame: (frame: AgentikoFrame) => void }) => {
      harness.sends.push({ onFrame: handlers.onFrame, payload })
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

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

/** One turn as the stream delivers it: the frames, the reply text written after them, then `done`. */
const turn = async (ask: string, frames: AgentikoFrame[], text: string) => {
  act(() => api.send(ask))
  const { onFrame } = harness.sends[harness.sends.length - 1]
  await act(async () => {
    for (const frame of frames) {
      onFrame(frame)
    }
    onFrame({ delta: text, kind: 'text' })
    onFrame({ kind: 'done' })
    await flush()
  })
  return api.messages[api.messages.length - 1]
}

const ok = (name: string, id: string): AgentikoFrame => ({ id, isError: false, kind: 'tool_result', name, output: `${name} sent to the portal.` })

beforeEach(() => {
  harness.sends.length = 0
  harness.apply.mockReset()
  harness.apply.mockImplementation((proposal: { verb: string; label?: string }) => Promise.resolve({ label: proposal.label ?? proposal.verb, readOnly: true, verb: proposal.verb }))
  agentikoConversationStore.reset()
  render(<AgentikoProvider><Probe /></AgentikoProvider>)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('a portal tool call drives the portal', () => {
  it('an accepted navigate runs once, shows as a chip, and is no evidence row', async () => {
    const reply = await turn('open the marketplace', [
      { args: { label: 'Marketplace', route: '/marketplace' }, id: 'n1', kind: 'tool_call', name: 'navigate' },
      ok('navigate', 'n1'),
      { args: { suggestions: ['Show installed blueprints'] }, id: 's1', kind: 'tool_call', name: 'suggestFollowups' },
      ok('suggestFollowups', 's1'),
    ], 'The marketplace lists the blueprints you can install.')
    expect(harness.apply).toHaveBeenCalledTimes(1)
    expect(harness.apply.mock.calls[0][0]).toEqual({ label: 'Marketplace', route: '/marketplace', verb: 'navigate' })
    expect(reply.actions?.map((chip) => chip.label)).toEqual(['Marketplace'])
    expect(reply.suggestions).toEqual(['Show installed blueprints'])
    expect(reply.evidence ?? []).toEqual([])
    expect(reply.text).toBe('The marketplace lists the blueprints you can install.')
  })

  it('a call the server refused runs nothing; its corrected retry runs', async () => {
    await turn('add a table of pods', [
      { args: { target: 'page-pods' }, id: 'a1', kind: 'tool_call', name: 'composeAdd' },
      { id: 'a1', isError: true, kind: 'tool_result', name: 'composeAdd', output: 'Tool execution failed. Details: Not sent to the portal.' },
      { args: { kind: 'Table', name: 'pods-table', target: 'page-pods' }, id: 'a2', kind: 'tool_call', name: 'composeAdd' },
      ok('composeAdd', 'a2'),
    ], 'Added a table of pods.')
    expect(harness.apply).toHaveBeenCalledTimes(1)
    expect(harness.apply.mock.calls[0][0]).toMatchObject({ kind: 'Table', name: 'pods-table', verb: 'composeAdd' })
  })

  it('opening a form and filling it is one reply: the navigate, then the prefill', async () => {
    const reply = await turn('alert me when pods crash-loop in demo-system', [
      { args: { route: '/alerts/new' }, id: 'n1', kind: 'tool_call', name: 'navigate' },
      { args: { values: { __alert_name__: 'demo-crashloop', threshold: 1 } }, id: 'p1', kind: 'tool_call', name: 'prefillForm' },
      ok('navigate', 'n1'),
      ok('prefillForm', 'p1'),
    ], 'I opened the alert form and filled it in; review it and press Create.')
    expect(harness.apply.mock.calls.map((args) => (args[0] as { verb: string }).verb)).toEqual(['navigate'])
    expect(reply.actions?.map((chip) => chip.verb)).toEqual(['navigate', 'prefillForm'])
  })
})
