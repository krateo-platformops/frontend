// @vitest-environment jsdom
/**
 * A stored thread's contextId belongs to the agent that assigned it.
 *
 * kagent looks a session up by `(contextId, user)` only and refuses a write to a session another
 * agent owns (403 "Session does not belong to this agent"). When the portal moves from `autopilot`
 * to `agentiko`, a thread opened against `autopilot` must therefore stop sending its contextId —
 * while keeping its transcript, which the storage-key migration went out of its way to preserve.
 *
 * Like storageKeys.test.ts, every stored record here is a LITERAL in the shape a real browser
 * holds, keyed by a literal string: a fixture written through the store under test would agree with
 * it by construction. The legacy records carry no `agent` field because no build before this one
 * wrote it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createConversationStore } from './conversationStore'
import type { PageContextEnvelope } from './types'

const CURRENT = 'krateo.agentiko.current.v1'
const OLD_CURRENT = 'krateo.autopilot.current.v1'

const userTurn = (text: string) => ({ createdAt: 1, id: `u-${text}`, role: 'user' as const, text })
const assistantTurn = (text: string) => ({ createdAt: 2, id: `a-${text}`, role: 'assistant' as const, text })

/** The live thread as every build before this one persisted it: no `agent` field. */
const legacyThread = {
  contextId: 'ctx-autopilot-42',
  messages: [userTurn('why is the composition not ready?'), assistantTurn('Because its provider is paused.')],
  sessionId: 's_live_01',
  title: 'why is the composition not ready?',
  updatedAt: 1762300000000,
}

const storedCurrent = (): Record<string, unknown> | null => {
  const raw = localStorage.getItem(CURRENT)
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
}

const ENVELOPE = { focus: 'Home', route: '/', widgets: [] } as unknown as PageContextEnvelope

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.resetModules()
})

describe('a thread stored with no agent field (every thread before this change)', () => {
  it('reads as autopilot: it keeps its contextId while the portal calls autopilot', () => {
    localStorage.setItem(CURRENT, JSON.stringify(legacyThread))
    const store = createConversationStore()

    expect(store.getSnapshot().agent).toBe('autopilot')
    store.bindToAgent('autopilot')

    expect(store.getSnapshot().contextId).toBe('ctx-autopilot-42')
  })

  it('starts fresh once the portal calls agentiko, and keeps the whole transcript', () => {
    localStorage.setItem(CURRENT, JSON.stringify(legacyThread))
    const store = createConversationStore()

    store.bindToAgent('agentiko')

    const snap = store.getSnapshot()
    expect(snap.contextId).toBeUndefined()
    expect(snap.agent).toBeUndefined()
    expect(snap.sessionId).toBe('s_live_01')
    expect(snap.messages.map((message) => message.text)).toEqual(['why is the composition not ready?', 'Because its provider is paused.'])
    // The stored history survives too — only the contextId is gone from the record.
    expect(storedCurrent()?.messages).toEqual(legacyThread.messages)
    expect(storedCurrent()?.contextId).toBeUndefined()
  })

  it('still carries its contextId after the autopilot→agentiko storage-key migration', async () => {
    // A browser coming from 1.8.28: the thread is under the OLD key. Importing the store runs the
    // migration (storageKeys.ts) and then the singleton's rehydration, in that order.
    localStorage.setItem(OLD_CURRENT, JSON.stringify(legacyThread))
    vi.resetModules()
    const { agentikoConversationStore } = await import('./conversationStore')

    agentikoConversationStore.bindToAgent('autopilot')

    expect(agentikoConversationStore.getSnapshot().contextId).toBe('ctx-autopilot-42')
    expect(agentikoConversationStore.getSnapshot().messages).toHaveLength(2)
  })
})

describe('a thread whose contextId another agent assigned', () => {
  it('drops the contextId AND the page-context delta base, keeps messages and session id', () => {
    const store = createConversationStore()
    store.setMessages([userTurn('first question')])
    store.setContextId('ctx-a', 'autopilot')
    store.setLastEnvelope(ENVELOPE)
    const { sessionId } = store.getSnapshot()

    store.bindToAgent('agentiko')

    expect(store.getSnapshot().contextId).toBeUndefined()
    // The delta base described what autopilot's session was told; the new session was told nothing,
    // so the next turn must carry the full envelope.
    expect(store.getLastEnvelope()).toBeUndefined()
    expect(store.getSnapshot().sessionId).toBe(sessionId)
    expect(store.getSnapshot().messages.map((message) => message.text)).toEqual(['first question'])
  })

  it('records the new contextId against the new agent, and a reload keeps that pairing', () => {
    const store = createConversationStore()
    store.setMessages([userTurn('first question')])
    store.setContextId('ctx-a', 'autopilot')

    store.bindToAgent('agentiko')
    store.setContextId('ctx-b', 'agentiko')

    expect(storedCurrent()).toMatchObject({ agent: 'agentiko', contextId: 'ctx-b' })
    const reloaded = createConversationStore()
    expect(reloaded.getSnapshot()).toMatchObject({ agent: 'agentiko', contextId: 'ctx-b' })
    reloaded.bindToAgent('agentiko')
    expect(reloaded.getSnapshot().contextId).toBe('ctx-b')
  })

  it('a stored agent that is not a string matches no agent', () => {
    localStorage.setItem(CURRENT, JSON.stringify({ ...legacyThread, agent: 7 }))
    const store = createConversationStore()

    store.bindToAgent('autopilot')

    expect(store.getSnapshot().contextId).toBeUndefined()
  })
})

describe('the same agent', () => {
  it('changes nothing: no write, same snapshot, delta base kept', () => {
    const store = createConversationStore()
    store.setMessages([userTurn('first question')])
    store.setContextId('ctx-a', 'agentiko')
    store.setLastEnvelope(ENVELOPE)
    const before = store.getSnapshot()
    const listener = vi.fn()
    store.subscribe(listener)

    store.bindToAgent('agentiko')

    expect(store.getSnapshot()).toBe(before)
    expect(store.getLastEnvelope()).toBe(ENVELOPE)
    expect(listener).not.toHaveBeenCalled()
  })

  it('a thread with no contextId yet is left alone whatever the agent', () => {
    const store = createConversationStore()
    store.setMessages([userTurn('first question')])
    const before = store.getSnapshot()

    store.bindToAgent('agentiko')

    expect(store.getSnapshot()).toBe(before)
  })
})
