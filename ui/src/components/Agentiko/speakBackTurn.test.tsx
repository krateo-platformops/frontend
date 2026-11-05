// @vitest-environment jsdom
/**
 * WHICH TURN GETS SPOKEN — the provider half of the trigger, against the REAL
 * AgentikoProvider (speakBack.test.tsx stubs it, so it cannot see any of this).
 *
 * The property under test is narrow and easy to lose: `finalize` is async and it sets
 * `streaming: false` BEFORE it awaits `apply` — deliberately, so the composer comes back
 * while a blast-radius confirm or a destination form is up. That means a second turn can
 * legitimately start while the first is still suspended, and any single "how was the last
 * turn asked" value read after the await belongs to the WRONG turn. The consequence is not
 * cosmetic: it reads a typed answer aloud (the one thing the owner's single-trigger rule
 * forbids) and swallows the spoken one.
 *
 * So each turn's provenance is asserted to survive an interleaved turn of the opposite
 * modality, in both directions.
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
import { agentikoSpeakBackStore } from './voice/speak/speakBackStore'

const harness = vi.hoisted(() => ({
  apply: vi.fn(),
  approvals: [] as { onFrame: (frame: AgentikoFrame) => void }[],
  sends: [] as { onFrame: (frame: AgentikoFrame) => void }[],
}))

vi.mock('../../context/ConfigContext', async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigContextModule>()),
  // "echo" keeps the reachability probe (and its fetch) out of the mount; the transport
  // itself is replaced below, so nothing echoes either.
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
vi.mock('./transport', () => {
  const stub = {
    respondToApproval: (_decision: unknown, _pause: unknown, handlers: { onFrame: (frame: AgentikoFrame) => void }) => {
      harness.approvals.push(handlers)
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

const CHIP = { label: 'inspected the payments deployment', readOnly: true, verb: 'describeResource' }

/** An answer plus a proposal, so `finalize` reaches (and suspends on) `await apply`. */
const streamAnswer = (turn: number, text: string) => {
  const { onFrame } = harness.sends[turn]
  onFrame({ delta: text, kind: 'text' })
  onFrame({ args: { label: CHIP.label, verb: 'describeResource' }, kind: 'tool_call', name: 'propose_portal_action' })
  onFrame({ kind: 'done' })
}

/** Let queued microtasks AND a `setTimeout(…, 0)` (the recovery trampoline) run. */
const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

// Seeded here (not merely declared) so their types come from the store itself; every test
// gets a fresh pair from beforeEach, and restoreAllMocks unwinds them.
let speakAnswer = vi.spyOn(agentikoSpeakBackStore, 'speakAnswer')
let cancel = vi.spyOn(agentikoSpeakBackStore, 'cancel')

