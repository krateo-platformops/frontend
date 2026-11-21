import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router'

import { buildersStatus, isBuilderPath, subscribeBuilders } from '../../builders/builderRegistry'
import BuildersUnavailable from '../../builders/host/BuildersUnavailable'
import { PageRootProvider } from '../../context/PageRootContext'
import { useRoutesContext } from '../../context/RoutesContext'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { templatedRouteOf } from '../../otel/route'
import { useCompositionOpenSpan } from '../../otel/useCompositionOpenSpan'
import Page404 from '../../pages/Page404'
import { PageHealthProvider } from '../PageHealth'
import PageSearch from '../PageSearch'
import WidgetRenderer from '../WidgetRenderer'
import { WidgetLoading } from '../WidgetStates'

import NavigationUnavailable from './NavigationUnavailable'
import { retryRouteSource, routeSourceKey, type RouteSourceState } from './routeSource'

/**
 * M3 (approved motion set): on a page change only the CONTENT area moves. It fades in over the
 * standard motion duration with a 4px rise; the sidebar, header and Agentiko rail stay put. Played
 * on the content area itself (the element the shell's <Outlet/> renders into, reached through a
 * hidden marker), so no wrapper element changes the page's layout. A query-only change (the Alerts
 * range chips) is not a page change and does not play it. Off under reduced motion, and wherever the
 * Web Animations API is missing.
 */
export const playPageEnter = (area: HTMLElement | null | undefined): void => {
  if (!area || typeof area.animate !== 'function' || typeof window === 'undefined') { return }
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { return }
  const tokens = getComputedStyle(document.documentElement)
  const duration = Number.parseFloat(tokens.getPropertyValue('--krateo-motion-standard')) || 240
  const easing = tokens.getPropertyValue('--krateo-motion-ease').trim() || 'ease-out'
  area.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration, easing })
}

/** Exact routes that get a frontend-rendered page search bar (→ `?q=` → the page's
 * data-source RESTAction name/description filter). Frontend chrome, like the Shell search. */
// Empty by design (#82 §0.1 landed): /blueprints, /compositions AND /marketplace each render their
// OWN `?q=`-bound search Input widget inline with their filter pills (blueprints → input.blueprints-
// search in flex.blueprints-filterbar; compositions → input.compositions-search in flex.compositions-
// range-group; marketplace → input.marketplace-search in flex.marketplace-category-group — shipped
// TOGETHER with this removal so marketplace search is never lost in between). A frontend PageSearch
// here would be a SECOND, redundant box. The map + PageSearch seam is kept for any future route that
// wants chrome-level search without an inline widget.
const PAGE_SEARCH: Record<string, string> = {}

/**
 * Content-only routed page: resolves which widget endpoint the current route
 * should render and hands it to WidgetRenderer. The shell chrome (the Layout
 * widget, nav, header, overlays, auth gate and route loading) lives in the Shell
 * layout route — this renders into the Layout widget's content region via its
 * <Outlet/>, so only the content swaps as routes change.
 */
