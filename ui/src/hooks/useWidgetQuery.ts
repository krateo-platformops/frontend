/* eslint-disable sort-keys/sort-keys-fix */
/* this rules conflicts with react-query ordering required for correct type inference */

import { useInfiniteQuery, useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router'

import { isTimeoutError } from '../components/WidgetStates'
import { useConfigContext } from '../context/ConfigContext'
import { EMPTY_FRAGMENT_EXTRAS, fragmentKeysOf, pickFragment } from '../context/pageFragment'
import { usePageParams } from '../context/PageParamsContext'
import { useFragmentExtras, usePageRoot } from '../context/PageRootContext'
import { useWidgetScope } from '../context/WidgetScopeContext'
import { useWidgetTransport } from '../transport/widgetTransport'
import { getUserInfo } from '../utils/getUserInfo'
import { getCallReadQuery, getExportEndpoint } from '../utils/utils'

import type { WatchMatcher } from './liveRefresh'
import { prefetchChildren } from './prefetchChildren'
import { getRefreshEntry, isWidgetLiveRefreshEnabled, wasRefetchEventTriggered } from './refreshSse'
import { useLiveWatch } from './useLiveRefresh'
import { useWidgetLiveRefresh } from './useWidgetLiveRefresh'
import { fetchWidgetPage, type WidgetRead, widgetQueryKey } from './widgetRequest'
import { shouldRetryWidgetFetch, widgetFetchRetryDelay } from './widgetRetry'

// Moved to ./widgetRequest (one read, shared with the children prefetch); re-exported for importers.
export { readWithBodyExtras, WidgetFetchError } from './widgetRequest'
// The retry policy moved to ./widgetRetry, which the children's prefetch uses too; re-exported for its importers.
export { MAX_WIDGET_FETCH_RETRIES, shouldRetryWidgetFetch, widgetFetchRetryDelay } from './widgetRetry'

function parseNumberParam(param: string | null) {
  const parsed = param ? parseInt(param) : undefined
  return isNaN(parsed!) ? undefined : parsed
}

/**
 * Build the `?extras=` JSON envelope snowplow forwards into the RESTAction jq dict
 * (its `ParseExtras` reads only this query param; the caller's identity/route are
 * NOT otherwise exposed to RA jq). Sources, later-wins on key collision: the browser
 * URL query (e.g. /search?q=… → `extras.q`), the active route params
 * (e.g. /compositions/:namespace/:name → `extras.namespace`/`extras.name` — the
 * convention's param channel), and — ONLY when `injectIdentity` (the legacy default) —
 * the login-provided identity `displayName` + `username` (there is no runtime /me;
 * displayName feeds the greeting, username scopes per-user server state e.g. blueprint
 * drafts). Identity is applied LAST so a spoofed `?displayName=`/`?username=` URL param
 * can never override the authenticated value.
 *
 * `injectIdentity` gates the two identity merges behind the `api.SNOWPLOW_IDENTITY_INJECTION`
 * capability flag (resolved at the call site). Default `true` = legacy behavior, byte-identical
 * to before the flag existed. When snowplow injects identity server-side the caller passes
 * `false`, so NO identity keys enter extras and identity-independent widgets share one L1 cache
 * cell again (see snowplow docs/definitive-cache-identity-architecture-2026-07-07.md §0/§1.2).
 *
 * Returns '' when empty so the param — and the react-query key it feeds — stay stable
 * (same inputs → same string, no spurious refetch).
 */
/**
 * The empty route inputs a chrome widget gets. Module-level singletons, not literals at the call
 * site: `buildExtrasParam` is called on every render and a fresh `{}`/`new URLSearchParams()` each
 * time is still deep-equal, but keeping one instance makes it obvious that chrome's envelope
 * cannot drift render to render.
 */
const EMPTY_ROUTE_PARAMS: Readonly<Record<string, string | undefined>> = Object.freeze({})
const EMPTY_SEARCH_PARAMS = new URLSearchParams()

/** The caller extras of a widget that supplies none — frozen, so "nothing" is one object. */
const EMPTY_CALLER_EXTRAS: Readonly<Record<string, unknown>> = Object.freeze({})

/** The browser's IANA time zone, or undefined when the runtime reports none. */
const viewerTimeZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

export const buildExtrasParam = (
  searchParams: URLSearchParams,
  routeParams: Record<string, string | undefined> = {},
  displayName?: string,
  username?: string,
  injectIdentity: boolean = true,
  callerExtras: Readonly<Record<string, unknown>> = EMPTY_CALLER_EXTRAS,
  fragmentExtras: Readonly<Record<string, string>> = EMPTY_FRAGMENT_EXTRAS,
): string => {
  // `tab` is PAGE STATE (which Tabs tab is open, utils/navigation PAGE_STATE_PARAMS), not an input
  // to any data source: leaving it out keeps every widget's key, and its snowplow L1 cell, the same
  // whichever tab the address names, so opening a deep link or switching tabs refetches nothing.
  const extras: Record<string, unknown> = Object.fromEntries([...searchParams.entries()].filter(([key]) => key !== 'tab'))
  // The page's FRAGMENT extras (context/pageFragment.ts) beat the query string and nothing else:
  // a fragment is exactly as easy to type as a query, so it must not override the identity (which
  // the query cannot either) or a route param. Precedence, extended: caller > route > identity >
  // fragment > query. Empty for every page that declares no fragment keys, which writes nothing and
  // leaves the string — the react-query key and the L1 cache cell key — byte-identical.
  for (const [key, value] of Object.entries(fragmentExtras)) {
    extras[key] = value
  }
  // A page's route inputs are its NAMED params. `*` is react-router's splat, and it is how the shell
  // serves its pages (RoutesProvider: descendant routes under one `*`), not something a page declared:
  // in the envelope it is an undeclared key, so snowplow declines to cache the read and gives it no
  // live-refresh key (1.8.75 to 1.8.82 sent it on every page read).
  for (const [key, value] of Object.entries(routeParams)) {
    if (value !== undefined && key !== '*') { extras[key] = value }
  }
  // Volunteer identity only when snowplow does NOT inject it server-side (capability flag).
  //
  // Identity still beats the QUERY string — a spoofed `?username=` can never override the
  // authenticated value — but it must NOT beat a ROUTE param. Those are different inputs. A query
  // key is anything the visitor cares to type; a route param exists only because the nav CR
  // declared that path, and its value IS the page's subject.
  //
  // Overwriting both broke `/settings/access/{username}`, the one route in the nav whose param
  // name collides with an identity key: every `/settings/access/<anyone>` URL rendered the logged
  // -in user, because `extras.username` was replaced with the caller before it reached the
  // access-grants RESTAction. The page title, the capability preview (a SubjectAccessReview on
  // `.username`), the grant form and the Revoke button all resolved to the caller — so granting
  // from alice's page wrote a grant for the admin, and Revoke deleted the admin's own, while the
  // URL and the breadcrumb both said alice.
  //
  // This was never the authorization boundary: reads and writes run under the caller's own token,
  // so whether the caller may see or change alice's grants is settled server-side.
  //
  // Written as a skip rather than a reorder so KEY ORDER is unchanged for every non-colliding
  // input. The serialized string is the react-query key and the L1 cache cell key; reordering it
  // would miss every warm cell in the fleet to fix one route.
  if (injectIdentity) {
    if (displayName && routeParams.displayName === undefined) { extras.displayName = displayName }
    if (username && routeParams.username === undefined) { extras.username = username }
    // The VIEWER'S time zone (IANA name), the same kind of value: ambient, from the browser, and
    // beaten by a route param or a caller extra like the identity keys. It lets a widget render a
    // time as the viewer's wall clock. snowplow's viewer-context set is {username, groups,
    // displayName, tz}: for a widget that does not declare a key in spec.keyExtras snowplow strips
    // it before the cache key is made (sanitizeUndeclaredIdentityExtras, identityDimensionKeys), so
    // sending it on every read costs no cache cell; a widget that declares `tz` gets one cell per
    // zone. No zone from the runtime means no key.
    const tz = viewerTimeZone()
    if (tz && routeParams.tz === undefined) { extras.tz = tz }
  }
  // CALLER EXTRAS LAST, and they win (#493). A widget host that passes a key knows what it needs;
  // the ambient inputs — route, query, identity — are what happened to be in scope. The precedence
  // is therefore caller > route > identity > query, extending rather than disturbing the existing
  // order (route already beat identity, identity already beat query).
  //
  // Applied last is also what keeps KEY ORDER intact, which matters because the serialized string
  // is the react-query key and the L1 cache cell key. A caller that passes nothing writes nothing,
  // so the string is byte-identical to before this parameter existed — the default is the frozen
  // singleton, not a fresh `{}`, so there is not even a new object per render. And a caller key
  // that COLLIDES with an ambient one overwrites in place: JS keeps a property at its original
  // insertion position on reassignment, so the collision changes the value and never the order.
  for (const [key, value] of Object.entries(callerExtras)) {
    if (value !== undefined) { extras[key] = value }
  }
  return Object.keys(extras).length > 0 ? JSON.stringify(extras) : ''
}

/**
 * Options for a widget query.
 *
 * `defaultPageSize` opts a widget into BOUNDED, server-side classic pagination:
 * when the widget's snowplow-generated endpoint carries no `page`/`perPage`, the
 * query requests `page=1&perPage=<defaultPageSize>` instead of letting snowplow
 * fall back to its `-1/-1` "no pagination" sentinel (which returns the FULL set —
 * the 60K-row `/compositions` wedge). snowplow reads `page`/`perPage` off the
 * `/call` URL (internal/handlers/call.go) and injects `ds.slice = {page,perPage,
 * offset}` (resolve.go injectSlice) so the widget's `widgetDataTemplate` can
 * window its rows. `(page,perPage)` are part of the L1 cache key, so each page is
 * cached independently. The page is client state (see `serverPage`/`setServerPage`
 * on the return) so a classic pager can jump to any page WITHOUT accumulating the
 * whole dataset in the DOM — this is the request half of the paginate+virtualize
 * fix (the render half is antd `virtual` in the Table widget).
 */
export type UseWidgetQueryOptions = {
  defaultPageSize?: number
  /**
   * Extras this widget CONTRIBUTES, for a host whose input is client state rather than the URL —
   * the ⌘K palette's search term is the case that forced it (#493). Without this a caller needing
   * to add one key had to reimplement the hook's endpoint resolution, auth and caching wholesale.
   *
   * Merged last and wins over route, identity and query. Keep the object STABLE across renders
   * (literal in a `useMemo`, or a module constant): it is part of the react-query key, so a fresh
   * object with the same contents is fine — the key is the serialized string, not the reference —
   * but a changing VALUE is a new cache cell, which is the point when the value is a search term.
   */
  extras?: Readonly<Record<string, unknown>>
}

/**
 * The window size actually in play, whoever supplied it — the ENDPOINT's declared slice first, else
 * the caller's `defaultPageSize`. `undefined` means unbounded (snowplow's -1/-1 full set).
 *
 * Exported because it is the rule, not a detail: every pager behaviour keys off it, and it replaces
 * a test on WHO supplied the window. That conflation was the bug — the pager switched itself off
 * the moment the endpoint carried `page`/`perPage`, on the assumption that endpoint-supplied
 * pagination meant infinite scroll. A declared slice is a bounded window exactly like a
 * client-chosen one.
 */
export const boundedWindow = (
  endpointPerPage: number | undefined,
  defaultPageSize: number | undefined,
): number | undefined => endpointPerPage ?? defaultPageSize

export const useWidgetQuery = (widgetEndpoint: string, options: UseWidgetQueryOptions = {}) => {
  const { config } = useConfigContext()
  // The credential, if any, is the transport's (transport/widgetTransport.ts): signed in inside the
  // shell, anonymous everywhere else. This hook never reads a token itself.
  const transport = useWidgetTransport()
  const [searchParams] = useSearchParams()
  // The OPEN PAGE's params, the same for the page and for a drawer or dialog over it (PageParamsContext).
  const matchedParams = usePageParams()
  // snowplow#777. Every widget in the shell can see the open page's params, so a widget mounted ABOVE
  // the outlet (the Shell's header chrome) would carry the page's params and the
  // page's query string, reads neither, and has snowplow decline them — 74 declines in 7 days,
  // 33% of all logged /call declines, for a byte-identical body. A widget gets the route inputs
  // owned at or above its OWN level; chrome sits at the root layout and owns none.
  //
  // A page widget is at the deepest matched level, so `scope` is 'page', both values are passed
  // through unchanged, and its extras string — the react-query key AND the L1 cache cell key — is
  // byte-identical to before. Re-keying page cells would miss every warm cell in the fleet.
  const scope = useWidgetScope()
  const routeParams = scope === 'chrome' ? EMPTY_ROUTE_PARAMS : matchedParams
  const widgetSearchParams = scope === 'chrome' ? EMPTY_SEARCH_PARAMS : searchParams
  const { defaultPageSize, extras: callerExtras } = options
  // The page's fragment extras, when this widget is below a page root that declares fragment keys
  // the page was opened with. They must never reach a URL — a fragment exists precisely so they
  // reach no server log — so a widget that carries any reads through POST /call/read, with the
  // whole extras envelope in the body (snowplow#186; same chain, same RBAC as GET /call).
  const fragmentExtras = useFragmentExtras()
  const extrasInBody = Object.keys(fragmentExtras).length > 0
  // Extras envelope snowplow forwards into the RESTAction jq dict (`?extras=<json>`):
  // route params (e.g. /compositions/:namespace/:name) + browser URL query (search `q`)
  // + login identity `displayName` (greeting) + `username` (per-user server state, e.g.
  // blueprint drafts) — the identity pair ONLY when snowplow is not injecting it
  // server-side (capability flag api.SNOWPLOW_IDENTITY_INJECTION). See buildExtrasParam.
  const { displayName, username } = getUserInfo()
  // Only a SIGNED-IN read volunteers an identity. A public page renders with the anonymous transport
  // and is the page anyone sees, so the identity an earlier sign-in left in storage must not ride on
  // its reads either — it would also tell the RESTActions who is looking.
  const injectIdentity = !config?.api.SNOWPLOW_IDENTITY_INJECTION && transport.identity === 'signed-in'
  const extrasParam = buildExtrasParam(widgetSearchParams, routeParams, displayName, username, injectIdentity, callerExtras, fragmentExtras)
  const queryClient = useQueryClient()
  // The PAGE ROOT hands its children the fragment extras its own answer declares (WidgetRenderer:
  // FragmentExtrasProvider value=pickFragment(pageRoot.fragment, fragmentKeysOf(root))), so the
  // children prefetch must read them with those, not with the root's (none: the root is read before
  // its declaration is known). Every other widget hands its own on unchanged.
  const pageRoot = usePageRoot()
  const isPageRoot = !!pageRoot && pageRoot.endpoint === widgetEndpoint

  const widgetFullUrl = `${config!.api.SNOWPLOW_API_BASE_URL}${widgetEndpoint}`
  // The widget's `/call` query, for its export (`exportRequestFor`); null when it is not a /call read.
  const exportReadQuery = getCallReadQuery(widgetEndpoint)
  const requestUrl = new URL(widgetFullUrl)

  // Per-widget live-refresh (snowplow `/refreshes` SSE). The `widgetId` is the
  // serialized query key — stable per (endpoint, extras) — used to key the captured
  // refresh headers and arm the stream. ON by default; per-install kill-switch in config
  // (see refreshSse.isWidgetLiveRefreshEnabled). A live stream is a signed-in channel (it
  // authenticates with the session's bearer), so a transport that is not `live` — a public page's —
  // never arms one, and never records the headers that would.
  //
  // A widget reading with extras in the body does not arm either: the refresh coordinates are built
  // from the request URL's query, which then does not carry the extras the read was made with.
  const refreshEnabled = isWidgetLiveRefreshEnabled(config) && transport.live && !extrasInBody
  const widgetId = JSON.stringify(['widgets', widgetEndpoint, extrasParam])

  /* TO DEBUG BEFORE SNOWPLOW RETURNS THESE IN THE widgetEndpoint */
  // if (requestUrl.searchParams.get('resource') === 'datagrids') {
  //   requestUrl.searchParams.set('page', '1')
  //   requestUrl.searchParams.set('perPage', '1')
  // }

  const endpointPage = parseNumberParam(requestUrl.searchParams.get('page'))
  const endpointPerPage = parseNumberParam(requestUrl.searchParams.get('perPage'))

  // Classic server-side pager, bounded by whichever window is in play — today the CHART's declared
  // slice (the compositions table), or a caller's `defaultPageSize` if one ever supplies one. With
  // no window in play, snowplow's -1/-1 full-set sentinel stands. `serverPage` is client state so
  // the Table's pager can jump to any page; it is part of the react-query key so each page is its
  // own (per-page-cached, snowplow-L1-aligned) entry.
  const [serverPage, setServerPage] = useState(endpointPage ?? 1)

  /**
   * The window size actually in play, whoever supplied it — the ENDPOINT's declared slice first,
   * else the caller's `defaultPageSize`.
   *
   * This replaces a test on WHO supplied the window, and that conflation was the bug. The pager
   * used to switch itself off the moment the endpoint carried `page`/`perPage`, on the assumption
   * that endpoint-supplied pagination meant infinite scroll. It does not: a declared slice is a
   * BOUNDED window exactly like a client-chosen one, and the distinction that matters to every
   * behaviour below is bounded vs unbounded.
   *
   * Left as it was, a chart declaring `resourcesRefs.items[].slice` (portal#235) would fall through
   * to the infinite-scroll branch — which snowplow's `status.resourcesRefs.slice.continue` keeps
   * alive — and re-grow the un-virtualized DOM toward the full set this pager exists to bound,
   * while the pager controls silently vanished.
   *
   * NOW LIVE, AND INVERTED FROM HOW IT SHIPPED. When written this was a deliberate no-op: no
   * chart declared a slice, so `endpointPerPage` was undefined everywhere and the window always
   * came from `defaultPageSize`. BOTH halves have since flipped. The per-resource page-size
   * registry was retired (2f5554e, #309 step C), so nothing in the SPA passes `defaultPageSize`
   * at all; and `flex.page-compositions` declares `slice {page: 1, perPage: 50}` — the one ref
   * among 41 table CRs that declares one. So `endpointPerPage` is the LIVE branch, for the
   * compositions table, and `defaultPageSize` is the dormant one. Verified on 057: prewarm keys
   * (50,1), the browser requests (50,1), L1 hits.
   *
   * The comment is corrected rather than deleted because its wrongness was the point of
   * portal#235: that issue's cause was a premise ("the frontend's first request URL carries no
   * slice params") which lived only in a comment and silently became false.
   */
  const boundedPerPage = boundedWindow(endpointPerPage, defaultPageSize)
  const usesClassicPager = typeof boundedPerPage === 'number'
  const initialPerPage = usesClassicPager ? boundedPerPage : endpointPerPage
  const initialPage = usesClassicPager ? serverPage : endpointPage

  // The read this widget's query makes (./widgetRequest), the same one a parent's prefetch makes. The
  // key is (endpoint, extras[, page]); the read is a function of those plus the install's base URL
  // and the transport in context, exactly as the inline fetch it replaces was.
  // On the answer, the reads of the children it draws on first render start at once, under the keys
  // their own queries use, instead of after this widget renders and they mount (./prefetchChildren).
  async function fetchPage(pageParam: { page?: number; perPage?: number }) {
    const read: WidgetRead = { extrasInBody, extrasParam, refreshWidgetId: refreshEnabled ? widgetId : undefined, transport, url: widgetFullUrl }
    const widget = await fetchWidgetPage(read, pageParam)
    // What a child rendered by RefChild sends: this widget's envelope without its caller extras (a
    // child carries none), with the fragment extras the child will be handed.
    const childFragment = isPageRoot && pageRoot && typeof widget.status === 'object' ? pickFragment(pageRoot.fragment, fragmentKeysOf(widget)) : fragmentExtras
    const childExtrasInBody = Object.keys(childFragment).length > 0
    // This widget's own query: still observed means still displayed (see ChildReadContext.isWanted).
    const ownKey = widgetQueryKey(widgetEndpoint, extrasParam, usesClassicPager ? serverPage : undefined)
    prefetchChildren(queryClient, widget, {
      isWanted: () => (queryClient.getQueryCache().find({ exact: true, queryKey: ownKey })?.getObserversCount() ?? 0) > 0,
      baseUrl: config!.api.SNOWPLOW_API_BASE_URL,
      childExtrasParam: buildExtrasParam(widgetSearchParams, routeParams, displayName, username, injectIdentity, EMPTY_CALLER_EXTRAS, childFragment),
      extrasInBody: childExtrasInBody,
      liveRefresh: isWidgetLiveRefreshEnabled(config) && transport.live && !childExtrasInBody,
      search: widgetSearchParams,
      transport,
    })
    return widget
  }

  const queryResult = useInfiniteQuery({
    // In classic-pager mode `serverPage` is part of the key so each page is a
    // distinct, independently-cached query (jumping pages re-inits the infinite
    // query with the new page as its only page). Non-paged widgets keep the
    // stable 3-tuple key so their cache identity is unchanged.
    queryKey: widgetQueryKey(widgetEndpoint, extrasParam, usesClassicPager ? serverPage : undefined),
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    // Override the global `retry: false` for widget data: a backend that is not
    // ready yet should keep showing a loading state and retry, not flash the
    // error "red cross" on first paint. See shouldRetryWidgetFetch.
    // Evaluated at failure time, not render time: the flag is only true while a frame-triggered
    // refetch is actually in flight, which is exactly the window this decision belongs to.
    retry: (failureCount: number, error: unknown) => shouldRetryWidgetFetch(failureCount, error, wasRefetchEventTriggered(widgetId)),
    retryDelay: widgetFetchRetryDelay,
    initialPageParam: {
      page: initialPage,
      perPage: initialPerPage,
    },
    getNextPageParam: (lastPage, _allPages, pageParams) => {
      if (typeof pageParams.page !== 'number') {
        // no initial page, so no more pages
        return undefined
      }

      // Classic-pager mode (Table): navigation is driven by `setServerPage`
      // (the pager), NOT infinite-scroll — each page is its own query keyed by
      // `serverPage`. Never accumulate pages here: accumulating would re-grow
      // the un-virtualized DOM toward the full 60K set that this fix removes.
      if (usesClassicPager) {
        return undefined
      }

      const hasMorePages = typeof lastPage.status === 'object' && lastPage.status?.resourcesRefs?.slice?.continue === true

      if (!hasMorePages) {
        /* to signal there are not other pages */
        return undefined
      }

      return {
        page: pageParams.page + 1,
        perPage: pageParams.perPage,
      }
    },
    // Phase 1 cumulative-slice pagination: each page call returns the
    // complete widget state for the cumulative slice [0 : page * perPage]
    // of the underlying data source. No cross-page merging is needed —
    // the latest page's output IS the current state.
    //
    // The backend does all the work:
    //   - snowplow's widget resolver injects .slice into the widgetDataTemplate
    //     data source so the widget's JQ can cumulatively slice the list.
    //   - The table widget's forPath slices .list[0 : K*perPage] then sorts.
    //   - The piechart widget's indexed forPaths count items in the same
    //     cumulative slice, so values grow monotonically as pages arrive.
    select: (data) => {
      if (data.pages.length === 0) {
        // react-query initial state — return an empty Widget-shaped object
        return data.pages[0]
      }
      return data.pages[data.pages.length - 1]
    },
  })

  // NOTE: Path B (task #188) — the unconditional auto-pagination useEffect
  // that previously lived here was deleted. It fired `fetchNextPage` on
  // every commit where `hasNextPage===true`, walking ALL pages eagerly
  // regardless of viewport. This raced with — and bypassed —
  // ScrollPagination's intersection-observer-driven advance
  // (src/components/Pagination/ScrollPagination.tsx:25-29), making the
  // intersection-observer dead code. With the eager effect gone, page
  // advance is exclusively driven by ScrollPagination when its sentinel
  // enters the viewport, so list-widget cold paint only fetches page 1
  // instead of fanning out N*perPage card /calls upfront.
  //
  // Non-paginating widgets (Page, Panel, Row, Table, Markdown, etc.) are
  // unaffected: `getNextPageParam` returns undefined immediately for them
  // and ScrollPagination is only wired around DataGrid in WidgetRenderer.

  const resourcesRefsPaths = typeof queryResult.data?.status === 'object'
    ? queryResult.data.status.resourcesRefs?.items?.map((item) => item.path) ?? []
    : []

  const resourcesRefsFetching = useIsFetching({
    predicate: (query) => {
      const resourceRefPath = query.queryKey[1] as string

      if (!resourcesRefsPaths) { return false }

      return resourcesRefsPaths.includes(resourceRefPath)
    },
  })

  // Live-refresh (event firehose): a widget can declare widgetData.watch — refetch
  // this query when a matching k8s event arrives (precise, per-widget throttled by
  // the registry). Kept active regardless of the SSE path below; both converge on
  // `refetch` and react-query dedups concurrent refetches.
  const liveStatus = queryResult.data?.status
  const watch = liveStatus && typeof liveStatus === 'object'
    ? (liveStatus.widgetData as { watch?: WatchMatcher[] } | undefined)?.watch
    : undefined
  useLiveWatch(watch, queryResult.refetch)

  // Live-refresh (per-widget SSE): arm this widget on snowplow's `/refreshes` stream
  // using the coords + key captured from its `/call` response headers. Read during
  // render AFTER the resolving fetch wrote them (the resolved query re-renders us);
  // the entry is undefined until the first cache-keyed response. ON by default.
  const refreshEntry = refreshEnabled ? getRefreshEntry(widgetId) : undefined
  useWidgetLiveRefresh(widgetId, refreshEntry, queryResult.refetch, config?.api.SNOWPLOW_API_BASE_URL, refreshEnabled, transport.session)

  // Classify the query error as a TIMEOUT (deadline exceeded / canceled / 503/504) vs a
  // hard error, reusing the Freshness layer's `isTimeoutError` classifier (WidgetStates).
  // Surfaced so WidgetRenderer can drive the CALM WidgetTimeout state off this flag rather
  // than re-classifying the error itself. False whenever there is no error.
  const timedOut = queryResult.error ? isTimeoutError(queryResult.error) : false

  return {
    queryResult,
    timedOut,
    // The serialized react-query key that this widget arms the `/refreshes` stream
    // under (see refreshSse.recordRefreshHeaders / useWidgetLiveRefresh). Returned so
    // WidgetRenderer can ask `isWidgetArmed(widgetId)` for the honest live-arm state
    // that drives the FreshnessBadge, instead of a render-local `isSuccess && !isStale`
    // proxy.
    widgetId,
    isFetchingResourcesRefs: resourcesRefsFetching > 0,
    // Classic server-side pager controls (only meaningful when `defaultPageSize`
    // was set). `serverPage` is the 1-based current page; `setServerPage` jumps
    // to a page (re-keying the query → fetches that page only). `serverPageSize`
    // is the per-page window size the request used.
    serverPagination: usesClassicPager
      ? { page: serverPage, pageSize: boundedPerPage, setPage: setServerPage }
      : undefined,
    /**
     * The full URL for an EXPORT of this widget's own read, given the export query a widget
     * built from its columns (see widgets/Table/tableExport.ts).
     *
     * A capability rather than the endpoint itself, following `serverPagination.setPage`: the
     * hook owns how a widget's URL is assembled and a widget should not be handed the raw
     * endpoint to concatenate onto. Two details this gets right that a widget could not:
     *
     *  - `extras` IS carried, so the export matches what is on screen. Server-side facet and
     *    search filters shrink the row set BEFORE it reaches the widget, so an export without
     *    them would silently hand back the UNFILTERED table — the same class of quiet wrongness
     *    as an export that stops at a row bound without saying so.
     *  - `page`/`perPage` are NOT carried. snowplow re-dispatches the read with its own
     *    `page=N&perPage=500` walk and concatenates the pages, so the export covers every row
     *    rather than the slice on screen. Sending a page would fight that walk. That includes a
     *    window the widget endpoint itself carries (a ref's `slice`): getExportEndpoint drops it.
     */
    exportRequestFor: exportReadQuery === null
      ? undefined
      : (exportQuery: string): { url: string; extras: string | null } => ({
        // `extras` is NOT put on the URL. snowplow's POST /export takes it in the body
        // (`{"extras": …}`, the same envelope and decoder as POST /call/read), which removes the URL
        // length ceiling a large filter would otherwise hit — a Marketplace facet selection with
        // many chips is the realistic case. A stray `?extras=` on a POST is ignored by snowplow, so
        // sending it in both places would be silently redundant rather than harmlessly belt-and-braces.
        extras: extrasParam || null,
        // The PATH is snowplow's /export, not the widget's /call: a POST to /call is snowplow's write
        // passthrough (a create on the widget's resource, answered 400 by the apiserver). Everything
        // else stays on the query: the widget's own identifying params, verbatim from its endpoint
        // (NOT from a request URL, which fetchWidgetPage sets page/perPage/extras on) less any
        // page/perPage window the endpoint itself carries (getExportEndpoint), plus the export's
        // (`format`, `path`, `fields`, repeated `header`, `title`).
        url: `${config!.api.SNOWPLOW_API_BASE_URL}${getExportEndpoint(exportReadQuery, exportQuery)}`,
      }),
  }
}
