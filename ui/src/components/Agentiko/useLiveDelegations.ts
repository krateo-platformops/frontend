/**
 * Polls the session store for every hand-off of one turn that is still running, so its lane fills
 * in while the specialist works (liveDelegation.ts). One loop per run card; it ticks only while
 * `active` (the turn is live and its card open) and the tab is visible, and drops a hand-off as
 * soon as its reply lands — the finished view reads the stored task from then on.
 *
 * A found run is followed every tick. Finding it backs off while nothing matches and gives up after
 * a few tries, because each try lists the caller's sessions and reads the likeliest ones.
 */
import { useEffect, useRef, useState } from 'react'

import { discoverRun, followRun, type LiveDelegation } from './liveDelegation'
import type { EvidenceEntry } from './types'

export const LIVE_POLL_MS = 2_000

/** A read that fails this many times in a row stops that hand-off's polling: a 401/403 or a
 *  missing route does not heal by asking again, and the lane still fills in on the reply. */
const FAILURES_MAX = 3

/** A specialist stores its first event as it starts, so a run that has not matched after this many
 *  tries (about 90 s with the back-off) will not; its lane then waits for the reply. */
export const DISCOVERY_MISSES_MAX = 6

/** Wait before the next try after `misses` unmatched ones: 4 s, 8 s, 16 s, then 30 s. */
export const discoveryDelayMs = (misses: number): number => Math.min(LIVE_POLL_MS * 2 ** misses, 30_000)

export const useLiveDelegations = (
  sessionsBase: string | undefined,
  entries: EvidenceEntry[],
  active: boolean,
  headers: () => Record<string, string>,
): Record<string, LiveDelegation> => {
  const [live, setLive] = useState<Record<string, LiveDelegation>>({})
  const state = useRef<Record<string, LiveDelegation>>({})
  const failures = useRef<Record<string, number>>({})
  const misses = useRef<Record<string, number>>({})
  const nextTryAt = useRef<Record<string, number>>({})
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

    const put = (id: string, next: LiveDelegation): void => {
      state.current = { ...state.current, [id]: next }
    }

    const stop = (id: string): void => {
      put(id, { ...(state.current[id] ?? { children: [] }), stopped: true })
    }

    const missed = (id: string): void => {
      const count = (misses.current[id] ?? 0) + 1
      misses.current[id] = count
      if (count >= DISCOVERY_MISSES_MAX) {
        stop(id)
      } else {
        nextTryAt.current[id] = Date.now() + discoveryDelayMs(count)
      }
    }

    const pollOne = async (entry: EvidenceEntry): Promise<void> => {
      const current = state.current[entry.id] ?? { children: [] }
      if (current.cursor) {
        const next = await followRun(sessionsBase, current, headers())
        failures.current[entry.id] = 0
        if (next !== current) {
          put(entry.id, next)
        }
        return
      }
      const claimed = new Set(Object.values(state.current).flatMap((other) => (other.cursor ? [other.cursor.invocationId] : [])))
      const cursor = await discoverRun(sessionsBase, entry, claimed, headers())
      failures.current[entry.id] = 0
      if (!cursor) {
        missed(entry.id)
        return
      }
      put(entry.id, await followRun(sessionsBase, { children: [], cursor }, headers()))
    }

    const isDue = (entry: EvidenceEntry, now: number): boolean =>
      !state.current[entry.id]?.stopped && now >= (nextTryAt.current[entry.id] ?? 0)

    const tick = async (): Promise<void> => {
      if (typeof document === 'undefined' || !document.hidden) {
        const now = Date.now()
        const due = runningRef.current.filter((entry) => isDue(entry, now))
        const before = state.current
        await Promise.all(due.map((entry) => pollOne(entry).catch(() => {
          const count = (failures.current[entry.id] ?? 0) + 1
          failures.current[entry.id] = count
          if (count >= FAILURES_MAX) {
            stop(entry.id)
          }
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
