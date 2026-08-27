/**
 * Autopilot SESSION-HISTORY persistence (Vincenzo item P).
 *
 * WHY THIS EXISTS: the conversation store (conversationStore.ts) is a module-level
 * singleton — it survives a provider REMOUNT, but a true page RELOAD wipes it (module
 * state does not cross a navigation/refresh), and `newThread()` used to DISCARD the
 * current thread outright. Users lost their conversation on refresh, and lost every
 * prior thread the moment they started a new one. This module is the durable backing:
 *
 *   1. PERSIST the CURRENT thread to localStorage on change, so it rehydrates on reload.
 *   2. ARCHIVE the current (non-empty) thread into a bounded list before newThread(),
 *      so starting fresh no longer throws the old conversation away.
 *   3. Let the rail BROWSE + SWITCH to an archived thread's transcript.
 *
 * DELIBERATELY PURE + DEFENSIVE. Every localStorage touch is wrapped in try/catch: a
 * quota error, a disabled/blocked storage (private mode, `SecurityError`), or malformed
 * JSON must NEVER crash the rail — it degrades to in-memory (the feature simply stops
 * persisting). No React here; the store adapts it via useSyncExternalStore.
 *
 * WHAT IS PERSISTED: only what already lives in the in-memory ConversationState — the
 * redaction-safe transcript `messages` (the collector/redactor already scrubbed the
 * page-context that produced them; the transcript itself is user+assistant prose), the
 * frontend-owned `sessionId`, the server `contextId`, plus a derived `title` +
 * `updatedAt`. Nothing more sensitive than what is already on screen in the rail.
 */

import type { AutopilotMessage } from './types'

// ── storage keys + bounds (tune here) ──────────────────────────────────────
/** localStorage key for the CURRENT (live) thread — rehydrated on reload. */
export const CURRENT_KEY = 'krateo.autopilot.current.v1'
/** localStorage key for the ARCHIVE list (past threads, newest first). */
export const ARCHIVE_KEY = 'krateo.autopilot.archive.v1'
/** Hard cap on archived threads — prune the oldest past this. */
export const MAX_ARCHIVED_THREADS = 20
/** Total-bytes budget for the archive JSON — prune oldest until it fits (belt-and-braces
 *  against one pathologically long thread blowing the ~5 MB origin quota). */
export const MAX_ARCHIVE_BYTES = 512 * 1024
/** Title length cap (derived from the first user message). */
const TITLE_MAX_CHARS = 60

/** A persisted thread: the transcript + its identity, plus display metadata. */
export interface PersistedThread {
  sessionId: string
  contextId: string | undefined
  messages: AutopilotMessage[]
  /** Derived from the first user message (truncated) — the history-list label. */
  title: string
  /** ms epoch of the last write — drives the relative-time + newest-first ordering. */
  updatedAt: number
}

/** The compact shape the history UI lists (no transcript payload). */
export interface ThreadSummary {
  sessionId: string
  title: string
  updatedAt: number
  messageCount: number
}

/** Best-effort localStorage handle: returns null when storage is unavailable, so every
 *  caller degrades to in-memory instead of throwing. `globalThis` (not `window`) so a
 *  non-DOM test env without a window global still no-ops rather than ReferenceErrors. */
const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    // Accessing localStorage itself can throw (SecurityError) in a blocked context.
    return null
  }
}

/** Derive a human title from the transcript's first user message; fall back gracefully. */
export const deriveThreadTitle = (messages: AutopilotMessage[]): string => {
  const firstUser = messages.find((message) => message.role === 'user')
  const raw = (firstUser?.text ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) {
    return 'Conversation'
  }
  return raw.length > TITLE_MAX_CHARS ? `${raw.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…` : raw
}

/** A thread with at least one user turn is worth persisting/archiving; an empty (or
 *  assistant-only greeting) thread is not — archiving it would litter the list. */
export const isThreadWorthKeeping = (messages: AutopilotMessage[]): boolean =>
  messages.some((message) => message.role === 'user')

