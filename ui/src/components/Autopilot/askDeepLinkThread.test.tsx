// @vitest-environment jsdom
/**
 * The `?ask=` deep-link starts a FRESH thread — the provider half, against the real
 * AutopilotProvider (askDeepLink.test.tsx tests the hook in isolation with a mock callback, so it
 * cannot see any of this).
 *
 * Why it matters, from a real run on krateo-057: clicking "Diagnose" on a broken composition seeds
 * a self-contained prompt ("Diagnose composition X: is it healthy?"). It landed under whatever
 * conversation happened to be open — a stale page-publish thread whose half-finished "0/7
 * committed, 7 pending" output sat directly above the diagnosis and read as the diagnosis having
 * failed. The previous transcript is also sent along as context, inviting the orchestrator to
 * reason about the earlier task.
 *
 * The property is narrow and easy to regress: the seeded turn must be the FIRST turn of its
 * thread, and the outgoing thread must be archived rather than dropped.
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
  /** The provider's own onAsk, captured so the test can fire the deep-link itself. */
  onAsk: null as null | ((ask: string) => void),
  sends: [] as { onFrame: (frame: AutopilotFrame) => void }[],
}))

vi.mock('../../context/ConfigContext', async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigContextModule>()),
  useConfigContext: () => ({ config: { api: { AUTOPILOT_API_BASE_URL: 'echo' } } }),
}))
// Capture the provider's callback instead of driving a router: the hook's own URL handling is
// askDeepLink.test.tsx's subject, and what is under test here is what the provider DOES with it.
vi.mock('./askDeepLink', () => ({
  useAskDeepLink: (_enabled: boolean, onAsk: (ask: string) => void) => { harness.onAsk = onAsk },
}))
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

const answer = (turn: number, text: string) => {
  const { onFrame } = harness.sends[turn]
  onFrame({ delta: text, kind: 'text' })
  onFrame({ kind: 'done' })
}

const DIAGNOSE = 'Diagnose composition "sample-mongodb" in namespace "krateo-system": is it healthy?'

beforeEach(() => {
  harness.sends.length = 0
  harness.onAsk = null
  harness.apply.mockReset()
  // The thread ARCHIVE is durable (localStorage), so `reset()` alone leaves the previous test's
  // archived threads visible to `sessions()` — which would make the empty-thread assertion below
  // read someone else's history as its own.
  localStorage.clear()
  autopilotConversationStore.reset()
  render(<AutopilotProvider><Probe /></AutopilotProvider>)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the ?ask= deep-link starts its own thread', () => {
  it('seeds the prompt as the FIRST turn, not appended to the open conversation', () => {
    // An ordinary conversation is already under way.
    act(() => { api.send('publish the service-directory page') })
    act(() => { answer(0, 'Publishing to krateo-demo-pages — 0/7 committed, 7 pending.') })
    expect(api.messages.length).toBeGreaterThan(0)
    const beforeSession = api.sessionId

    // The Diagnose button fires.
    act(() => { harness.onAsk?.(DIAGNOSE) })

    // A new session, and the transcript starts at the seeded prompt — the stale publish output
    // is not sitting above the diagnosis.
    expect(api.sessionId).not.toBe(beforeSession)
    expect(api.messages.filter((message) => message.role === 'user').map((message) => message.text))
      .toEqual([DIAGNOSE])
    expect(api.messages.some((message) => message.text.includes('7 pending'))).toBe(false)
  })

  it('ARCHIVES the outgoing conversation rather than dropping it', () => {
    act(() => { api.send('publish the service-directory page') })
    act(() => { answer(0, 'done') })

    act(() => { harness.onAsk?.(DIAGNOSE) })

    // The previous thread is still browsable in the rail's history — a deep-link must not cost
    // the user the conversation they were having.
    expect(api.sessions()).toHaveLength(1)
    expect(api.sessions()[0].title).toContain('service-directory')
  })

  it('opens the rail and actually sends the turn', () => {
    act(() => { harness.onAsk?.(DIAGNOSE) })
    expect(api.open).toBe(true)
    expect(harness.sends.length).toBe(1)
  })

  it('does not archive an empty thread — clicking Diagnose first thing creates no history', () => {
    act(() => { harness.onAsk?.(DIAGNOSE) })
    expect(api.sessions()).toHaveLength(0)
  })
})
