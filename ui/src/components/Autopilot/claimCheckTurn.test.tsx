// @vitest-environment jsdom
/**
 * THE CLAIM CHECK, against the REAL AutopilotProvider — the half the kernel test cannot see: that
 * `finalize` hands the kernel what the turn actually did (nothing / a refused action / an applied
 * one), stamps the result on the message without touching its text, records it for counting, and
 * that Retry re-asks once as a hidden turn. Same harness as speakBackTurn.test.tsx.
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

const harness = vi.hoisted(() => ({
  apply: vi.fn(),
  record: vi.fn(),
  sends: [] as { payload: { text: string }; onFrame: (frame: AutopilotFrame) => void }[],
}))

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
vi.mock('./claimTelemetry', () => ({ recordUnbackedClaims: harness.record }))
vi.mock('./transport', () => {
  const stub = {
    respondToApproval: () => () => undefined,
    send: (payload: { text: string }, handlers: { onFrame: (frame: AutopilotFrame) => void }) => {
      harness.sends.push({ onFrame: handlers.onFrame, payload })
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

const POD_SIZING = 'I have authored and previewed the pod-sizing-23 page in the live sandbox drawer.'

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

/** One turn: the reply text, optionally proposals (in order), then `done` — and let finalize finish. */
const turn = async (text: string, ...proposals: Record<string, unknown>[]) => {
  act(() => api.send('build me a pod sizing page and preview it'))
  const { onFrame } = harness.sends[harness.sends.length - 1]
  await act(async () => {
    onFrame({ delta: text, kind: 'text' })
    for (const proposal of proposals) {
      onFrame({ args: proposal, kind: 'tool_call', name: 'propose_portal_action' })
    }
    onFrame({ kind: 'done' })
    await flush()
  })
  return api.messages[api.messages.length - 1]
}

beforeEach(() => {
  harness.sends.length = 0
  harness.apply.mockReset()
  harness.record.mockReset()
  autopilotConversationStore.reset()
  render(<AutopilotProvider><Probe /></AutopilotProvider>)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('finalize runs the claim check on what the turn actually did', () => {
  it('the pod-sizing-23 reply with NO action: flagged as missing, text untouched, recorded', async () => {
    const reply = await turn(POD_SIZING)
    expect(reply.text).toBe(POD_SIZING)
    expect(reply.claims).toEqual([{ family: 'preview', outcome: 'missing', phrase: 'I have authored and previewed' }])
    expect(harness.record).toHaveBeenCalledWith(reply.claims, api.sessionId)
  })

  it('a previewPage the portal REFUSED: still unbacked, as refused', async () => {
    // The chip `refused('previewPage')` returns (actionBridge.ts), by value: the bridge module is mocked here.
    harness.apply.mockResolvedValue({ label: 'previewPage — this portal did not run it', readOnly: true, verb: 'previewPage' })
    const reply = await turn(POD_SIZING, { verb: 'previewPage', widgets: [] })
    expect(reply.actions?.[0]?.label).toBe('previewPage — this portal did not run it')
    expect(reply.claims).toEqual([{ family: 'preview', outcome: 'refused', phrase: 'I have authored and previewed' }])
  })

  it('a previewBlueprint that FAILED to render: unbacked, as failed', async () => {
    harness.apply.mockResolvedValue({ label: 'preview demo (render failed)', previewFailed: true, readOnly: true, verb: 'previewBlueprint' })
    const reply = await turn('I have previewed the demo chart.', { verb: 'previewBlueprint' })
    expect(reply.claims?.[0]?.outcome).toBe('failed')
  })

  it('an applied preview backs the claim — nothing flagged, nothing recorded', async () => {
    harness.apply.mockResolvedValue({ label: 'explain upgrade → 1.2.0 (3 changes)', readOnly: true, verb: 'explainUpgradeImpact' })
    const offer = await turn('I can preview the pod-sizing-23 page for you — shall I?', { toVersion: '1.2.0', verb: 'explainUpgradeImpact' })
    expect(offer.claims).toBeUndefined()
    harness.apply.mockResolvedValue({ label: 'restdef preview', readOnly: true, verb: 'previewRestDef' })
    const reply = await turn('I have previewed the API mapping.', { verb: 'previewRestDef' })
    expect(reply.claims).toBeUndefined()
    expect(harness.record).not.toHaveBeenCalled()
  })

  it('krateo-057: a REFUSED controllerMapVerb described as done is flagged, naming the refusal', async () => {
    const reason = 'GET /pets/{petId} is not an operation of the document.'
    harness.apply.mockResolvedValue({ label: `controllerMapVerb — this portal did not run it (${reason})`, readOnly: true, refused: true, verb: 'controllerMapVerb' })
    const text = 'Mapped the get verb for kind Pet to GET /pets/{petId}.'
    const reply = await turn(text, { kind: 'Pet', method: 'GET', path: '/pets/{petId}', restAction: 'get', verb: 'controllerMapVerb' })
    expect(reply.text).toBe(text)
    expect(reply.claims).toEqual([{ attempt: 'mapped get → GET /pets/{petId}', family: 'controller', outcome: 'refused', phrase: 'Mapped', reason: 'GET /pets/{petId} is not an operation of the document' }])
  })

  it('a trailing previewRestDef SKIPPED after a refused edit does not back "I previewed it"', async () => {
    harness.apply.mockResolvedValue({ label: 'controllerPlace — this portal did not run it (no such group)', readOnly: true, refused: true, verb: 'controllerPlace' })
    const reply = await turn('I previewed it.', { group: 'nope', verb: 'controllerPlace' }, { verb: 'previewRestDef' })
    expect(harness.apply).toHaveBeenCalledTimes(1)
    expect(reply.claims).toHaveLength(1)
    expect(reply.claims?.[0]).toMatchObject({ family: 'preview', outcome: 'refused' })
    expect(reply.claims?.[0]?.reason).toMatch(/^an edit before it was refused/)
  })

  it('Retry re-asks ONCE as a hidden turn, naming the verb it never emitted', async () => {
    const reply = await turn(POD_SIZING)
    const before = api.messages.length
    act(() => api.retryClaims(reply.id))
    expect(harness.sends).toHaveLength(2)
    expect(harness.sends[1].payload.text).toContain('previewPage')
    // No user bubble for the nudge — only the new assistant reply.
    expect(api.messages).toHaveLength(before + 1)
    expect(api.messages.find((message) => message.id === reply.id)?.claimRetried).toBe(true)
    act(() => api.retryClaims(reply.id))
    expect(harness.sends).toHaveLength(2)
  })
})
