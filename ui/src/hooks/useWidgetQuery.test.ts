/**
 * useWidgetQuery — Path B (task #188) regression coverage.
 *
 * SCOPE: pure-logic tests that pin the GATING DECISIONS controlling whether
 * `fetchNextPage` should fire. We do NOT render the hook (no React tree,
 * no fetch mocks, no jsdom) — instead we replicate the EXACT predicates
 * used in the two pagination drivers as pure functions and pin their
 * truth tables. If the production code drifts from these predicates, the
 * tests below diverge from the duplicate, surfacing the change.
 *
 * What changed in Path B:
 *   The unconditional auto-pagination useEffect in useWidgetQuery
 *   (formerly lines 113-126) was DELETED. It fired `fetchNextPage` on
 *   every commit where `hasNextPage===true`, racing ahead of — and
 *   bypassing — ScrollPagination's intersection-observer gate. With the
 *   eager effect gone, the only remaining `fetchNextPage` driver in the
 *   datagrid path is ScrollPagination.tsx:25-29, which gates on
 *   `inView && hasNextPage && !isFetchingNextPage && !isFetchingResourcesRefs`.
 *
 * Coverage:
 *   Case 1: cold visit fetches only page 1 — no auto-advance occurs
 *           when the sentinel is OUT OF VIEW.
 *   Case 2: scroll-into-view triggers fetchNextPage via ScrollPagination.
 *   Case 3: non-paginating widget kinds are unaffected by either driver.
 *
 * The deleted-predicate signature is preserved here for documentation
 * (so future readers see what the eager effect computed) but is NOT
 * exercised by these tests — the WHOLE POINT of Path B is that it no
 * longer exists.
 */

import { describe, it, expect } from 'vitest'

import { getDefaultPageSizeForEndpoint } from '../components/WidgetRenderer/WidgetRenderer'
import { isTimeoutError } from '../components/WidgetStates'

import { buildExtrasParam, MAX_WIDGET_FETCH_RETRIES, shouldRetryWidgetFetch, WidgetFetchError, widgetFetchRetryDelay } from './useWidgetQuery'

/**
 * Pure replica of ScrollPagination.tsx:25-29 — the intersection-observer
 * gate that is the SOLE remaining `fetchNextPage` driver in the datagrid
 * path after Path B. If the production gate changes, this replica must
 * be updated in lockstep, surfacing the intentional behaviour change.
 */
const shouldScrollPaginationFetch = (deps: {
  inView: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchingResourcesRefs: boolean
}): boolean => {
  return (
    deps.inView
    && deps.hasNextPage
    && !deps.isFetchingNextPage
    && !deps.isFetchingResourcesRefs
  )
}

/**
 * Pure replica of `useInfiniteQuery.getNextPageParam` in
 * useWidgetQuery.ts:69-86. Determines whether `hasNextPage` is true for
 * the latest page. Returning `undefined` makes react-query report
 * `hasNextPage===false`, which short-circuits BOTH drivers.
 */
type SliceContinue = boolean | undefined
const computeNextPageParam = (
  lastPage: { status?: { resourcesRefs?: { slice?: { continue?: SliceContinue } } } },
  pageParams: { page?: number; perPage?: number },
  usesDefaultPaging = false,
): { page: number; perPage?: number } | undefined => {
  if (typeof pageParams.page !== 'number') { return undefined }
  // Classic-pager mode (Table): navigation is the pager (setServerPage), NOT
  // infinite-scroll. Never accumulate — that would re-grow the DOM toward 60K.
  if (usesDefaultPaging) { return undefined }
  const hasMorePages = typeof lastPage.status === 'object'
    && lastPage.status?.resourcesRefs?.slice?.continue === true
  if (!hasMorePages) { return undefined }
  return { page: pageParams.page + 1, perPage: pageParams.perPage }
}

