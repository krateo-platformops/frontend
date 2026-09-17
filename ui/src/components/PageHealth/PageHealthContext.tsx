import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import type { ChildHealth, ChildHealthRollup } from './childHealth'
import { rollupChildHealth } from './childHealth'

/**
 * Page-scoped child-health channel.
 *
 * A Krateo page is not one component: it is a tree of independently-resolved widget CRs, each
 * fetching its own RESTAction. On a composition detail page the status pill (PageHeader) and the
 * composed-children tree (the Relations list) are two such widgets, and they never met — which is
 * precisely why the header could read `Ready` while a child below it read `NotReady`.
 *
 * This is the seam that lets them meet WITHOUT either widget learning about the other: a widget
 * that renders composed children REPORTS what it rendered, and a widget that states the page's
 * status CONSUMES the rollup. Both are optional — outside a provider the hooks are inert, so every
 * page that does not render children behaves exactly as before.
 *
 * Scope discipline: the provider is mounted per route (`WidgetPage`) and keyed by pathname, so the
 * reports of one composition never leak onto the next page.
 */

interface PageHealthValue {
  /** Every child reported by every reporting widget on this page. */
  entries: ChildHealth[]
  /** Drop a scope's report (a reporting widget unmounting). */
  forget: (scope: string) => void
  /** Publish one scope's children (replaces that scope's previous report). */
  report: (scope: string, entries: ChildHealth[]) => void
}

const noop = () => { /* inert outside a provider */ }

const PageHealthContext = createContext<PageHealthValue>({ entries: [], forget: noop, report: noop })

export const PageHealthProvider = ({ children }: { children: ReactNode }) => {
  const [scopes, setScopes] = useState<Record<string, ChildHealth[]>>({})

  const report = useCallback((scope: string, entries: ChildHealth[]) => {
    setScopes((previous) => {
      const current = previous[scope]
      // Identity-stable: a re-render that reports the same children must not produce a new state
      // object, or the consumer re-renders forever.
      if (current && JSON.stringify(current) === JSON.stringify(entries)) { return previous }
      if (!current && entries.length === 0) { return previous }
      return { ...previous, [scope]: entries }
    })
  }, [])

  const forget = useCallback((scope: string) => {
    setScopes((previous) => {
      if (!(scope in previous)) { return previous }
      return Object.fromEntries(Object.entries(previous).filter(([key]) => key !== scope))
    })
  }, [])

  const value = useMemo<PageHealthValue>(
    () => ({ entries: Object.values(scopes).flat(), forget, report }),
    [forget, report, scopes],
  )

  return <PageHealthContext.Provider value={value}>{children}</PageHealthContext.Provider>
}

/**
 * Report the children a widget just rendered. `scope` must be stable for the widget instance
 * (`useId`), so two lists on one page do not overwrite each other.
 */
export const useReportChildHealth = (scope: string, entries: ChildHealth[]) => {
  const { forget, report } = useContext(PageHealthContext)
  // The effect keys off the VALUE, not the array identity: `entries` is rebuilt on every render of
  // the reporting widget, and depending on its identity would loop.
  const signature = JSON.stringify(entries)

  useEffect(() => {
    report(scope, JSON.parse(signature) as ChildHealth[])
  }, [report, scope, signature])

  useEffect(() => () => { forget(scope) }, [forget, scope])
}

/** The page's worst-child rollup. `worst === undefined` means there is nothing to show. */
export const usePageChildHealth = (): ChildHealthRollup => {
  const { entries } = useContext(PageHealthContext)
  return useMemo(() => rollupChildHealth(entries), [entries])
}
