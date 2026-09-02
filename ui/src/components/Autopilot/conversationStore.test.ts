// @vitest-environment jsdom
/**
 * Conversation store — the localStorage-backed durable transcript (Vincenzo item P).
 * Pins the session-history behaviors layered onto the remount-survival store:
 *   - a write PERSISTS the current thread; a FRESH store REHYDRATES it (page-reload sim);
 *   - archiveAndReset ARCHIVES the prior (non-empty) thread, then starts fresh;
 *   - reset DISCARDS without archiving; an empty thread is never archived;
 *   - loadThread SWITCHES to an archived transcript (marked `restored`), archiving the
 *     current thread first so switching never loses it;
 *   - `restored` clears once a live turn assigns a contextId;
 *   - a throwing localStorage degrades to in-memory (no crash, feature just stops persisting).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createConversationStore } from './conversationStore'
import type { AutopilotMessage } from './types'

const userMsg = (text: string): AutopilotMessage => ({ createdAt: 1, id: `u-${text}`, role: 'user', text })

beforeEach(() => {
  localStorage.clear()
})

describe('persist → rehydrate (page reload)', () => {
  it('a fresh store rehydrates the last persisted current thread', () => {
    const first = createConversationStore()
    first.setMessages([userMsg('remember me')])
    first.setContextId('ctx-1')
    const sid = first.getSnapshot().sessionId

    // Simulate a page reload: a brand-new store instance reads localStorage on construction.
    const reloaded = createConversationStore()
    const snap = reloaded.getSnapshot()
    expect(snap.messages).toEqual([userMsg('remember me')])
    expect(snap.sessionId).toBe(sid)
    expect(snap.contextId).toBe('ctx-1')
    expect(snap.restored).toBe(false)
  })

  it('an empty (greeting-only) thread is not persisted — a reload starts fresh', () => {
    const first = createConversationStore()
    first.setMessages([{ createdAt: 1, id: 'a1', role: 'assistant', text: 'hi there' }])
    const reloaded = createConversationStore()
    expect(reloaded.getSnapshot().messages).toEqual([])
  })
})

describe('archiveAndReset — new thread keeps the old one', () => {
  it('archives the prior non-empty thread, then starts a fresh empty thread', () => {
    const store = createConversationStore()
    store.setMessages([userMsg('first thread')])
    const firstSid = store.getSnapshot().sessionId

    store.archiveAndReset()
    const snap = store.getSnapshot()
    expect(snap.messages).toEqual([])
    expect(snap.sessionId).not.toBe(firstSid)
    expect(snap.contextId).toBeUndefined()

    // The prior thread is now browsable.
    const sessions = store.sessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe(firstSid)
    expect(sessions[0].title).toBe('first thread')
  })

  it('does NOT archive an empty thread', () => {
    const store = createConversationStore()
    store.archiveAndReset()
    expect(store.sessions()).toHaveLength(0)
  })
})

describe('reset — discards without archiving', () => {
  it('clears the thread and never touches the archive', () => {
    const store = createConversationStore()
    store.setMessages([userMsg('discard me')])
    store.reset()
    expect(store.getSnapshot().messages).toEqual([])
    expect(store.sessions()).toHaveLength(0)
  })
})

describe('loadThread — switch to an archived transcript', () => {
  it('loads the selected thread as current (restored), archiving the current one first', () => {
    const store = createConversationStore()
    store.setMessages([userMsg('thread A')])
    const sidA = store.getSnapshot().sessionId
    store.archiveAndReset()

    store.setMessages([userMsg('thread B')])
    const sidB = store.getSnapshot().sessionId

    const ok = store.loadThread(sidA)
    expect(ok).toBe(true)
    const snap = store.getSnapshot()
    expect(snap.sessionId).toBe(sidA)
    expect(snap.messages).toEqual([userMsg('thread A')])
    expect(snap.restored).toBe(true)
    expect(snap.contextId).toBeUndefined()

    // Thread B was archived on the way out, so switching never lost it.
    expect(store.sessions().some((entry) => entry.sessionId === sidB)).toBe(true)
  })

  it('returns false for an unknown sessionId (no state change)', () => {
    const store = createConversationStore()
    store.setMessages([userMsg('current')])
    const before = store.getSnapshot()
    expect(store.loadThread('does-not-exist')).toBe(false)
    expect(store.getSnapshot()).toBe(before)
  })

  it('clears the `restored` hint once a live turn assigns a contextId', () => {
    const store = createConversationStore()
    store.setMessages([userMsg('A')])
    const sidA = store.getSnapshot().sessionId
    store.archiveAndReset()
    store.loadThread(sidA)
    expect(store.getSnapshot().restored).toBe(true)
    store.setContextId('new-ctx')
    expect(store.getSnapshot().restored).toBe(false)
  })
})

describe('viewing a past thread does not bump its recency', () => {
  afterEach(() => vi.restoreAllMocks())

  it('leaves updatedAt and archive order untouched by a switch-in/switch-out with no new messages', () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const store = createConversationStore()

    store.setMessages([userMsg('thread A')])
    store.archiveAndReset()

    now = 2_000
    store.setMessages([userMsg('thread B')])
    const sidB = store.getSnapshot().sessionId
    store.archiveAndReset()

    const before = store.sessions()
    const beforeOrder = before.map((entry) => entry.sessionId)
    const beforeUpdatedAt = before.find((entry) => entry.sessionId === sidB)?.updatedAt

    // Merely open thread B to read it, much later, then leave without sending anything.
    now = 9_000
    store.loadThread(sidB)
    store.archiveAndReset()

    const after = store.sessions()
    expect(after.map((entry) => entry.sessionId)).toEqual(beforeOrder)
    expect(after.find((entry) => entry.sessionId === sidB)?.updatedAt).toBe(beforeUpdatedAt)
  })
})

describe('subscribe — emits on writes', () => {
  it('notifies subscribers on a message write', () => {
    const store = createConversationStore()
    const listener = vi.fn()
    const unsub = store.subscribe(listener)
    store.setMessages([userMsg('x')])
    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
    store.setMessages([userMsg('y')])
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('graceful degradation — throwing localStorage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('still works in-memory when persistence throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    const store = createConversationStore()
    expect(() => store.setMessages([userMsg('no-persist')])).not.toThrow()
    expect(() => store.archiveAndReset()).not.toThrow()
    // In-memory state is intact even though nothing was persisted.
    expect(store.getSnapshot().messages).toEqual([])
  })
})