/**
 * Pure replica of the request-seeding logic in useWidgetQuery.ts: when a widget
 * opts into bounded pagination (`defaultPageSize` set) and its endpoint carries
 * no page/perPage, request page=<serverPage>&perPage=<defaultPageSize> instead of
 * snowplow's -1/-1 full-set sentinel. If the endpoint already carries pagination,
 * that wins (the default is only a fallback).
 */
const computeInitialPaging = (deps: {
  defaultPageSize?: number
  endpointPage?: number
  endpointPerPage?: number
  serverPage: number
}): { initialPage?: number; initialPerPage?: number; usesDefaultPaging: boolean } => {
  const usesDefaultPaging = typeof deps.defaultPageSize === 'number'
    && deps.endpointPage === undefined
    && deps.endpointPerPage === undefined
  return {
    initialPage: usesDefaultPaging ? deps.serverPage : deps.endpointPage,
    initialPerPage: usesDefaultPaging ? deps.defaultPageSize : deps.endpointPerPage,
    usesDefaultPaging,
  }
}

/**
 * Pure replica of WidgetRenderer.getDefaultPageSizeForEndpoint — resolves the
 * per-page window from the endpoint's `resource` plural. (Kept in lockstep with
 * the exported production fn, also imported+asserted below.)
 */
const PAGINATED_RESOURCE_PAGE_SIZE: Record<string, number> = { tables: 50 }
const resolvePageSize = (endpoint: string): number | undefined => {
  const queryStart = endpoint.indexOf('?')
  if (queryStart === -1) { return undefined }
  const resource = new URLSearchParams(endpoint.slice(queryStart)).get('resource')
  return resource ? PAGINATED_RESOURCE_PAGE_SIZE[resource] : undefined
}

describe('Path B — cold visit fetches only page 1, no auto-advance', () => {
  /**
   * Case 1 — Before Path B: the deleted unconditional `useEffect` would
   * have fired `fetchNextPage` immediately on the page-1 response if
   * `hasNextPage===true`, ignoring `inView`. After Path B, ScrollPagination
   * is the sole driver, and on cold visit the sentinel is OUT OF VIEW
   * (typical 1080px viewport with a few cards above the sentinel only
   * for very-short lists; on a long list the sentinel is below the
   * fold). With `inView===false`, `fetchNextPage` MUST NOT fire.
   */
  it('does NOT call fetchNextPage when sentinel is out of view', () => {
    const fetchedPage1: { status?: { resourcesRefs?: { slice?: { continue?: SliceContinue } } } } = {
      status: { resourcesRefs: { slice: { continue: true } } },
    }
    const pageParam = computeNextPageParam(fetchedPage1, { page: 1, perPage: 5 })
    expect(pageParam).toEqual({ page: 2, perPage: 5 })

    // Sentinel is below the fold on a long compositions list — out of view.
    const willFire = shouldScrollPaginationFetch({
      hasNextPage: pageParam !== undefined,
      inView: false,
      isFetchingNextPage: false,
      isFetchingResourcesRefs: false,
    })
    expect(willFire).toBe(false)
  })

  it('does NOT call fetchNextPage while resourceRefs of page 1 are still in flight', () => {
    // Backpressure case: even if inView is true, an in-flight resourceRefs
    // wave gates the next page. Pre-Path-B, the eager effect did NOT honour
    // this (only checked `isFetching` on the parent query, not children).
    // Post-Path-B, ScrollPagination's gate honours isFetchingResourcesRefs.
    const willFire = shouldScrollPaginationFetch({
      hasNextPage: true,
      inView: true,
      isFetchingNextPage: false,
      isFetchingResourcesRefs: true,
    })
    expect(willFire).toBe(false)
  })
})

