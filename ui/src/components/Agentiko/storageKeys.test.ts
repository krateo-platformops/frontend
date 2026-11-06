// @vitest-environment jsdom
/**
 * THE autopilot → agentiko STORAGE-KEY MIGRATION.
 *
 * What this file exists to catch is a test that cannot fail. The five keys were renamed
 * along with every other identifier in this directory; `tsc` stayed clean and the existing
 * suites stayed green, because they assert through the same constants they renamed — and
 * every user would have lost their conversation history permanently on the first load of
 * the new build. So:
 *
 *   EVERY OLD KEY IN THIS FILE IS A HARDCODED STRING LITERAL. Not `LEGACY_KEYS`, not a
 *   constant imported from anywhere. A fixture seeded through the code under test agrees
 *   with that code by construction and proves nothing about what is in a real browser.
 *
 * Nothing is imported at the top of this file either. `storageKeys.ts` runs the migration
 * AT MODULE EVALUATION (that is the ordering guarantee — see its header), so the migration
 * under test is the module's own import side effect: each test seeds localStorage first,
 * resets the module registry, and only then imports.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── the five pre-rename keys, as a 1.8.28 browser spells them ─────────────────
const OLD_CURRENT = 'krateo.autopilot.current.v1'
const OLD_ARCHIVE = 'krateo.autopilot.archive.v1'
const OLD_SPEAKBACK = 'krateo.autopilot.speakback.v1'
const OLD_SPEAKBACK_NOTICE = 'krateo.autopilot.speakback.notice.v1'
const OLD_RAIL_WIDTH = 'krateo-autopilot-rail-width'
const OLD_KEYS = [OLD_CURRENT, OLD_ARCHIVE, OLD_SPEAKBACK, OLD_SPEAKBACK_NOTICE, OLD_RAIL_WIDTH]

// ── and the five they must end up under, also literal ─────────────────────────
const NEW_CURRENT = 'krateo.agentiko.current.v1'
const NEW_ARCHIVE = 'krateo.agentiko.archive.v1'
const NEW_SPEAKBACK = 'krateo.agentiko.speakback.v1'
const NEW_SPEAKBACK_NOTICE = 'krateo.agentiko.speakback.notice.v1'
const NEW_RAIL_WIDTH = 'krateo.agentiko.rail-width'

const userTurn = (text: string) => ({ createdAt: 1, id: `u-${text}`, role: 'user', text })

/** A live thread as the old build persisted it. */
const liveThread = {
  contextId: 'ctx-42',
  messages: [userTurn('why is the composition not ready?'), { createdAt: 2, id: 'a-1', role: 'assistant', text: 'Because its provider is paused.' }],
  sessionId: 's_live_01',
  title: 'why is the composition not ready?',
  updatedAt: 1762300000000,
}

/** Two archived threads, newest first, as the old build persisted them. */
const archivedThreads = [
  { contextId: undefined, messages: [userTurn('list my drafts')], sessionId: 's_old_02', title: 'list my drafts', updatedAt: 1762200000000 },
  { contextId: undefined, messages: [userTurn('what broke last night?')], sessionId: 's_old_01', title: 'what broke last night?', updatedAt: 1762100000000 },
]

/** Seed localStorage exactly as a browser coming from 1.8.28 holds it. */
const seedLegacy = (): void => {
  localStorage.setItem(OLD_CURRENT, JSON.stringify(liveThread))
  localStorage.setItem(OLD_ARCHIVE, JSON.stringify(archivedThreads))
  localStorage.setItem(OLD_SPEAKBACK, 'off')
  localStorage.setItem(OLD_SPEAKBACK_NOTICE, 'on')
  localStorage.setItem(OLD_RAIL_WIDTH, '612')
}

/** Import `storageKeys` fresh, so its module-level migration call is what runs. The return
 *  type is inferred on purpose: nothing in this file may import the module for its value, or
 *  the migration would run before a test has seeded anything. */
