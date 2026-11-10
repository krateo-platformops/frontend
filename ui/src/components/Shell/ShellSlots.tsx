import { createContext, useContext, type ReactNode } from 'react'

/**
 * Engine-owned slots projected into the root `Layout` widget when it acts as the
 * app shell (loaded via config `INIT`). The Layout widget renders a child widget
 * for any region that names a `resourceRefId`; for regions the shell CR leaves
 * unset it falls back to these slots:
 *  - `content` — the React Router `<Outlet/>` (the routed page);
 *  - `header` — the interactive app chrome (breadcrumb + theme/notifications/user),
 *    which is client-state-driven, not server data.
 *
 * Passing them through context keeps the Layout widget pure antd — it imports
 * neither the router nor the chrome components; the Shell layout route supplies
 * both.
 */
export interface ShellSlots {
  content?: ReactNode
  header?: ReactNode
  /** Instrument-console eyebrow pinned to the TOP of the Sider, above the nav. */
  siderHeader?: ReactNode
  /** User block + build marker pinned to the bottom of the Sider. */
  siderFooter?: ReactNode
  /** Changes on every navigation (the routed pathname). On a phone the Sider is a drawer over the
   * page, and picking a page from it has to close it; this is how the router-free Layout learns
   * that a navigation happened. */
  routeKey?: string
}

const ShellSlotsContext = createContext<ShellSlots>({})

export const ShellSlotsProvider = ShellSlotsContext.Provider

export const useShellSlots = (): ShellSlots => useContext(ShellSlotsContext)
