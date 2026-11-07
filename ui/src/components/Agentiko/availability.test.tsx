// @vitest-environment jsdom
/**
 * Availability — whether Agentiko's controls are live — and the two ways it was wrong.
 *
 * 1. THE PROBE STARTED OPTIMISTIC. `probeOk` was seeded `true`, so every control was clickable for
 *    the whole first round-trip of every page load. That window is exactly first login, which is
 *    where the dead clicks were reported from (cmp.krateo.dev): the buttons were enabled and the
 *    turn answered "Agentiko is unavailable".
 * 2. THE PROBE IS A WEAKER WITNESS THAN THE TURN. It GETs the A2A base and counts anything but
 *    401/403/502-504 as reachable, so a gateway that answers a bare path while denying the real
 *    turn reads as available — and stays that way for every later click. A turn answered 401/403
 *    is the authoritative word on whether this user can drive this agent, because it IS the real
 *    request rather than a guess about one.
 *
 * Asserted through the real provider: `reachable` is what the rail consumes to disable its
 * controls, and a test against a mocked provider would assert the mock.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ConfigContextModule from '../../context/ConfigContext'

import type * as ActionBridgeModule from './actionBridge'
import { AgentikoProvider, useAgentiko } from './AgentikoProvider'
import { PROBE_TIMEOUT_MS } from './availability'
import { agentikoConversationStore } from './conversationStore'
import type * as PreviewSurfaceModule from './previewSurface'
import type * as PublishTargetFormModule from './publishTargetForm'
import type { AgentikoFrame } from './types'

const harness = vi.hoisted(() => ({
  // A real endpoint, NOT 'echo': echo is unconditionally reachable and would skip the probe.
  endpoint: 'https://agent.example/a2a',
  sends: [] as { onFrame: (frame: AgentikoFrame) => void }[],
}))

vi.mock('../../context/ConfigContext', async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigContextModule>()),
  useConfigContext: () => ({ config: { api: { AUTOPILOT_API_BASE_URL: harness.endpoint } } }),
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

/** Resolvers for the one in-flight reachability probe, so the pre-answer window is observable. */
let answerProbe: (response: { status: number }) => void
let failProbe: (error: Error) => void

/** Mount the provider with the probe deliberately left unanswered. */
const mount = () => {
  const pending = new Promise<{ status: number }>((resolve, reject) => {
    answerProbe = resolve
    failProbe = reject
  })
  vi.stubGlobal('fetch', vi.fn((url: unknown) => (
    String(url) === `${harness.endpoint}/`
      ? pending
      : Promise.resolve({ json: () => Promise.resolve({}), ok: true, status: 200 })
  )))
  render(<AgentikoProvider><Probe /></AgentikoProvider>)
}

/** Settle the probe and let the state update land. */
const settle = async (answer: { status: number } | Error) => {
  if (answer instanceof Error) {
    failProbe(answer)
  } else {
    answerProbe(answer)
  }
  // One tick for the probe's own .then/.catch, then act flushes the state update it made.
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  harness.sends.length = 0
  localStorage.clear()
  agentikoConversationStore.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('availability is not assumed before it is known', () => {
  it('is NOT reachable while the probe is still in flight — the first-login window', () => {
    mount()
    expect(api.enabled).toBe(true)
    expect(api.reachable).toBe(false)
  })

  it('becomes reachable once the probe answers', async () => {
    mount()
    await settle({ status: 200 })
    expect(api.reachable).toBe(true)
  })

  it('stays unreachable when the probe is denied', async () => {
    mount()
    await settle({ status: 403 })
    expect(api.reachable).toBe(false)
  })

  it('stays unreachable when the probe cannot be made at all', async () => {
    mount()
    await settle(new Error('network unreachable'))
    expect(api.reachable).toBe(false)
  })
})

describe('"not known yet" is not "unavailable"', () => {
  it('is checking until the probe answers, then not', async () => {
    mount()
    expect(api.checking).toBe(true)
    await settle({ status: 200 })
    expect(api.checking).toBe(false)
  })

  it('stops checking on a refusal, so the failure sentence shows', async () => {
    mount()
    await settle({ status: 403 })
    expect(api.checking).toBe(false)
    expect(api.reachable).toBe(false)
  })

  it('stops checking when a probe never answers', () => {
    vi.useFakeTimers()
    try {
      mount()
      expect(api.checking).toBe(true)
      act(() => { vi.advanceTimersByTime(PROBE_TIMEOUT_MS) })
      expect(api.checking).toBe(false)
      expect(api.reachable).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a turn outranks the probe that said yes', () => {
  /** Reach the state the bug report came from: the probe passed, so every control is live. */
  const reachableThenTurn = async (frame: AgentikoFrame) => {
    mount()
    await settle({ status: 200 })
    expect(api.reachable).toBe(true)
    act(() => { api.send('publish the chart') })
    act(() => { harness.sends[0].onFrame(frame) })
  }

  it.each([401, 403])('a turn answered %i disables the controls the probe had enabled', async (status) => {
    await reachableThenTurn({ kind: 'error', message: 'denied', status })
    expect(api.reachable).toBe(false)
  })

  it('leaves availability alone for a 5xx — that is the agent faulting, not refusing this user', async () => {
    await reachableThenTurn({ kind: 'error', message: 'Agentiko request failed (500)', status: 500 })
    expect(api.reachable).toBe(true)
  })

  it('leaves availability alone for an in-band turn error, which carries no status at all', async () => {
    await reachableThenTurn({ kind: 'error', message: 'Tool \'read_repo_file\' failed: repository not found (404)' })
    expect(api.reachable).toBe(true)
  })
})
