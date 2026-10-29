/**
 * useSearchTypeahead — inline results for the ⌘K palette (UX audit #22).
 *
 * As the user types, debounce ~300ms and fetch the SAME `global-search` data the
 * /search page renders, then surface the top hits inline in the palette. The
 * endpoint is resolved DATA-DRIVEN from the route table: `menuRoutes` (RoutesContext,
 * built from the INIT nav) maps `/search` → its content endpoint (today the
 * `listies/search-results` ref from the Menu's resourcesRefs; historically the
 * convention `flexes/page-search`). When the routed endpoint is a container
 * (Flex) rather than the Listy itself, we follow its `resourcesRefs` to the
 * `listies` ref — so the palette keeps working under either nav shape without
 * hardcoding a /call URL.
 *
 * The widget /call forwards `?extras={"q":"<term>"}` — exactly what the /search
 * page's `?q=` produces (snowplow feeds extras into the `global-search`
 * RESTAction jq; the widget declares `keyExtras: [q]` so its snowplow L1 cache
 * partitions by the term). Identity extras are deliberately NOT volunteered here:
 * the RA doesn't read them, and `keyExtras` scopes the cache cell to `q` anyway.
 *
 * `useWidgetQuery` is not reused because its extras envelope derives from the
 * BROWSER URL (searchParams + route params) — the palette term is client state
 * that must not touch the URL. The fetch below mirrors its auth contract
 * (Bearer `getAccessToken()`), and react-query caches per (endpoint, term).
 *
 * Failure policy: any fetch/shape error degrades SILENTLY to the pre-existing
 * behavior (Enter → /search?q=…) — the hook then reports zero hits, never throws.
 */
import { useQuery } from '@tanstack/react-query'

import { useConfigContext } from '../../context/ConfigContext'
import { useRoutesContext } from '../../context/RoutesContext'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import type { ResourceRef, Widget } from '../../types/Widget'
import { getAccessToken } from '../../utils/getAccessToken'

export const SEARCH_ROUTE_PATH = '/search'
export const TYPEAHEAD_DEBOUNCE_MS = 300
export const TYPEAHEAD_MAX_RESULTS = 8

/** One palette result row — the `global-search` RA's per-hit shape, as mapped into
 * the search-results Listy `dataSource` (title, subtitle, type, link). */
export type SearchHit = {
  link?: string
  subtitle?: string
  title: string
  type?: string
}

/** Loosely-shaped resolved widget: only the pieces the extractor reads. */
type ResolvedWidget = {
  status?: Widget['status']
}

/** Rows from a resolved widget's `status.widgetData.dataSource` that look like search
 * hits (a non-empty string `title`), capped at `limit`. Tolerant of ANY malformed
 * shape — the palette must degrade silently, never crash on surprising data. */
export const extractHits = (widget: unknown, limit: number = TYPEAHEAD_MAX_RESULTS): SearchHit[] => {
  const status = (widget as ResolvedWidget | null)?.status
  if (!status || typeof status !== 'object') { return [] }
  const dataSource = (status.widgetData as { dataSource?: unknown } | undefined)?.dataSource
  if (!Array.isArray(dataSource)) { return [] }
  const hits: SearchHit[] = []
  for (const row of dataSource as Record<string, unknown>[]) {
    if (hits.length >= limit) { break }
    if (!row || typeof row !== 'object' || typeof row.title !== 'string' || !row.title) { continue }
    hits.push({
      link: typeof row.link === 'string' ? row.link : undefined,
      subtitle: typeof row.subtitle === 'string' ? row.subtitle : undefined,
      title: row.title,
      type: typeof row.type === 'string' ? row.type : undefined,
    })
  }
  return hits
}

/** When the routed /search endpoint is a CONTAINER (the convention `flexes/page-search`),
 * find the GET-able `listies` ref inside its resourcesRefs (by widget name
 * `search-results` first, else the only listies ref) to follow to the rows. */
