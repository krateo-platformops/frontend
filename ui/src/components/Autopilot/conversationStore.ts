/**
 * Autopilot CONVERSATION STORE — a module-level (singleton) store for the durable
 * transcript + thread identity, decoupled from React component lifetime.
 *
 * WHY THIS EXISTS (the bug it fixes): the transcript used to live in
 * `AutopilotProvider`'s `useState`. The provider is mounted INSIDE the router
 * subtree (`Shell` → `AutopilotProvider`), which hangs under
 * `<RouterProvider key={routerVersion}>` (App.tsx). Any `routerVersion` bump — the
 * routes-as-data dynamic reload — remounts that whole subtree and resets every
 * `useState` to its initial value, silently WIPING the conversation (reopening the
 * rail showed the empty "Ask Autopilot" state). The page-context header survived
 * because it is re-derived from `window.location` on demand, not held in state — so
 * the rail looked "still alive" while the messages were gone.
 *
 * THE FIX: keep the durable conversation OUT of the remount-fragile subtree. This
 * singleton holds `messages` + the thread identity (`sessionId`, `contextId`); the
 * provider reads it via `useSyncExternalStore` and writes through the setters. On a
 * remount the provider re-subscribes to the SURVIVING store instead of starting from
 * an empty `[]`, so the conversation persists across a routerVersion bump — WITHOUT
 * touching the `key={routerVersion}` reload the routes-as-data flow depends on.
 *
 * SESSION HISTORY (Vincenzo item P): the singleton survives a REMOUNT but a true page
 * RELOAD wipes module state, and `newThread()` used to DISCARD the current thread. This
 * store is now backed by localStorage (sessionHistoryStore.ts): every write persists the
 * CURRENT thread (rehydrated on load), and `archiveAndReset()` pushes the current thread
 * onto a bounded archive list BEFORE resetting — so refresh keeps the conversation and a
 * new thread no longer throws the old ones away. `loadThread()` switches the live view to
 * an archived transcript. All persistence is best-effort (try/catch inside the history
 * store): a quota error or disabled storage degrades to the previous in-memory behavior.
 *
 * SCOPE (deliberately minimal): only THREAD-LIFETIME state lives here — the transcript,
 * the thread identity, and the page-context delta base (`lastEnvelope`, which must stay
 * consistent with `contextId` for the same reason; see its doc below). In-flight,
 * per-mount streaming machinery (abort handle, per-turn text/proposal buffers, approval
 * governors) stays as component refs — an in-flight stream is torn down on unmount anyway
 * (the provider's cleanup aborts it), so it must NOT be resurrected from a shared store.
 *
 * No React imports here (pure store); the provider adapts it via useSyncExternalStore.
 */

import { randomId } from '../../utils/utils'

import {
  archiveThread,
  deriveThreadTitle,
  isThreadWorthKeeping,
  loadArchive,
  loadCurrentThread,
  saveCurrentThread,
  summarize,
  type PersistedThread,
  type ThreadSummary,
} from './sessionHistoryStore'
import type { AutopilotMessage, PageContextEnvelope } from './types'

/** A fresh frontend-owned session id (mirrors the provider's previous `newSessionId`). */
const newSessionId = (): string => `s_${randomId()}`

/** The durable slice of Autopilot state that must survive a provider remount. */
export interface ConversationState {
  /** The conversation transcript for the current thread. */
  messages: AutopilotMessage[]
  /** Frontend-owned session id (re-issued on newThread). */
  sessionId: string
  /** A2A conversation id assigned by the server on the first turn (thread continuity). */
  contextId: string | undefined
  /**
   * True when the CURRENT thread was RESTORED from the archive (the user switched to a
   * past session) — v1 loads its transcript for VIEWING. Live-resume of the exact server
   * A2A session is phase-2: continuing a restored thread starts a fresh `contextId` on the
   * next send (see loadThread + the rail's "viewing a past session" hint). Cleared once
   * the user sends a new turn (setContextId) or starts/loads another thread.
   */
  restored: boolean
}

