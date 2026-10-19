/**
 * WHICH ROUTE'S INPUTS A WIDGET TREE IS ENTITLED TO (snowplow#777).
 *
 * `useWidgetQuery` builds its extras envelope from `useParams()` and the URL query. react-router
 * shares ONE params object across the whole matched branch, so a widget mounted in the Shell —
 * above the outlet — sees the CHILD route's params: `compositions/{namespace}/{name}`,
 * `blueprints/{namespace}/{name}`, and so on. The header chrome reads none of them, declares
 * `keyExtras: ["projects"]`, and snowplow then declines the undeclared keys. That is its F6
 * contract working as designed on an envelope that should never have carried them: measured at
 * **74 declines in 7 days, 33% of all logged /call declines**, for a response body that is
 * byte-identical every time.
 *
 * THE INVARIANT, and it is the whole design: a widget receives the route inputs owned **at or
 * above its own route level**. Chrome is mounted at the root layout, which owns none, so it
 * receives none. A page widget sits at the deepest matched level and already owns everything in
 * the envelope, so ITS extras string — and therefore its react-query key and its L1 cache cell —
 * is byte-identical before and after this change. That is the property to protect: re-keying page
 * cells would miss every warm cell in the fleet to fix a header.
 *
 * Identity is NOT route input and is unaffected. `displayName` and `username` still enter the
 * envelope exactly as before (when snowplow is not injecting them server-side), because the header
 * greeting needs them and they are not something the page owns.
 *
 * Declaring the keys in the chart instead would be the wrong fix: the header would then partition
 * its cache per composition, which is the opposite of what it needs.
 */
import { createContext, useContext, type ReactNode } from 'react'

/** The route inputs a widget tree may read. `chrome` owns none; `page` owns the matched branch's. */
export type WidgetScope = 'chrome' | 'page'

// `page` is the default so every existing mount is unchanged by construction: a tree that never
// hears about this context behaves exactly as it did.
const WidgetScopeContext = createContext<WidgetScope>('page')

export const WidgetScopeProvider = ({ children, scope }: { children: ReactNode; scope: WidgetScope }) => (
  <WidgetScopeContext.Provider value={scope}>{children}</WidgetScopeContext.Provider>
)

export const useWidgetScope = (): WidgetScope => useContext(WidgetScopeContext)

export default WidgetScopeContext
