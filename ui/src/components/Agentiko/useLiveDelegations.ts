/**
 * Polls the session store for every hand-off of one turn that is still running, so its lane fills
 * in while the specialist works (liveDelegation.ts). One loop per run card; it ticks only while
 * `active` (the turn is live and its card open) and the tab is visible, and drops a hand-off as
 * soon as its reply lands — the finished view reads the stored task from then on.
 */
import { useEffect, useRef, useState } from 'react'

import { discoverRun, followRun, type LiveDelegation } from './liveDelegation'
import type { EvidenceEntry } from './types'

export const LIVE_POLL_MS = 2_000

/** A read that fails this many times in a row stops that hand-off's polling: a 401/403 or a
 *  missing route does not heal by asking again, and the lane still fills in on the reply. */
const FAILURES_MAX = 3

export const useLiveDelegations = (
  sessionsBase: string | undefined,
  entries: EvidenceEntry[],
  active: boolean,
  headers: () => Record<string, string>,
): Record<string, LiveDelegation> => {
  const [live, setLive] = useState<Record<string, LiveDelegation>>({})
  const state = useRef<Record<string, LiveDelegation>>({})
  const failures = useRef<Record<string, number>>({})
  const running = entries.filter((entry) => entry.agent && !entry.done && entry.request && entry.startedAt !== undefined)
  const runningKey = running.map((entry) => entry.id).join('|')
  const runningRef = useRef(running)
  runningRef.current = running

  useEffect(() => {
    if (!active || !sessionsBase || !runningKey) {
      return undefined
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const pollOne = async (entry: EvidenceEntry): Promise<void> => {
      const current = state.current[entry.id] ?? { children: [] }
      let next = current
      if (current.cursor) {
        next = await followRun(sessionsBase, current, headers())
      } else {
        const claimed = new Set(Object.values(state.current).flatMap((other) => (other.cursor ? [other.cursor.invocationId] : [])))
        const cursor = await discoverRun(sessionsBase, entry, claimed, headers())
        if (cursor) {
          next = await followRun(sessionsBase, { children: [], cursor }, headers())
        }
      }
      failures.current[entry.id] = 0
      if (next !== current) {
        state.current = { ...state.current, [entry.id]: next }
      }
    }

    const tick = async (): Promise<void> => {
      if (typeof document === 'undefined' || !document.hidden) {
        const due = runningRef.current.filter((entry) => (failures.current[entry.id] ?? 0) < FAILURES_MAX)
        const before = state.current
        await Promise.all(due.map((entry) => pollOne(entry).catch(() => {
          failures.current[entry.id] = (failures.current[entry.id] ?? 0) + 1
        })))
        if (!cancelled && state.current !== before) {
          setLive(state.current)
        }
      }
      if (!cancelled) {
        timer = setTimeout(() => { void tick() }, LIVE_POLL_MS)
      }
    }

    void tick()
    return () => {
      cancelled = true
      if (timer) {
        clearTimeout(timer)
      }
    }
    // `headers` is read per request, so a refreshed token is used without restarting the loop.
  }, [active, sessionsBase, runningKey])

  return live
}
