import type { NavigateFunction } from 'react-router'

/**
 * An http(s):// target is an EXTERNAL link. react-router's `navigate()` treats any string as
 * an in-app route, so it mangles a full URL (e.g. a GitHub PR link) into a broken relative
 * path. External links must open in a new tab instead. This is the single predicate every
 * widget navigation site uses to tell an in-app route from an outbound URL.
 */
export const isExternalUrl = (path: string | undefined | null): boolean =>
  /^https?:\/\//i.test((path ?? '').trim())

/**
 * GLOBAL scope params — query keys that belong to the app CHROME, not to a page.
 *
 * The header's project switcher (widgets/Select with `queryParam: projects`) keeps its selection
 * ONLY in `?projects=`, which useWidgetQuery turns into every widget's `extras` so a data source
 * can scope server-side. But each nav site emits a bare pathname (`Menu` navigated to `item.key`),
 * and `resolveNavigationTarget` deliberately drops the query when the pathname changes, so a
 * page-local filter (`status`, `range`, `q`) cannot leak. The scope was caught by that same rule:
 * the FIRST click in the sidebar wiped the selection — the reported bug — even though the
 * switcher's own panel footer promises "scope persists across pages via ?projects=".
 *
 * So the carry is a WHITELIST, not a blanket query-merge: only the keys listed here travel to
 * another page. Page-local filters keep leaking nowhere.
 */
export const SCOPE_PARAMS = ['projects'] as const

/**
 * PAGE-STATE params — query keys that say which view of the CURRENT page is open, not what data it
 * shows. Today only `tab`: the Tabs widget writes `?tab=<label>` when a tab is chosen (and reads it
 * on load), so a link names the open tab.
 *
 * They ride along only on a navigation that stays on the SAME page, and never to another page.
 * The /observability range chips navigate to `/observability?range=1h` and must keep the reader on
 * the Telemetry tab; before this they dropped `?tab` and every range change jumped back to the
 * first tab. A different page has different tabs, so carrying `tab` there would select an
 * arbitrary one.
 */
export const PAGE_STATE_PARAMS = ['tab'] as const

/**
 * Carry the global scope params of the CURRENT url onto a navigate target. The target always
 * wins: a link that names `projects` itself (the switcher applying/clearing its own scope, a
 * project-scoped deep link) is passed through untouched, so the scope stays changeable and
 * clearable. Nothing is added when the current url carries no scope — a cleared "All projects"
 * is never resurrected, and every other navigation keeps exactly the URL it had before.
 *
 * `window.location` is read at call time (like `resolveNavigationTarget`) so the carry always
 * sees the applied scope, never a stale render's copy.
 */
export const carryScopeParams = (
  path: string,
  currentSearch: string = typeof window === 'undefined' ? '' : window.location.search,
  currentPathname: string = typeof window === 'undefined' ? '' : window.location.pathname,
): string => {
  const [targetPath, targetQuery = ''] = path.split('?')
  const current = new URLSearchParams(currentSearch)
  const target = new URLSearchParams(targetQuery)
  const samePage = targetPath === currentPathname
  let carried = false
  for (const key of [...SCOPE_PARAMS, ...(samePage ? PAGE_STATE_PARAMS : [])]) {
    const value = current.get(key)
    if (value && !target.has(key)) {
      target.set(key, value)
      carried = true
    }
  }
  if (!carried) { return path }

  return `${targetPath}?${target.toString()}`
}

/**
 * The one navigation entry point for every widget (Table row, List item, Button navigate
 * action). Internal routes go through react-router (optionally `resolve`d for query-merge);
 * an external http(s) URL opens in a new tab (`noopener,noreferrer`). A blank/undefined path
 * is a no-op. The global scope (`?projects=`) rides along to the target page — see
 * `carryScopeParams`.
 */
export const navigateOrExternal = (
  navigate: NavigateFunction,
  path: string | undefined | null,
  resolve?: (p: string) => string,
): void => {
  const target = (path ?? '').trim()
  if (!target) { return }

  if (isExternalUrl(target)) {
    window.open(target, '_blank', 'noopener,noreferrer')
    return
  }

  void navigate(carryScopeParams(resolve ? resolve(target) : target))
}