/** Read + JSON-parse a key, returning `fallback` on any failure (missing/blocked/corrupt). */
const readJson = <T, >(key: string, fallback: T): T => {
  const ls = storage()
  if (!ls) {
    return fallback
  }
  try {
    const raw = ls.getItem(key)
    if (!raw) {
      return fallback
    }
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Best-effort write; swallows quota/security errors. Returns whether it stuck. */
const writeJson = (key: string, value: unknown): boolean => {
  const ls = storage()
  if (!ls) {
    return false
  }
  try {
    ls.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

const removeKey = (key: string): void => {
  const ls = storage()
  try {
    ls?.removeItem(key)
  } catch {
    // ignore — a blocked storage can throw even on remove.
  }
}

/** A persisted thread must have a string sessionId + an array of messages; anything else
 *  (a hand-edited / partially-written / schema-drifted entry) is discarded, not trusted. */
const isPersistedThread = (value: unknown): value is PersistedThread => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const thread = value as Record<string, unknown>
  return typeof thread.sessionId === 'string' && Array.isArray(thread.messages)
}

/** Enforce BOTH bounds on the archive: newest-first order, ≤ MAX_ARCHIVED_THREADS, and
 *  under MAX_ARCHIVE_BYTES (drop the oldest until the serialized list fits). Pure. */
const enforceBounds = (threads: PersistedThread[]): PersistedThread[] => {
  // Newest first, then hard count cap.
  let bounded = [...threads].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_ARCHIVED_THREADS)
  // Byte budget: drop the OLDEST (tail) until it fits, but always keep at least one.
  while (bounded.length > 1 && JSON.stringify(bounded).length > MAX_ARCHIVE_BYTES) {
    bounded = bounded.slice(0, -1)
  }
  return bounded
}

/** Load + sanitize the archive (newest first, bounds enforced). */
export const loadArchive = (): PersistedThread[] => {
  const raw = readJson<unknown[]>(ARCHIVE_KEY, [])
  const clean = Array.isArray(raw) ? raw.filter(isPersistedThread) : []
  return enforceBounds(clean)
}

/** Persist the archive list (bounds re-enforced on the way out). Best-effort. */
export const saveArchive = (threads: PersistedThread[]): PersistedThread[] => {
  const bounded = enforceBounds(threads)
  if (!writeJson(ARCHIVE_KEY, bounded)) {
    // Over quota even after bounding: shed the oldest half and try once more, so a
    // wedged archive still accepts the newest thread rather than silently dropping it.
    const halved = bounded.slice(0, Math.max(1, Math.floor(bounded.length / 2)))
    writeJson(ARCHIVE_KEY, halved)
    return halved
  }
  return bounded
}

/** Push a thread onto the FRONT of the archive (newest first), de-duped by sessionId
 *  (re-archiving the same session replaces its prior entry), then persist + bound. */
export const archiveThread = (thread: PersistedThread): PersistedThread[] => {
  const existing = loadArchive().filter((entry) => entry.sessionId !== thread.sessionId)
  return saveArchive([thread, ...existing])
}

/** Load the persisted CURRENT thread (the one to rehydrate on reload), or null. */
export const loadCurrentThread = (): PersistedThread | null => {
  const value = readJson<unknown>(CURRENT_KEY, null)
  return isPersistedThread(value) ? value : null
}

/** Persist the CURRENT thread (best-effort). An empty thread clears the slot instead. */
export const saveCurrentThread = (thread: PersistedThread | null): void => {
  if (!thread || !isThreadWorthKeeping(thread.messages)) {
    removeKey(CURRENT_KEY)
    return
  }
  writeJson(CURRENT_KEY, thread)
}

/** Compact relative-time label for a history row ("just now" / "5m ago" / "3h ago" /
 *  "2d ago" / a date past a week). Pure — `now` is injectable for a stable test. */
export const relativeTime = (updatedAt: number, now: number = Date.now()): string => {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000))
  if (seconds < 45) {
    return 'just now'
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.round(hours / 24)
  if (days <= 7) {
    return `${days}d ago`
  }
  return new Date(updatedAt).toLocaleDateString()
}

/** The list shape the history UI renders (transcript stripped). */
export const summarize = (threads: PersistedThread[]): ThreadSummary[] =>
  threads.map((thread) => ({
    messageCount: thread.messages.length,
    sessionId: thread.sessionId,
    title: thread.title,
    updatedAt: thread.updatedAt,
  }))
