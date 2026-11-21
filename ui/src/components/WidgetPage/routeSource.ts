/**
 * THE ROUTE SOURCE'S STATE, read from the query cache.
 *
 * A signed-in page resolves its content only through the sidebar Menu's routes (WidgetPage). When the
 * Menu's own read fails, no route is ever registered, and until now the page kept its loading skeleton
 * forever: there was no route to resolve and nothing said why. Marketing's sandbox run 9 hit exactly
 * that (snowplow answered the menu's /call with 424; every page waited 60 s and timed out).
 *
 * The Menu is rendered by its own WidgetRenderer (the Layout's sider slot), so its query already
 * exists. This reads that query rather than fetching again: the same `['widgets', <menus /call URL>, …]`
 * entry, whatever its extras. A failure is classified with the same rules WidgetRenderer applies to a
 * widget (403, 424, the timeout statuses, an unreachable server), so the page-level state and the
 * sider's line agree with every other widget's.
 */
import type { Query, QueryClient } from '@tanstack/react-query'

import { isTimeoutError } from '../WidgetStates'

export type RouteSourceFailureKind = 'dependency' | 'forbidden' | 'timeout' | 'error'

export interface RouteSourceFailure {
  kind: RouteSourceFailureKind
  /** The HTTP status (or a Status body's code), when the failure carried one. */
  status?: number
  /** The server's own words for it, shown as they arrive. */
  detail?: string
  /** `namespace/name` of the menu the read was for, from its /call URL. */
  object?: string
}

export interface RouteSourceState {
  /** The menu read has failed and is not being retried right now… */
  failure?: RouteSourceFailure
  /** …or a retry of it is in flight (the failure stays on screen while it runs). */
  retrying: boolean
}

export const isRouteSourceQuery = (query: Pick<Query, 'queryKey'>): boolean => {
  const [scope, endpoint] = query.queryKey as [unknown, unknown]
  return scope === 'widgets' && typeof endpoint === 'string' && endpoint.includes('resource=menus')
}

const objectOf = (endpoint: string): string | undefined => {
  try {
    const params = new URL(endpoint, 'http://portal.invalid').searchParams
    const name = params.get('name')
    const namespace = params.get('namespace')
    if (!name) { return undefined }
    return namespace ? `${namespace}/${name}` : name
  } catch {
    return undefined
  }
}

const kindOf = (status: number | undefined, timedOut: boolean): RouteSourceFailureKind => {
  if (timedOut) { return 'timeout' }
  if (status === 403) { return 'forbidden' }
  // 424: the menu was found but something it reads is not installed here (snowplow#853). A 404 is the
  // same situation from before snowplow 1.12.55, and either way the navigation is absent, not broken.
  if (status === 424 || status === 404) { return 'dependency' }
  return 'error'
}

/** Classify a failed menu read, the way WidgetRenderer classifies a widget's. */
export const classifyRouteSourceFailure = (error: unknown, endpoint: string): RouteSourceFailure => {
  const status = (error as { status?: number } | null)?.status
  const detail = (error as { detail?: string } | null)?.detail
  const unreachable = error instanceof TypeError || (error instanceof Error && error.message.includes('Failed to fetch'))
  return {
    detail: unreachable ? "Couldn't reach the server. It may still be starting up." : detail,
    kind: kindOf(status, isTimeoutError(error)),
    object: objectOf(endpoint),
    status,
  }
}

interface StatusBody { kind?: string; status?: unknown; code?: number; message?: string }

/** snowplow can also answer an error IN THE BODY: a Status kind with a string status and a code. */
const bodyFailure = (data: unknown): StatusBody | undefined => {
  const first = (data as { pages?: unknown[] } | undefined)?.pages?.[0] as StatusBody | undefined
  return first && typeof first.status === 'string' && typeof first.code === 'number' && first.code >= 400 ? first : undefined
}

/**
 * The last failure seen per menu query. A RETRY of a query that never succeeded resets it to `pending`
 * and drops its error (react-query's fetch reducer does so whenever there is no data yet), so without
 * this the page would fall back to the skeleton for exactly the moment the person pressed Retry. It is
 * recorded whenever the cache reports the failure, which is every snapshot the page takes.
 */
const lastFailure = new WeakMap<Query, RouteSourceFailure>()

/** The route source's state now. Pure over the cache apart from that memory, so it tests without React. */
export const readRouteSource = (client: QueryClient): RouteSourceState => {
  const [query] = client.getQueryCache().findAll({ predicate: isRouteSourceQuery })
  if (!query) { return { retrying: false } }
  const endpoint = query.queryKey[1] as string
  const { data, error, errorUpdateCount, fetchStatus, status } = query.state
  const retrying = fetchStatus === 'fetching'
  if (status === 'error') {
    const failure = classifyRouteSourceFailure(error, endpoint)
    lastFailure.set(query, failure)
    return { failure, retrying }
  }
  // A retry of a read that has failed before and never succeeded: keep showing that failure.
  const remembered = lastFailure.get(query)
  if (status === 'pending' && retrying && errorUpdateCount > 0 && remembered) {
    return { failure: remembered, retrying: true }
  }
  const body = status === 'success' ? bodyFailure(data) : undefined
  if (body) {
    const failure: RouteSourceFailure = { detail: body.message, kind: kindOf(body.code, false), object: objectOf(endpoint), status: body.code }
    lastFailure.set(query, failure)
    return { failure, retrying }
  }
  if (status === 'success') { lastFailure.delete(query) }
  return { retrying: false }
}

/** A stable string for useSyncExternalStore: the snapshot must not be a fresh object per call. */
export const routeSourceKey = (client: QueryClient): string => JSON.stringify(readRouteSource(client))

/** Ask for the menu again: every query of the route source, whatever its extras. */
export const retryRouteSource = (client: QueryClient): Promise<void> =>
  client.refetchQueries({ predicate: isRouteSourceQuery })
