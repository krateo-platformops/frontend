/**
 * PREFETCH CHILDREN ON ANSWER (approved by Diego 2026-11-22).
 *
 * A child's /call used to leave only after its parent's answer had been rendered and the child had
 * mounted: 22 ms after the landing's first round and 12-13 ms after each later one on the profiled
 * landing (1.8.69, stubbed snowplow), and ~72 ms a round on 057's heavier pages (snowplow's bench).
 * So the moment a widget's answer arrives, this starts the reads of the children it will draw on first
 * render (components/RefChild/renderedChildren.ts), under exactly the key each child's own query uses
 * (hooks/widgetRequest.ts). The child then finds its answer in the cache, or the read in flight, and
 * makes none of its own (react-query dedups by key; staleTime 30 s keeps it fresh until mount).
 *
 * What is not prefetched, so nothing is read that would not have been:
 *   - kinds that are not containers, and children a container does not draw on first render;
 *   - a ref that is not allowed, carries an error (a failed part), or is not a GET;
 *   - a paged child (its endpoint carries page/perPage): it keeps fetching on mount (v1);
 *   - a key already cached or in flight.
 * A failed prefetch is not retried here: it leaves an error entry, and the child's own query retries
 * on mount exactly as it does without a prefetch. A prefetched child prefetches its own children, so
 * the whole first-render tree is in flight, each level as soon as its parent answers.
 */
import type { QueryClient } from '@tanstack/react-query'

import { renderedChildRefIds } from '../components/RefChild/renderedChildren'
import type { WidgetTransport } from '../transport/widgetTransport'
import type { Widget } from '../types/Widget'

import { fetchWidgetPage, type WidgetRead, widgetQueryKey } from './widgetRequest'

/** What a child's read shares with its parent's: the install, the transport, and the extras a widget with no caller extras sends. */
export interface ChildReadContext {
  readonly baseUrl: string
  /** buildExtrasParam with NO caller extras: what a child rendered by RefChild sends. */
  readonly childExtrasParam: string
  readonly extrasInBody: boolean
  readonly liveRefresh: boolean
  /** The search params the parent's widgets see (Tabs reads `?tab=` from them). */
  readonly search: URLSearchParams
  readonly transport: Pick<WidgetTransport, 'fetch' | 'onUnauthorized'>
}

const PAGED = /[?&](page|perPage)=/

/** The endpoints of the children `widget` draws on first render, that a prefetch may read. */
export const prefetchableChildEndpoints = (widget: Widget, search: URLSearchParams): string[] => {
  const status = typeof widget.status === 'object' ? widget.status : undefined
  if (!status) { return [] }
  const refs = status.resourcesRefs?.items ?? []
  return renderedChildRefIds(widget.kind, status.widgetData, search).flatMap((id) => {
    const ref = refs.find((item) => item.id === id)
    if (!ref || !ref.allowed || ref.error || ref.verb !== 'GET' || !ref.path || PAGED.test(ref.path)) { return [] }
    return [ref.path]
  })
}

/**
 * A child's page fetch for one read, then `onAnswer` with what came back. The key (endpoint, child
 * extras) determines the read; the base URL and the transport are the query client's own, as in
 * useWidgetQuery's fetchPage.
 */
const childPages = (read: WidgetRead, onAnswer: (widget: Widget) => void) => async ({ pageParam }: { pageParam: { page?: number; perPage?: number } }) => {
  const widget = await fetchWidgetPage(read, pageParam)
  onAnswer(widget)
  return widget
}

export const prefetchChildren = (queryClient: QueryClient, widget: Widget, context: ChildReadContext): void => {
  // A prefetched child prefetches ITS first-render children in turn, with the same context: only the
  // page root changes the context it hands down, and the page root is never a prefetched child (the
  // route reads it). Without this the gain stopped one level down (the landing's sider Flex was
  // prefetched; its logo still waited a render).
  const prefetch = (parent: Widget): void => {
    for (const endpoint of prefetchableChildEndpoints(parent, context.search)) {
      const queryKey = widgetQueryKey(endpoint, context.childExtrasParam)
      if (queryClient.getQueryState(queryKey)) { continue }
      const refreshWidgetId = context.liveRefresh ? JSON.stringify(queryKey) : undefined
      const read: WidgetRead = { extrasInBody: context.extrasInBody, extrasParam: context.childExtrasParam, refreshWidgetId, transport: context.transport, url: `${context.baseUrl}${endpoint}` }
      const initialPageParam: { page?: number; perPage?: number } = {}
      void queryClient.prefetchInfiniteQuery({ initialPageParam, queryFn: childPages(read, prefetch), queryKey, retry: false })
    }
  }
  prefetch(widget)
}
