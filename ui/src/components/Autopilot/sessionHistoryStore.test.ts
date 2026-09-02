// @vitest-environment jsdom
/**
 * Session-history persistence (item P) — the localStorage-backed archive layer.
 * Pins:
 *   - title derivation (first user message, truncated) + isThreadWorthKeeping;
 *   - relativeTime buckets;
 *   - current-thread persist → load round-trip; empty thread clears the slot;
 *   - archive push (newest-first, de-dup by sessionId) + prune at BOTH bounds (count + bytes);
 *   - corrupt / non-array / non-thread entries are discarded, never trusted;
 *   - a THROWING localStorage (quota / disabled) degrades gracefully (no throw).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ARCHIVE_KEY,
  archiveThread,
  CURRENT_KEY,
  deriveThreadTitle,
  isThreadWorthKeeping,
  loadArchive,
  loadCurrentThread,
  MAX_ARCHIVED_THREADS,
  relativeTime,
  saveCurrentThread,
  summarize,
  type PersistedThread,
} from './sessionHistoryStore'
import type { AutopilotMessage } from './types'

const userMsg = (text: string): AutopilotMessage => ({ createdAt: 1, id: `u-${text}`, role: 'user', text })
const botMsg = (text: string): AutopilotMessage => ({ createdAt: 2, id: `a-${text}`, role: 'assistant', text })

const thread = (sessionId: string, updatedAt: number, title = 'T', messages: AutopilotMessage[] = [userMsg('hi')]): PersistedThread =>
  ({ contextId: undefined, messages, sessionId, title, updatedAt })

beforeEach(() => {
  localStorage.clear()
})

describe('deriveThreadTitle', () => {
  it('uses the first USER message, collapsing whitespace', () => {
    expect(deriveThreadTitle([botMsg('greeting'), userMsg('  what   is\nthis? ')])).toBe('what is this?')
  })

  it('truncates a long title with an ellipsis', () => {
    const long = 'a'.repeat(120)
    const title = deriveThreadTitle([userMsg(long)])
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(60)
  })

  it('falls back for an assistant-only / empty transcript', () => {
    expect(deriveThreadTitle([botMsg('hello')])).toBe('Conversation')
    expect(deriveThreadTitle([])).toBe('Conversation')
  })
})

describe('isThreadWorthKeeping', () => {
  it('is true only with at least one user turn', () => {
    expect(isThreadWorthKeeping([userMsg('x')])).toBe(true)
    expect(isThreadWorthKeeping([botMsg('greeting')])).toBe(false)
    expect(isThreadWorthKeeping([])).toBe(false)
  })
})

describe('relativeTime', () => {
  const base = 1_000_000_000_000
  it('buckets seconds / minutes / hours / days', () => {
    expect(relativeTime(base, base + 10_000)).toBe('just now')
    expect(relativeTime(base, base + 5 * 60_000)).toBe('5m ago')
    expect(relativeTime(base, base + 3 * 3_600_000)).toBe('3h ago')
    expect(relativeTime(base, base + 2 * 86_400_000)).toBe('2d ago')
  })
  it('falls back to a date past a week', () => {
    expect(relativeTime(base, base + 30 * 86_400_000)).toBe(new Date(base).toLocaleDateString())
  })
})

describe('current-thread persistence', () => {
  it('round-trips a non-empty thread', () => {
    const persisted = thread('s1', 100, 'first', [userMsg('hello there')])
    saveCurrentThread(persisted)
    expect(loadCurrentThread()).toEqual(persisted)
  })

  it('CLEARS the slot for an empty / greeting-only thread (nothing to restore)', () => {
    saveCurrentThread(thread('s1', 100, 'x', [userMsg('hi')]))
    saveCurrentThread(thread('s1', 100, 'x', [botMsg('greeting')]))
    expect(loadCurrentThread()).toBeNull()
    saveCurrentThread(null)
    expect(loadCurrentThread()).toBeNull()
  })
})

describe('archiveThread — push, order, de-dup', () => {
  it('pushes newest-first', () => {
    archiveThread(thread('s1', 100))
    archiveThread(thread('s2', 200))
    expect(loadArchive().map((entry) => entry.sessionId)).toEqual(['s2', 's1'])
  })

  it('de-dups by sessionId (re-archiving replaces the prior entry)', () => {
    archiveThread(thread('s1', 100, 'old'))
    archiveThread(thread('s1', 300, 'new'))
    const archive = loadArchive()
    expect(archive).toHaveLength(1)
    expect(archive[0].title).toBe('new')
  })
})

describe('bounds — count + bytes', () => {
  it(`prunes the oldest past ${MAX_ARCHIVED_THREADS} threads`, () => {
    for (let i = 0; i < MAX_ARCHIVED_THREADS + 5; i++) {
      archiveThread(thread(`s${i}`, i))
    }
    const archive = loadArchive()
    expect(archive).toHaveLength(MAX_ARCHIVED_THREADS)
    // The newest survive; the oldest (s0..s4) were pruned.
    expect(archive[0].sessionId).toBe(`s${MAX_ARCHIVED_THREADS + 4}`)
    expect(archive.some((entry) => entry.sessionId === 's0')).toBe(false)
  })

  it('prunes the oldest until the archive fits the byte budget', () => {
    // Each thread carries a large transcript; the byte cap forces pruning well before the count cap.
    const heavy = (id: string, at: number): PersistedThread =>
      thread(id, at, 'big', [userMsg('x'.repeat(200_000))])
    archiveThread(heavy('a', 1))
    archiveThread(heavy('b', 2))
    archiveThread(heavy('c', 3))
    const archive = loadArchive()
    // Newest kept; the byte budget dropped the older heavy threads.
    expect(archive.length).toBeLessThan(3)
    expect(archive[0].sessionId).toBe('c')
  })
})

describe('sanitization — corrupt storage is discarded, not trusted', () => {
  it('ignores non-JSON, a non-array archive, and non-thread entries', () => {
    localStorage.setItem(ARCHIVE_KEY, '{ not json')
    expect(loadArchive()).toEqual([])
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify({ notAnArray: true }))
    expect(loadArchive()).toEqual([])
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify([{ messages: 'nope', sessionId: 5 }, thread('ok', 1)]))
    expect(loadArchive().map((entry) => entry.sessionId)).toEqual(['ok'])
  })

  it('ignores a corrupt current-thread slot', () => {
    localStorage.setItem(CURRENT_KEY, '{ broken')
    expect(loadCurrentThread()).toBeNull()
    localStorage.setItem(CURRENT_KEY, JSON.stringify({ sessionId: 1 }))
    expect(loadCurrentThread()).toBeNull()
  })
})

describe('graceful degradation — a throwing localStorage never crashes', () => {
  afterEach(() => vi.restoreAllMocks())

  it('swallows a quota error on write (archive still readable-empty)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(() => archiveThread(thread('s1', 1))).not.toThrow()
    expect(() => saveCurrentThread(thread('s1', 1))).not.toThrow()
  })

  it('swallows a throwing getItem on read (degrades to empty)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })
    expect(loadArchive()).toEqual([])
    expect(loadCurrentThread()).toBeNull()
  })
})

describe('summarize — transcript stripped', () => {
  it('projects title / updatedAt / messageCount only', () => {
    const summaries = summarize([thread('s1', 100, 'hi', [userMsg('a'), botMsg('b')])])
    expect(summaries).toEqual([{ messageCount: 2, sessionId: 's1', title: 'hi', updatedAt: 100 }])
  })
})