beforeEach(() => {
  harness.sends.length = 0
  harness.approvals.length = 0
  harness.apply.mockReset()
  agentikoConversationStore.reset()
  speakAnswer = vi.spyOn(agentikoSpeakBackStore, 'speakAnswer')
  cancel = vi.spyOn(agentikoSpeakBackStore, 'cancel')
  render(<AgentikoProvider><Probe /></AgentikoProvider>)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Hold `apply` pending so the first turn's finalize is suspended mid-flight. */
const deferApply = (): { settle: () => Promise<void> } => {
  let release: (chip: unknown) => void = () => undefined
  harness.apply.mockImplementation(() => new Promise((resolve) => { release = resolve }))
  return {
    settle: async () => {
      await act(async () => {
        release(CHIP)
        await flush()
      })
    },
  }
}

describe('a turn is spoken on ITS OWN provenance, not the last one seen', () => {
  it('still speaks a VOICE turn whose finalize was suspended while a TYPED turn started', async () => {
    const pending = deferApply()
    act(() => api.send('why are the payments pods restarting?', { modality: 'voice' }))
    act(() => streamAnswer(0, 'Two replicas are Ready.'))
    // finalize is suspended in `await apply`, and the composer is already back.
    expect(api.streaming).toBe(false)
    expect(speakAnswer).not.toHaveBeenCalled()

    act(() => api.send('and the ingress?'))
    await pending.settle()

    expect(speakAnswer).toHaveBeenCalledTimes(1)
    expect(speakAnswer.mock.calls[0][0]).toMatchObject({ modality: 'voice', text: 'Two replicas are Ready.' })
  })

  it('keeps a TYPED turn silent when a VOICE turn started during its suspended finalize', async () => {
    const pending = deferApply()
    act(() => api.send('why are the payments pods restarting?'))
    act(() => streamAnswer(0, 'Two replicas are Ready.'))

    act(() => api.send('and the ingress?', { modality: 'voice' }))
    await pending.settle()

    expect(speakAnswer).toHaveBeenCalledTimes(1)
    expect(speakAnswer.mock.calls[0][0]).toMatchObject({ modality: 'text' })
  })

  it('carries the modality of the ORIGINAL turn into a recovery re-issue', async () => {
    // A "tool not found" reply trampolines ONCE. The re-issued turn is the same question,
    // asked once, by voice — so its answer is the one that gets spoken, and the discarded
    // "↻ One moment…" text never is.
    harness.apply.mockResolvedValue(null)
    act(() => api.send('preview that blueprint', { modality: 'voice' }))
    act(() => {
      harness.sends[0].onFrame({ delta: "Tool 'previewBlueprint' not found", kind: 'text' })
      harness.sends[0].onFrame({ kind: 'done' })
    })
    expect(speakAnswer).not.toHaveBeenCalled()

    // The trampoline re-issues on a `setTimeout(…, 0)` (so finalize's streaming:false commits
    // first), which needs a real macrotask tick, not just a drained microtask queue.
    await act(flush)
    expect(harness.sends).toHaveLength(2)
    await act(async () => {
      harness.sends[1].onFrame({ delta: 'Here is the preview.', kind: 'text' })
      harness.sends[1].onFrame({ kind: 'done' })
      await flush()
    })

    expect(speakAnswer).toHaveBeenCalledTimes(1)
    expect(speakAnswer.mock.calls[0][0]).toMatchObject({ modality: 'voice', text: 'Here is the preview.' })
  })

  it('never speaks an approval continuation — no composer draft produced it', async () => {
    harness.apply.mockResolvedValue(null)
    act(() => api.send('scale payments to three', { modality: 'voice' }))
    act(() => harness.sends[0].onFrame({
      kind: 'require_approval',
      pause: { requests: [{ argumentsPreview: '{}', requestId: 'r1', toolName: 'k8s_apply_manifest' }], taskId: 't1' },
    }))
    act(() => api.approvePending())
    await act(async () => {
      harness.approvals[0].onFrame({ delta: 'Scaled to three replicas.', kind: 'text' })
      harness.approvals[0].onFrame({ kind: 'done' })
      await flush()
    })

    expect(speakAnswer).toHaveBeenCalledTimes(1)
    expect(speakAnswer.mock.calls[0][0]).toMatchObject({ modality: 'text', text: 'Scaled to three replicas.' })
  })
})

describe('a new turn stops a spoken answer (FR 75)', () => {
  it('cancels speech at SEND, not at the next answer — a suggestion chip has no keystroke', () => {
    // The composer's onChange cancel only fires for typed drafts; a suggestion chip, a
    // starter prompt and a purely-dictated draft all reach send() without one, and the next
    // speakAnswer's own cancel is a whole stream too late.
    cancel.mockClear()
    act(() => api.send('what changed in the last hour?'))
    expect(cancel).toHaveBeenCalled()
  })

  it('does NOT cancel on an empty send that never becomes a turn', () => {
    cancel.mockClear()
    act(() => api.send('   '))
    expect(cancel).not.toHaveBeenCalled()
  })
})