const importStorageKeys = async () => {
  vi.resetModules()
  return import('./storageKeys')
}

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('the one-time autopilot → agentiko migration', () => {
  it('carries all five values onto the new keys and removes the old ones', async () => {
    seedLegacy()

    await importStorageKeys()

    expect(localStorage.getItem(NEW_CURRENT)).toBe(JSON.stringify(liveThread))
    expect(localStorage.getItem(NEW_ARCHIVE)).toBe(JSON.stringify(archivedThreads))
    expect(localStorage.getItem(NEW_SPEAKBACK)).toBe('off')
    expect(localStorage.getItem(NEW_SPEAKBACK_NOTICE)).toBe('on')
    // The hyphenated odd one out is normalised onto the dotted spelling.
    expect(localStorage.getItem(NEW_RAIL_WIDTH)).toBe('612')

    for (const old of OLD_KEYS) {
      expect(localStorage.getItem(old), `${old} must not survive the migration`).toBeNull()
    }
  })

  it('keeps the thread list intact — not just the bytes', async () => {
    seedLegacy()

    const { ARCHIVE_KEY, CURRENT_KEY } = await importStorageKeys()
    const { loadArchive, loadCurrentThread } = await import('./sessionHistoryStore')

    // The keys the store reads are the new ones...
    expect(CURRENT_KEY).toBe(NEW_CURRENT)
    expect(ARCHIVE_KEY).toBe(NEW_ARCHIVE)

    // ...and the data behind them is the user's, thread for thread.
    const current = loadCurrentThread()
    expect(current?.sessionId).toBe('s_live_01')
    expect(current?.contextId).toBe('ctx-42')
    expect(current?.messages.map((message) => message.text)).toEqual(['why is the composition not ready?', 'Because its provider is paused.'])

    expect(loadArchive().map((thread) => thread.sessionId)).toEqual(['s_old_02', 's_old_01'])
    expect(loadArchive().map((thread) => thread.title)).toEqual(['list my drafts', 'what broke last night?'])
  })

  it('does NOT overwrite a value already under a new key, and leaves the old one alone', async () => {
    localStorage.setItem(OLD_SPEAKBACK, 'off')
    localStorage.setItem(NEW_SPEAKBACK, 'on')
    localStorage.setItem(OLD_RAIL_WIDTH, '320')
    localStorage.setItem(NEW_RAIL_WIDTH, '700')
    // A key with an EMPTY new slot, so this test cannot pass by the migration simply
    // not running.
    localStorage.setItem(OLD_CURRENT, JSON.stringify(liveThread))

    await importStorageKeys()

    expect(localStorage.getItem(NEW_SPEAKBACK)).toBe('on')
    expect(localStorage.getItem(NEW_RAIL_WIDTH)).toBe('700')
    // Deliberate: with both present we cannot tell which the user wants, so the newer key
    // wins and the legacy one is not destroyed either.
    expect(localStorage.getItem(OLD_SPEAKBACK)).toBe('off')
    expect(localStorage.getItem(OLD_RAIL_WIDTH)).toBe('320')
    // ...and the key that had nowhere to collide did move, so the migration ran.
    expect(localStorage.getItem(NEW_CURRENT)).toBe(JSON.stringify(liveThread))
    expect(localStorage.getItem(OLD_CURRENT)).toBeNull()
  })

  it('is idempotent — a second and third run change nothing', async () => {
    seedLegacy()

    const { migrateLegacyStorageKeys } = await importStorageKeys()
    const afterFirst = JSON.stringify({ ...localStorage })

    migrateLegacyStorageKeys()
    migrateLegacyStorageKeys()

    expect(JSON.stringify({ ...localStorage })).toBe(afterFirst)
  })

  it('does nothing, and does not throw, on a browser with no legacy data', async () => {
    const { migrateLegacyStorageKeys } = await importStorageKeys()

    expect(localStorage.length).toBe(0)
    expect(() => migrateLegacyStorageKeys()).not.toThrow()
    expect(localStorage.length).toBe(0)
  })

  it('survives storage being unavailable — reading localStorage can itself throw', async () => {
    const { migrateLegacyStorageKeys } = await importStorageKeys()

    // SecurityError in a blocked context (private mode, a third-party frame with storage off).
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('SecurityError') } })
    try {
      expect(() => migrateLegacyStorageKeys()).not.toThrow()
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'localStorage', descriptor)
      } else {
        Reflect.deleteProperty(globalThis, 'localStorage')
      }
    }
    expect(() => localStorage.getItem(NEW_CURRENT)).not.toThrow()
  })

  it('a key that refuses to be written stays legacy — write before delete, and the rest still move', async () => {
    // Import on EMPTY storage first (so the module's own call is a no-op), then seed, so the
    // run under the failing `setItem` is the one that has work to do.
    const { migrateLegacyStorageKeys } = await importStorageKeys()
    seedLegacy()

    // Bound BEFORE the spy replaces it, or the mock's fall-through would call itself.
    const realSetItem = Storage.prototype.setItem.bind(localStorage)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string): void => {
      if (key === NEW_CURRENT) {
        throw new Error('QuotaExceededError')
      }
      realSetItem(key, value)
    })
    try {
      expect(() => migrateLegacyStorageKeys()).not.toThrow()
    } finally {
      setItem.mockRestore()
    }

    // The thread that could not be copied is STILL under its old key, so the next page load
    // retries it. Deleting before writing would have destroyed the only copy.
    expect(localStorage.getItem(OLD_CURRENT)).toBe(JSON.stringify(liveThread))
    expect(localStorage.getItem(NEW_CURRENT)).toBeNull()
    // One poisoned key does not stop the other four.
    expect(localStorage.getItem(NEW_SPEAKBACK)).toBe('off')
    expect(localStorage.getItem(OLD_SPEAKBACK)).toBeNull()
    expect(localStorage.getItem(NEW_RAIL_WIDTH)).toBe('612')
  })
})