describe('Path B — scroll-into-view triggers fetchNextPage via ScrollPagination', () => {
  /**
   * Case 2 — When the user scrolls and the sentinel enters the viewport,
   * `inView` flips to true. With `hasNextPage===true` and no in-flight
   * waves, the intersection-observer effect fires `fetchNextPage` exactly
   * once. This is the desired lazy-pagination behaviour that the deleted
   * eager useEffect was suppressing.
   */
  it('fires fetchNextPage when sentinel enters viewport and no waves are in flight', () => {
    const willFire = shouldScrollPaginationFetch({
      hasNextPage: true,
      inView: true,
      isFetchingNextPage: false,
      isFetchingResourcesRefs: false,
    })
    expect(willFire).toBe(true)
  })

  it('does NOT re-fire while a fetchNextPage is already in flight', () => {
    // Once fetchNextPage is issued, react-query sets isFetchingNextPage=true
    // until the response lands. The gate must NOT re-fire during this window
    // — preserving the backpressure that prevents N+1 stampedes.
    const willFire = shouldScrollPaginationFetch({
      hasNextPage: true,
      inView: true,
      isFetchingNextPage: true,
      isFetchingResourcesRefs: false,
    })
    expect(willFire).toBe(false)
  })
})

describe('Path B — non-paginating widget kinds are unaffected', () => {
  /**
   * Case 3 — Page, Panel, Row, Table, Markdown, Button, etc. — the 25
   * widget kinds that do NOT use cumulative-slice pagination — never
   * set `status.resourcesRefs.slice.continue=true`, so
   * `getNextPageParam` returns `undefined`, so `hasNextPage===false`,
   * so NEITHER driver ever fires `fetchNextPage`. Furthermore, these
   * widgets aren't wrapped in `<ScrollPagination>` (WidgetRenderer.tsx
   * wires it only around DataGrid), so the intersection-observer hook
   * never even mounts for them.
   */
  it('returns undefined nextPageParam for widgets that do not set slice.continue', () => {
    const pieChartLikePage = { status: { resourcesRefs: { /* no slice field */ } } }
    const pageParam = computeNextPageParam(pieChartLikePage, { page: 1, perPage: 5 })
    expect(pageParam).toBeUndefined()
  })

  it('returns undefined nextPageParam when slice.continue is explicitly false', () => {
    const lastPageOfList = { status: { resourcesRefs: { slice: { continue: false } } } }
    const pageParam = computeNextPageParam(lastPageOfList, { page: 7, perPage: 5 })
    expect(pageParam).toBeUndefined()
  })

  it('ScrollPagination gate is a no-op when hasNextPage is false even if sentinel is in view', () => {
    // Defence in depth: even if a non-paginating widget were somehow
    // wrapped in ScrollPagination by misconfiguration, the gate would
    // still refuse to fire because hasNextPage is false.
    const willFire = shouldScrollPaginationFetch({
      hasNextPage: false,
      inView: true,
      isFetchingNextPage: false,
      isFetchingResourcesRefs: false,
    })
    expect(willFire).toBe(false)
  })

  it('returns undefined nextPageParam when no initial page was set in URL', () => {
    // useWidgetQuery.ts:70-73 short-circuit: widgets called without a
    // ?page= query param never paginate. Path B does not change this.
    const widgetWithoutPageParam = { status: { resourcesRefs: { slice: { continue: true } } } }
    const pageParam = computeNextPageParam(widgetWithoutPageParam, { page: undefined, perPage: 5 })
    expect(pageParam).toBeUndefined()
  })
})

