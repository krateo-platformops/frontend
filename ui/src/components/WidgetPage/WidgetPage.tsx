import { useIsFetching } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { useLocation } from 'react-router'

import { buildersStatus, isBuilderPath, subscribeBuilders } from '../../builders/builderRegistry'
import BuildersUnavailable from '../../builders/host/BuildersUnavailable'
import { useRoutesContext } from '../../context/RoutesContext'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import Page404 from '../../pages/Page404'
import { PageHealthProvider } from '../PageHealth'
import PageSearch from '../PageSearch'
import WidgetRenderer from '../WidgetRenderer'
import { WidgetLoading } from '../WidgetStates'

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
  const { menuRoutes } = useRoutesContext()
  const currentRoute = menuRoutes.find(({ path }) => path === location.pathname)
  // Route-driven browser-tab title (relocated off the Page widget's <title>).
  useDocumentTitle(currentRoute?.title)
  // Content resolves ONLY from the route (routes-as-data → snowplow). The legacy
  // `?widgetEndpoint=` query-param override is intentionally not supported.
  const widgetEndpoint = currentRoute?.resourceRef?.path || defaultWidgetEndpoint || ''
  // The builder routes are mounted only once the Builder CRs are read from the cluster.
  const builders = useSyncExternalStore(subscribeBuilders, buildersStatus)

  // Routes now come from the sidebar Menu's inline items (registered once the INIT
  // Layout → Menu resolves), so "routes still loading" = that fetch is in flight —
  // show loading, not 404, until the route source has registered.
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
      {searchPlaceholder ? <PageSearch placeholder={searchPlaceholder} /> : null}
      <WidgetRenderer key='content' widgetEndpoint={widgetEndpoint} />
    </PageHealthProvider>
  )
}

export default WidgetPage