describe('the migration runs before any store can read storage (the ordering)', () => {
  it('the REAL conversation store, imported cold, comes up on the legacy thread', async () => {
    seedLegacy()

    // No `storageKeys` import first, and no migration called by hand: this is the product's
    // own import graph. `createConversationStore()` runs at module evaluation and reads
    // CURRENT_KEY there, so if the migration were a convention rather than a data
    // dependency, this store would come up empty with a fresh session id.
    vi.resetModules()
    const { agentikoConversationStore } = await import('./conversationStore')

    const snapshot = agentikoConversationStore.getSnapshot()
    expect(snapshot.sessionId).toBe('s_live_01')
    expect(snapshot.contextId).toBe('ctx-42')
    expect(snapshot.messages.map((message) => message.text)).toEqual(['why is the composition not ready?', 'Because its provider is paused.'])

    // The history panel's list is the user's two archived threads, not an empty list.
    expect(agentikoConversationStore.sessions().map((session) => session.title)).toEqual(['list my drafts', 'what broke last night?'])
  })

  it('the REAL speak-back store, imported cold, comes up on the legacy preference', async () => {
    localStorage.setItem(OLD_SPEAKBACK, 'off')

    // `createSpeakBackStore()` reads the preference key at module evaluation too.
    vi.resetModules()
    const { agentikoSpeakBackStore } = await import('./voice/speak/speakBackStore')

    expect(agentikoSpeakBackStore.getSnapshot().enabled).toBe(false)
    expect(localStorage.getItem(OLD_SPEAKBACK)).toBeNull()
  })

  it('the REAL rail width, read cold, is the width the user dragged', async () => {
    localStorage.setItem(OLD_RAIL_WIDTH, '612')

    vi.resetModules()
    const { getStoredRailWidth } = await import('./railWidth')

    expect(getStoredRailWidth()).toBe(612)
  })
})