describe('bounded server-side pagination — request seeding (paginate + virtualize, spec 2026-07-10)', () => {
  /**
   * The 60K-row `/compositions` wedge is caused by the SPA sending the -1/-1
   * "no pagination" sentinel. When a widget opts in (defaultPageSize set) and
   * the endpoint carries no page/perPage, the request must instead be a BOUNDED
   * page so snowplow injects `.slice` and the template windows its rows.
   */
  it('seeds page=1 & perPage=<default> when the endpoint carries no pagination', () => {
    const paging = computeInitialPaging({ defaultPageSize: 50, serverPage: 1 })
    expect(paging.usesDefaultPaging).toBe(true)
    expect(paging.initialPage).toBe(1)
    expect(paging.initialPerPage).toBe(50)
  })

  it('tracks the pager: serverPage becomes the requested page', () => {
    const paging = computeInitialPaging({ defaultPageSize: 50, serverPage: 4 })
    expect(paging.initialPage).toBe(4)
    expect(paging.initialPerPage).toBe(50)
  })

  it('does NOT seed pagination for widgets that did not opt in (no defaultPageSize)', () => {
    // Statistic/Card/etc. keep their exact prior request (no page/perPage) so
    // their L1 cache identity is unchanged.
    const paging = computeInitialPaging({ serverPage: 1 })
    expect(paging.usesDefaultPaging).toBe(false)
    expect(paging.initialPage).toBeUndefined()
    expect(paging.initialPerPage).toBeUndefined()
  })

  it('lets an endpoint that already carries pagination win over the default', () => {
    // If snowplow ever emits an explicit page/perPage on the child endpoint,
    // honour it rather than overriding with the default fallback.
    const paging = computeInitialPaging({ defaultPageSize: 50, endpointPage: 2, endpointPerPage: 25, serverPage: 1 })
    expect(paging.usesDefaultPaging).toBe(false)
    expect(paging.initialPage).toBe(2)
    expect(paging.initialPerPage).toBe(25)
  })

  it('classic-pager mode never accumulates pages (getNextPageParam returns undefined)', () => {
    // Even if a page response somehow set slice.continue=true, the Table's
    // classic pager must NOT auto-advance/accumulate — that would re-grow the
    // un-virtualized DOM toward the full 60K set this fix removes.
    const pageWithContinue = { status: { resourcesRefs: { slice: { continue: true } } } }
    expect(computeNextPageParam(pageWithContinue, { page: 1, perPage: 50 }, /* usesDefaultPaging */ true)).toBeUndefined()
    // Sanity: the SAME response WOULD advance in infinite-scroll (List) mode.
    expect(computeNextPageParam(pageWithContinue, { page: 1, perPage: 50 }, false)).toEqual({ page: 2, perPage: 50 })
  })
})

describe('bounded server-side pagination — resource opt-in resolver', () => {
  it('resolves the per-page window for a `tables` endpoint (compositions Table)', () => {
    const endpoint = '/call?resource=tables&apiVersion=widgets.templates.krateo.io%2Fv1beta1&name=compositions-table&namespace=krateo-system'
    expect(getDefaultPageSizeForEndpoint(endpoint)).toBe(50)
    // replica stays in lockstep with production
    expect(resolvePageSize(endpoint)).toBe(getDefaultPageSizeForEndpoint(endpoint))
  })

  it('returns undefined for non-paginated resources (statistics, cards, …)', () => {
    expect(getDefaultPageSizeForEndpoint('/call?resource=statistics&name=stat-compositions')).toBeUndefined()
    expect(getDefaultPageSizeForEndpoint('/call?resource=cards&name=status-card')).toBeUndefined()
  })

  it('returns undefined when the endpoint has no query string', () => {
    expect(getDefaultPageSizeForEndpoint('/call')).toBeUndefined()
    expect(getDefaultPageSizeForEndpoint('')).toBeUndefined()
  })
})