export const WidgetPage = ({ defaultWidgetEndpoint }: { defaultWidgetEndpoint?: string }) => {
  const location = useLocation()
  const { menuRoutes, routes } = useRoutesContext()
  const currentRoute = menuRoutes.find(({ path }) => path === location.pathname)
  // Route-driven browser-tab title (relocated off the Page widget's <title>).
  useDocumentTitle(currentRoute?.title)
  // X5: `krateo.composition.open` — the TEMPLATED route (`/compositions/:namespace/:name`), taken
  // from the router's own match, never from the pathname: a concrete path would be one metric
  // series per composition. Inert on every other route and whenever no provider is registered.
  useCompositionOpenSpan(templatedRouteOf(routes, location.pathname))
  // Content resolves ONLY from the route (routes-as-data → snowplow). The legacy
  // `?widgetEndpoint=` query-param override is intentionally not supported.
  const widgetEndpoint = currentRoute?.resourceRef?.path || defaultWidgetEndpoint || ''
  // The builder routes are mounted only once the Builder CRs are read from the cluster.
  const builders = useSyncExternalStore(subscribeBuilders, buildersStatus)

  // Routes now come from the sidebar Menu's inline items (registered once the INIT
  // Layout → Menu resolves), so "routes still loading" = that fetch is in flight —
  // show loading, not 404, until the route source has registered.
  // The route source's own state (routeSource.ts): whether the Menu's read FAILED, and how. Read from
  // the query the sider's Menu already made, never a second fetch. The snapshot is a string so it is
  // stable between cache events, as useSyncExternalStore requires.
  const queryClient = useQueryClient()
  const subscribeRouteSource = useCallback((onChange: () => void) => queryClient.getQueryCache().subscribe(onChange), [queryClient])
  const routeSourceSnapshot = useSyncExternalStore(subscribeRouteSource, () => routeSourceKey(queryClient))
  const routeSource = useMemo(() => JSON.parse(routeSourceSnapshot) as RouteSourceState, [routeSourceSnapshot])

  const pageMarker = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => { playPageEnter(pageMarker.current?.parentElement) }, [location.pathname])

  const isFetchingRoutes = useIsFetching({
    predicate: (query) => {
      const key = query.queryKey[1] as string
      return key.includes('resource=layouts') || key.includes('resource=menus')
    },
  })

  if (!widgetEndpoint) {
    // No content endpoint resolved for this path. Only a path that is genuinely
    // unknown AFTER the route source has populated is a real 404 — surface it.
    // Anything else is the loading race: the layouts/menus queries can settle
    // (isFetchingRoutes === 0) a render BEFORE the sidebar Menu's effect runs
    // updateMenuRoutes/registerRoutes (menuRoutes.length === 0), and `/` in
    // particular is never a menu route — it waits for Menu.useEffect to redirect
    // it to menuRoutes[0].path. Showing Page404 in either window is the post-login
    // 404 flash. Guard both: keep showing the loading skeleton until routes exist
    // (and always for `/`, the home-redirect target), so a truly-unknown path only
    // 404s once routes ARE populated.
    const routesPopulated = menuRoutes.length > 0
    // THE MENU'S READ FAILED, so no route will ever register: say why instead of loading forever (the
    // approved "When the sidebar menu cannot load" states). Checked before the loading guard below,
    // because a retry in flight keeps `isFetchingRoutes` up: the message stays and its button shows the
    // progress. Only while no route exists: a menu that failed on a later refresh still has its routes.
    if (!routesPopulated && routeSource.failure) {
      return (
        <NavigationUnavailable
          failure={routeSource.failure}
          onRetry={() => { void retryRouteSource(queryClient) }}
          retrying={routeSource.retrying}
        />
      )
    }
    const isHomeRedirect = location.pathname === '/'
    // The same holds for the Builders: until their read answers, this path may be a builder route not
    // mounted YET (/portal-builder/compose right after sign-in) — loading, not a 404 flash. Bounded:
    // the read gives up after its timeout (clusterBuilders.ts), and the status is then `failed`.
    const buildersPending = builders.state === 'idle' || builders.state === 'loading'
    if (isFetchingRoutes || !routesPopulated || isHomeRedirect || buildersPending) {
      return <WidgetLoading />
    }
    // A failed read means no builder route exists: on a builder's address, say why rather than blame
    // the address. Every other unknown address is a plain 404, whatever happened to the Builders.
    if (builders.state === 'failed' && isBuilderPath(location.pathname)) {
      return <BuildersUnavailable reason={builders.reason} />
    }
    return <Page404 />
  }
  const searchPlaceholder = PAGE_SEARCH[location.pathname]
  return (
    // Child-health scope = the page. A detail page's status pill and its composed-children list are
    // two independently-resolved widgets; this is what lets the pill answer for the children (see
    // PageHealthContext). Keyed by pathname so one composition's children are never rolled up into
    // the next page's header.
    <PageHealthProvider key={location.pathname}>
      <span hidden ref={pageMarker} />
      {searchPlaceholder ? <PageSearch placeholder={searchPlaceholder} /> : null}
      {/* The page root: it reads the fragment keys its CR declares (`krateo.io/fragment-keys`)
          for its widgets, then clears them from the address bar (context/PageRootContext.tsx).
          A page that declares none, or is opened without a fragment, is unaffected. */}
      <PageRootProvider endpoint={widgetEndpoint}>
        <WidgetRenderer key='content' widgetEndpoint={widgetEndpoint} />
      </PageRootProvider>
    </PageHealthProvider>
  )
}

export default WidgetPage