export const findListyRefPath = (widget: unknown): string | undefined => {
  const status = (widget as ResolvedWidget | null)?.status
  if (!status || typeof status !== 'object') { return undefined }
  const items = status.resourcesRefs?.items
  if (!Array.isArray(items)) { return undefined }
  const listies = items.filter((item: ResourceRef) =>
    item.allowed !== false && item.verb === 'GET' && typeof item.path === 'string' && item.path.includes('resource=listies'))
  const named = listies.find((item) => item.path.includes('name=search-results'))
  return (named ?? listies[0])?.path
}

/** GET a widget /call with the palette term as `?extras={"q":…}` under the app's
 * standard Bearer auth (same contract as useWidgetQuery's fetch). */
const fetchWidget = async (baseUrl: string, endpoint: string, term: string): Promise<unknown> => {
  const requestUrl = new URL(`${baseUrl}${endpoint}`)
  requestUrl.searchParams.set('extras', JSON.stringify({ q: term }))
  const res = await fetch(requestUrl.toString(), {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  })
  if (!res.ok) {
    throw new Error(`Search typeahead fetch failed: ${res.status}`)
  }
  return res.json() as Promise<unknown>
}

/** Fetch hits for a term: call the routed /search endpoint; if it answers with rows,
 * done — else follow its resourcesRefs to the `listies` widget (one hop max). */
export const fetchSearchHits = async (baseUrl: string, endpoint: string, term: string): Promise<SearchHit[]> => {
  const widget = await fetchWidget(baseUrl, endpoint, term)
  const hits = extractHits(widget)
  if (hits.length > 0) { return hits }
  const listyPath = findListyRefPath(widget)
  if (!listyPath || listyPath === endpoint) { return hits }
  return extractHits(await fetchWidget(baseUrl, listyPath, term))
}

export type SearchTypeahead = {
  /** Top hits for the debounced term (empty while typing, on error, or with no term). */
  hits: SearchHit[]
  /** A typeahead request is in flight (subtle loading cue). */
  isFetching: boolean
  /** The debounced term settled, the fetch succeeded, and found nothing. */
  isEmpty: boolean
}

export const useSearchTypeahead = (term: string): SearchTypeahead => {
  const { config } = useConfigContext()
  const { menuRoutes } = useRoutesContext()
  const debouncedTerm = useDebouncedValue(term.trim(), TYPEAHEAD_DEBOUNCE_MS)

  // The /search route's content endpoint, exactly as WidgetPage would resolve it
  // (structured resourceRef first, then the convention endpoint). Absent (e.g. the
  // nav has no /search route, or routes are still loading) → typeahead disabled,
  // the palette silently keeps its Enter-only behavior.
  const searchRoute = menuRoutes.find(({ path }) => path === SEARCH_ROUTE_PATH)
  const endpoint = searchRoute?.resourceRef?.path || searchRoute?.endpoint || ''
  const baseUrl = config?.api.SNOWPLOW_API_BASE_URL ?? ''
  const enabled = Boolean(debouncedTerm && endpoint && baseUrl)

  const { data, isError, isFetching, isSuccess } = useQuery({
    enabled,
    gcTime: 5 * 60 * 1000,
    queryFn: () => fetchSearchHits(baseUrl, endpoint, debouncedTerm),
    // Cached per (endpoint, term): retyping a term within staleTime answers instantly
    // from the react-query cache (snowplow's own L1 is partitioned by `q` via keyExtras).
    queryKey: ['palette-search', baseUrl, endpoint, debouncedTerm],
    // Fail fast + silent: one shot, no retries — on error the palette just shows no
    // inline results and Enter still routes to /search?q=… (the pre-typeahead behavior).
    retry: false,
    staleTime: 30 * 1000,
  })

  const hits = enabled && !isError && data ? data : []
  return {
    hits,
    isEmpty: enabled && isSuccess && hits.length === 0,
    isFetching: enabled && isFetching,
  }
}