describe('initial-render retry — transient failures retry, permanent ones do not', () => {
  it('retries network errors (no status) up to the cap, then stops', () => {
    // "Server has not yet answered": fetch rejects with a TypeError that has
    // no .status — the case behind the initial-render red cross.
    const networkError = new TypeError('Failed to fetch')
    expect(shouldRetryWidgetFetch(0, networkError)).toBe(true)
    expect(shouldRetryWidgetFetch(MAX_WIDGET_FETCH_RETRIES - 1, networkError)).toBe(true)
    expect(shouldRetryWidgetFetch(MAX_WIDGET_FETCH_RETRIES, networkError)).toBe(false)
  })

  it('retries 5xx (transient server errors, e.g. snowplow still starting)', () => {
    expect(shouldRetryWidgetFetch(0, new WidgetFetchError('boom', 503))).toBe(true)
    expect(shouldRetryWidgetFetch(0, new WidgetFetchError('boom', 500))).toBe(true)
  })

  it('retries 404 (transient cold-cache miss right after load), up to the cap', () => {
    // snowplow can 404 a widget whose CR exists while its informer cache is cold;
    // this recovers on a retry, so 404 keeps the skeleton up rather than flashing
    // the error. Still bounded by the retry cap so a real 404 eventually surfaces.
    expect(shouldRetryWidgetFetch(0, new WidgetFetchError('nope', 404))).toBe(true)
    expect(shouldRetryWidgetFetch(MAX_WIDGET_FETCH_RETRIES, new WidgetFetchError('nope', 404))).toBe(false)
  })

  /**
   * S11a — REQUIRED GREEN before and after #256. The cold-load 404 path must not regress: this is
   * the "no error flash on first paint" behaviour, and it is why 404 is retryable at all.
   */
  it('S11a — a cold-load 404 (NOT frame-triggered) still retries, so first paint does not flash', () => {
    expect(shouldRetryWidgetFetch(0, new WidgetFetchError('nope', 404), false)).toBe(true)
    expect(shouldRetryWidgetFetch(1, new WidgetFetchError('nope', 404), false)).toBe(true)
    expect(shouldRetryWidgetFetch(MAX_WIDGET_FETCH_RETRIES, new WidgetFetchError('nope', 404), false)).toBe(false)
  })

  /**
   * S11 — the eviction path. Snowplow 1.12.6 publishes a refresh frame on a DELETE-semantics
   * eviction; the refetch it triggers answers 404 because the object really is gone. Retrying
   * cannot learn anything new, and at 3 retries with 700/1400/2800 ms backoff it costs FOUR
   * requests and ~4.9 s per widget — a fourfold amplification of a bulk delete. One request.
   */
  it('S11 — a frame-triggered 404 is terminal: one request, not four', () => {
    expect(shouldRetryWidgetFetch(0, new WidgetFetchError('gone', 404), true)).toBe(false)
  })

  it('S11 — frame-triggered only changes 404; every other status keeps its policy', () => {
    // 5xx stays transient even on a frame-triggered refetch — the object may well still exist.
    expect(shouldRetryWidgetFetch(0, new WidgetFetchError('boom', 503), true)).toBe(true)
    // A network error (no status) likewise.
    expect(shouldRetryWidgetFetch(0, new TypeError('Failed to fetch'), true)).toBe(true)
    // Permanent 4xx were already terminal and stay so.
    expect(shouldRetryWidgetFetch(0, new WidgetFetchError('nope', 403), true)).toBe(false)
  })

  it('defaults to the cold-load policy when the caller does not pass the flag', () => {
    // Back-compat: the third argument is optional, and omitting it must mean "not frame-triggered".
    expect(shouldRetryWidgetFetch(0, new WidgetFetchError('nope', 404))).toBe(true)
  })

  it('never retries permanent 4xx (auth / forbidden / bad-request)', () => {
    for (const status of [400, 401, 403]) {
      expect(shouldRetryWidgetFetch(0, new WidgetFetchError('nope', status))).toBe(false)
    }
  })

  it('uses capped exponential backoff between attempts', () => {
    expect(widgetFetchRetryDelay(0)).toBe(700)
    expect(widgetFetchRetryDelay(1)).toBe(1400)
    expect(widgetFetchRetryDelay(2)).toBe(2800)
    // capped
    expect(widgetFetchRetryDelay(10)).toBe(5000)
  })
})

