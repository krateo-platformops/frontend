/**
 * The TEMPLATED route of a location — the one value `http.route` may carry.
 *
 * WHY THIS EXISTS AT ALL, rather than `location.pathname`. The consumer aggregates on
 * `http.route`, every distinct value becomes its own metric series, and the cap is 1,000
 * combinations per service per agent (observability#90). `/compositions/krateo-system/foo-123` is
 * one series per composition, so a portal with a few hundred compositions exhausts the cap and the
 * metric stops meaning anything. `/compositions/:namespace/:name` is one series for all of them.
 *
 * So the pattern is taken from THE ROUTER'S OWN MATCH, through react-router's `matchRoutes` and the
 * live route table — not re-derived by a regex over the URL, which would be a second, drifting
 * answer to a question the router already answers. The portal's routes arrive from the cluster
 * (RoutesContext registers one route per navigation entry, `/compositions/{namespace}/{name}` ->
 * `/compositions/:namespace/:name`), so there is no static list to match against here.
 *
 * NO FALLBACK TO THE CONCRETE PATH, EVER. When no templated route can be resolved this returns
 * null and the caller emits NO SPAN. That is the lesser of the two harms: a span carrying a
 * concrete path poisons the cap for every series of that name, and a span missing the key splits
 * the name into two series (an attribute key must be always present or always absent per span
 * name). An interaction that cannot be attributed to a route is simply not measured.
 *
 * `matchRoutes` IS NOT WRAPPED IN A TRY/CATCH. A route table it could throw on is one
 * `createBrowserRouter` has already thrown on in App.tsx — the app would not be rendering. A
 * swallow here would buy nothing and hide the one case where this is wrong.
 */
import { matchRoutes, type RouteObject } from 'react-router'

/**
 * The composition detail route pattern: `/compositions/:namespace/:name`.
 *
 * MATCHED, NOT LOOKED UP, and that is a real limitation rather than a shortcut. The route is not
 * declared in this repo: it arrives from the cluster's navigation, and nothing in the CR says "this
 * page is a composition" — so a page that opens one is identified by the SHAPE of its address. The
 * platform's own convention is this shape (the nav ships `/compositions/{namespace}/{name}`, which
 * `Breadcrumb.tsx` cites as its worked example), and the contract names the concept in the span
 * itself: `krateo.composition.open`.
 *
 * IF THAT ROUTE EVER MOVES, this stops matching and `krateo.composition.open` silently stops being
 * emitted — no test and no type can catch it, because the route is data. The honest mitigation is
 * that the SLI's own panel goes to zero, which is visible to whoever owns it.
 *
 * Deliberately anchored and deliberately exactly two params: `/compositions/:namespace` is the
 * per-namespace LIST, not a detail page, and opening a list is not opening a composition.
 */
const COMPOSITION_DETAIL = /^\/compositions\/:[^/]+\/:[^/]+$/

/** Is this templated route a composition DETAIL page? */
export const isCompositionDetailRoute = (route: string | null): boolean =>
  route !== null && COMPOSITION_DETAIL.test(route)

/**
 * The templated route `pathname` matches in `routes`, or null when there is none to report.
 *
 * Null for: an empty or not-yet-loaded route table (the portal's routes arrive after sign-in), a
 * path nothing matches, and a path matched only by the `*` catch-all — a URL with no page behind
 * it is not a route, and reporting the catch-all would file every unknown address under one name
 * as if it had been served.
 */
export const templatedRouteOf = (routes: RouteObject[] | undefined, pathname: string): string | null => {
  if (!Array.isArray(routes) || routes.length === 0) {
    return null
  }
  const matches = matchRoutes(routes, pathname)
  if (matches === null) {
    return null
  }

  // The matched branch, joined the way react-router nests it: an absolute child path replaces what
  // came before (the authenticated shell is a PATHLESS layout route whose children carry absolute
  // paths), a relative one extends it.
  let pattern = ''
  for (const { route } of matches) {
    const { path } = route
    if (path === undefined || path.length === 0) {
      continue
    }
    pattern = path.startsWith('/') ? path : `${pattern.replace(/\/$/, '')}/${path}`
  }

  if (pattern.length === 0 || pattern.includes('*')) {
    return null
  }
  // A trailing slash is the same route; keeping both spellings would be two series.
  return pattern.length > 1 ? pattern.replace(/\/$/, '') : pattern
}