export interface ConversationStore {
  /** Current immutable snapshot (stable reference until a write) — for useSyncExternalStore. */
  getSnapshot: () => ConversationState
  /** Subscribe to changes; returns an unsubscribe. */
  subscribe: (listener: () => void) => () => void
  /** Replace the transcript (value or updater), mirroring React's setState contract. */
  setMessages: (update: AutopilotMessage[] | ((prev: AutopilotMessage[]) => AutopilotMessage[])) => void
  /** Set the server-assigned A2A contextId (or clear it). */
  setContextId: (contextId: string | undefined) => void
  /**
   * The page context sent on the PREVIOUS turn, against which the next turn's delta is
   * computed (buildContextDelta: same route + widgets + pageStatus ⇒ a ~22-token
   * "Unchanged:" note instead of the full 380–3,900-token envelope).
   *
   * It lives HERE, not in a provider ref, because it must stay consistent with the
   * `contextId` above: a routerVersion bump remounts AutopilotProvider (see the header
   * comment), which resets any component ref to undefined while the surviving contextId keeps
   * the thread open — so a ref would make the next mid-thread turn re-send the FULL envelope as
   * if it were turn 1. Same lifetime as the thread it describes; cleared by reset().
   *
   * Deliberately NOT part of ConversationState: it is write-only from the provider's
   * perspective (read once per send, never rendered), so it must not notify subscribers.
   */
  getLastEnvelope: () => PageContextEnvelope | undefined
  setLastEnvelope: (envelope: PageContextEnvelope | undefined) => void
  /**
   * Start a brand-new thread. If the current thread has at least one user turn it is first
   * ARCHIVED (bounded localStorage list) so it stays browsable — otherwise reset() discards
   * an empty thread. Then: empty transcript, fresh session id, no contextId, no delta base.
   */
  archiveAndReset: () => void
  /** Reset to a brand-new thread WITHOUT archiving (empty/greeting thread). */
  reset: () => void
  /**
   * Switch the live view to a previously-archived thread (by sessionId): its transcript
   * loads as the current thread, marked `restored`. The CURRENT thread is archived first
   * (if worth keeping) so switching never loses it. Returns whether a thread was found.
   */
  loadThread: (sessionId: string) => boolean
  /** The archived thread summaries (newest first) for the rail's history list. */
  sessions: () => ThreadSummary[]
}

/**
 * Create a conversation store. Snapshots are immutable and their reference is stable
 * until the next write, so `useSyncExternalStore` re-renders only on real changes.
 */
export const createConversationStore = (): ConversationStore => {
  // Rehydrate the CURRENT thread from localStorage on construction (page reload); fall
  // back to a fresh empty thread when nothing is persisted / storage is unavailable.
  const rehydrated = loadCurrentThread()
  let state: ConversationState = rehydrated
    ? { contextId: rehydrated.contextId, messages: rehydrated.messages, restored: false, sessionId: rehydrated.sessionId }
    : { contextId: undefined, messages: [], restored: false, sessionId: newSessionId() }
  // Outside `state` on purpose: the delta base is not rendered, so writing it must not emit.
  let lastEnvelope: PageContextEnvelope | undefined
  const listeners = new Set<() => void>()

  const emit = (): void => {
    for (const listener of listeners) {
      listener()
    }
  }

  /** Persist the current thread on every state change (best-effort; no-op when empty). */
  const persistCurrent = (): void => {
    saveCurrentThread(
      isThreadWorthKeeping(state.messages)
        ? { contextId: state.contextId, messages: state.messages, sessionId: state.sessionId, title: deriveThreadTitle(state.messages), updatedAt: Date.now() }
        : null,
    )
  }

  const set = (next: ConversationState): void => {
    state = next
    persistCurrent()
    emit()
  }

  /** Snapshot the current thread as an archive entry (only when it has a user turn). */
  const currentAsThread = (): PersistedThread | null => {
    if (!isThreadWorthKeeping(state.messages)) {
      return null
    }
    return { contextId: state.contextId, messages: state.messages, sessionId: state.sessionId, title: deriveThreadTitle(state.messages), updatedAt: Date.now() }
  }

  const freshState = (): ConversationState => ({ contextId: undefined, messages: [], restored: false, sessionId: newSessionId() })

  return {
    archiveAndReset: () => {
      const thread = currentAsThread()
      if (thread) {
        archiveThread(thread)
      }
      lastEnvelope = undefined
      set(freshState())
    },
    getLastEnvelope: () => lastEnvelope,
    getSnapshot: () => state,
    loadThread: (sessionId) => {
      const target = loadArchive().find((thread) => thread.sessionId === sessionId)
      if (!target) {
        return false
      }
      // Archive the CURRENT thread first so switching away never loses it.
      const current = currentAsThread()
      if (current && current.sessionId !== sessionId) {
        archiveThread(current)
      }
      lastEnvelope = undefined
      // Load the archived transcript for VIEWING. contextId is intentionally dropped — v1 does
      // NOT resume the server A2A session (phase-2); the next send starts a fresh contextId.
      set({ contextId: undefined, messages: target.messages, restored: true, sessionId: target.sessionId })
      return true
    },
    reset: () => {
      lastEnvelope = undefined
      set(freshState())
    },
    sessions: () => summarize(loadArchive()),
    setContextId: (contextId) => {
      if (contextId === state.contextId && !state.restored) { return }
      // A server contextId assignment means a live turn is under way — the thread is no
      // longer merely "restored for viewing", so clear the hint.
      set({ ...state, contextId, restored: false })
    },
    setLastEnvelope: (envelope) => { lastEnvelope = envelope },
    setMessages: (update) => {
      const next = typeof update === 'function' ? update(state.messages) : update
      if (next === state.messages) { return }
      set({ ...state, messages: next })
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * The app-wide singleton. Lives at module scope, so it OUTLIVES any
 * AutopilotProvider remount (that is the whole point). One rail per app → one store.
 */
export const autopilotConversationStore = createConversationStore()