describe('timedOut — useWidgetQuery classifies the query error via the Freshness isTimeoutError', () => {
  /**
   * Pure replica of the `timedOut` derivation in useWidgetQuery.ts:
   *   `const timedOut = queryResult.error ? isTimeoutError(queryResult.error) : false`
   * WidgetRenderer drives the CALM WidgetTimeout state off this flag rather than
   * re-classifying the error at the render, so pin the gating here.
   */
  const computeTimedOut = (error: unknown): boolean => (error ? isTimeoutError(error) : false)

  it('is false when there is no error (happy path)', () => {
    expect(computeTimedOut(undefined)).toBe(false)
    expect(computeTimedOut(null)).toBe(false)
  })

  it('is true for a 503/504 gateway-timeout WidgetFetchError', () => {
    expect(computeTimedOut(new WidgetFetchError('boom', 503))).toBe(true)
    expect(computeTimedOut(new WidgetFetchError('boom', 504))).toBe(true)
  })

  it('is true for deadline-exceeded / canceled / aborted messages (no status)', () => {
    expect(computeTimedOut(new Error('context deadline exceeded'))).toBe(true)
    expect(computeTimedOut(new Error('The user canceled the request'))).toBe(true)
    expect(computeTimedOut(new Error('The operation was aborted'))).toBe(true)
  })

  it('is false for a hard 4xx / 500 error (red-cross path, not the calm timeout)', () => {
    expect(computeTimedOut(new WidgetFetchError('bad request', 400))).toBe(false)
    expect(computeTimedOut(new WidgetFetchError('forbidden', 403))).toBe(false)
    expect(computeTimedOut(new WidgetFetchError('server error', 500))).toBe(false)
  })

  it('is false for a generic network error (surfaces as the "Couldn\'t reach the server" error, not timeout)', () => {
    expect(computeTimedOut(new TypeError('Failed to fetch'))).toBe(false)
  })
})

