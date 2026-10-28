import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'

import type { EventScope } from '../../hooks/sseClient'
import { useGetEvents } from '../../hooks/useGetEvents'
import type { SSEK8sEvent } from '../../utils/types'

/**
 * Shared state for the header notification bell + its drawer.
 *
 * The header chrome (which hosts the bell) is projected as a slot INTO the server-driven
 * Layout widget, which remounts its subtree on every data refresh; and the whole ShellRoute
 * can itself be rebuilt when config/routes are re-delivered. Either remount would reset a
 * React `useState` back to false, snapping the drawer shut. So the open-state lives in a
 * MODULE-LEVEL store (outside the React tree entirely) — no remount at any level can reset
 * it. The event data survives remounts too, via the react-query cache (staleTime/gcTime
 * Infinity in useGetEvents), so the drawer stays open AND populated across any remount.
 */

// --- module-level open-state store (survives every React remount) ---
let drawerOpen = false
const listeners = new Set<() => void>()

const openStore = {
  getSnapshot: (): boolean => drawerOpen,
  setOpen: (next: boolean): void => {
    if (drawerOpen === next) { return }
    drawerOpen = next
    listeners.forEach((listener) => { listener() })
  },
  subscribe: (callback: () => void): (() => void) => {
    listeners.add(callback)
    return () => { listeners.delete(callback) }
  },
}

const useDrawerOpen = (): boolean => useSyncExternalStore(openStore.subscribe, openStore.getSnapshot)

interface NotificationsCtx {
  isLoading: boolean
  notifications: SSEK8sEvent[] | undefined
  /** What the stream announced it may deliver, as of its last successful open. */
  scope: EventScope
  open: boolean
  setOpen: (open: boolean) => void
}

const Ctx = createContext<NotificationsCtx | null>(null)

export const NotificationsProvider = ({ children, topic = 'krateo' }: { children: ReactNode; topic?: string }) => {
  const open = useDrawerOpen()
  // Single initial-GET + SSE subscription for the whole app. Anchored above the header churn;
  // on the rarer ShellRoute rebuild the react-query cache serves the data instantly (no refetch
  // flash) because the QueryClient lives above ShellRoute.
  const { data: notifications, isLoading, scope } = useGetEvents({ registerToSSE: true, topic })

  const value = useMemo<NotificationsCtx>(
    () => ({ isLoading, notifications, open, scope, setOpen: openStore.setOpen }),
    [isLoading, notifications, open, scope]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useNotifications = (): NotificationsCtx => {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useNotifications must be used within a NotificationsProvider')
  }
  return ctx
}