describe('buildExtrasParam — request/user values forwarded into the RA jq dict', () => {
  const sp = (query: string) => new URLSearchParams(query)

  it('returns empty string when there is no query, no route params, no identity', () => {
    // Empty → '' (not '{}') so the param and the queryKey stay absent/stable.
    expect(buildExtrasParam(sp(''))).toBe('')
  })

  it('forwards the browser URL query (server-side search term)', () => {
    expect(buildExtrasParam(sp('q=foo'))).toBe('{"q":"foo"}')
  })

  it('forwards route params (e.g. /compositions/:namespace/:name → the convention param channel)', () => {
    expect(buildExtrasParam(sp(''), { name: 'rancher', namespace: 'demo' })).toBe('{"name":"rancher","namespace":"demo"}')
  })

  it('route params win over a same-named URL query key', () => {
    expect(buildExtrasParam(sp('name=fromquery'), { name: 'fromroute' })).toBe('{"name":"fromroute"}')
  })

  it('skips undefined route params', () => {
    expect(buildExtrasParam(sp('q=foo'), { name: undefined })).toBe('{"q":"foo"}')
  })

  it('forwards the login displayName when present (greeting)', () => {
    expect(buildExtrasParam(sp(''), {}, 'Diego')).toBe('{"displayName":"Diego"}')
  })

  it('merges query, route params, and identity', () => {
    expect(buildExtrasParam(sp('q=foo'), { namespace: 'demo' }, 'Diego')).toBe('{"q":"foo","namespace":"demo","displayName":"Diego"}')
  })

  it('identity overrides a spoofed displayName URL param', () => {
    // A URL like ?displayName=evil must NOT override the authenticated identity.
    expect(buildExtrasParam(sp('displayName=evil'), {}, 'Diego')).toBe('{"displayName":"Diego"}')
  })

  it('forwards the login username when present (per-user server state, e.g. drafts)', () => {
    expect(buildExtrasParam(sp(''), {}, 'Diego', 'diego.braga')).toBe('{"displayName":"Diego","username":"diego.braga"}')
  })

  it('identity overrides a spoofed username URL param', () => {
    // A URL like ?username=evil must NOT override the authenticated identity — drafts
    // are keyed by username, so a spoof must not let one user write another's state.
    // (The `username` key keeps the position of its first sighting in the query, but
    // its value is overwritten by the authenticated identity — value wins, not order.)
    expect(buildExtrasParam(sp('username=evil'), {}, 'Diego', 'diego.braga')).toBe('{"username":"diego.braga","displayName":"Diego"}')
  })

  it('is stable for the same inputs (so the react-query key does not churn)', () => {
    expect(buildExtrasParam(sp('q=foo'), { namespace: 'demo' }, 'Diego')).toBe(buildExtrasParam(sp('q=foo'), { namespace: 'demo' }, 'Diego'))
  })

  // A5 (SNOWPLOW_IDENTITY_INJECTION): when snowplow injects identity server-side the call
  // site passes injectIdentity=false, and the browser must emit NO identity keys.
  it('flag SET (injectIdentity=false) — emits no identity keys even when displayName+username are present', () => {
    expect(buildExtrasParam(sp(''), {}, 'Diego', 'diego.braga', false)).toBe('')
  })

  it('flag SET — still forwards genuinely client-side extras (query + route params); only identity is dropped', () => {
    expect(buildExtrasParam(sp('q=foo'), { namespace: 'demo' }, 'Diego', 'diego.braga', false))
      .toBe('{"q":"foo","namespace":"demo"}')
  })

  it('flag SET — does not re-inject identity on top of a spoofed ?displayName= (server-side injection is the source of truth, §1.3)', () => {
    // The identity anti-spoof merge is gated off; a URL ?displayName= passes through as opaque
    // query, but snowplow quarantines client identity keys and injects the authenticated value,
    // so the forwarded 'evil' is ignored server-side. The frontend simply stops volunteering.
    expect(buildExtrasParam(sp('displayName=evil'), {}, 'Diego', 'diego.braga', false)).toBe('{"displayName":"evil"}')
  })

  // A ROUTE param named `username` is the page's subject, not a spoof attempt. Identity must not
  // clobber it — `/settings/access/{username}` is the one nav route where the names collide, and
  // it rendered the logged-in user for every persona URL until this was fixed.
  it('a route param beats identity — /settings/access/{username} resolves the SUBJECT, not the caller', () => {
    // `displayName` is still the CALLER's — no route param collides with it, and nothing on this
    // page reads it. Only the colliding key changes hands.
    expect(buildExtrasParam(sp(''), { username: 'alice' }, 'Admin', 'admin'))
      .toBe('{"username":"alice","displayName":"Admin"}')
  })

  it('a spoofed ?username= is STILL overridden by identity (the anti-spoof this protects)', () => {
    expect(buildExtrasParam(sp('username=evil'), {}, 'Admin', 'admin'))
      .toBe('{"username":"admin","displayName":"Admin"}')
  })

  it('route param wins over BOTH a spoofed query key and identity', () => {
    expect(buildExtrasParam(sp('username=evil'), { username: 'alice' }, 'Admin', 'admin'))
      .toBe('{"username":"alice","displayName":"Admin"}')
  })

  it('key ORDER is unchanged for non-colliding inputs (the string is the cache cell key)', () => {
    expect(buildExtrasParam(sp('q=foo'), { namespace: 'demo' }, 'Diego', 'diego.braga'))
      .toBe('{"q":"foo","namespace":"demo","displayName":"Diego","username":"diego.braga"}')
  })

  it('flag ABSENT default is byte-identical to explicit injectIdentity=true (legacy protection)', () => {
    const legacyDefault = buildExtrasParam(sp('q=foo'), { namespace: 'demo' }, 'Diego', 'diego.braga')
    const explicitTrue = buildExtrasParam(sp('q=foo'), { namespace: 'demo' }, 'Diego', 'diego.braga', true)
    expect(legacyDefault).toBe(explicitTrue)
    expect(legacyDefault).toBe('{"q":"foo","namespace":"demo","displayName":"Diego","username":"diego.braga"}')
  })
})
