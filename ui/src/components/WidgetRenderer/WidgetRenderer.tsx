import { Suspense, useEffect } from 'react'

import { useConfigContext } from '../../context/ConfigContext'
import { isWidgetArmed, isWidgetLiveRefreshEnabled } from '../../hooks/refreshSse'
import useCatchError from '../../hooks/useCatchError'
import { useWidgetQuery } from '../../hooks/useWidgetQuery'
import type { ServerPagination, Widget } from '../../types/Widget'
import { getWidgetModule } from '../../widgets/registry'
import { useFilter } from '../FiltesProvider/FiltersProvider'
import { FreshnessBadge } from '../FreshnessBadge/FreshnessBadge'
import { ScrollPagination } from '../Pagination/ScrollPagination'
import { WidgetError, WidgetErrorBoundary, WidgetForbidden, WidgetLoading, WidgetNotFound, WidgetTimeout } from '../WidgetStates'

import styles from './WidgetRenderer.module.css'

type WidgetRendererProps = {
  invisible?: boolean
  onLoadingChange?: (isLoading: boolean) => void
  prefix?: string
  widgetEndpoint: string
  wrapper?: {
    component: React.ComponentType<{ children: React.ReactNode }>
    props?: Record<string, unknown>
  }
}

/**
 * Widget-`/call` RESOURCE plurals that render potentially-unbounded lists and so
 * default to BOUNDED server-side pagination (paginate + virtualize) instead of
 * snowplow's `-1/-1` full-set sentinel. Keyed by the `resource` query param the
 * endpoint carries (known before the fetch, unlike the widget `kind`). Value is
 * the per-page window size. `tables` covers the compositions Table — the 60K-row
 * `/compositions` wedge this map exists to prevent.
 */
const PAGINATED_RESOURCE_PAGE_SIZE: Record<string, number> = {
  tables: 50,
}

export const getDefaultPageSizeForEndpoint = (widgetEndpoint: string): number | undefined => {
  const queryStart = widgetEndpoint.indexOf('?')
  if (queryStart === -1) { return undefined }
  const resource = new URLSearchParams(widgetEndpoint.slice(queryStart)).get('resource')
  return resource ? PAGINATED_RESOURCE_PAGE_SIZE[resource] : undefined
}

const parseWidget = (
  widget: Widget,
  fetchNextPage: () => Promise<unknown> | void,
  hasNextPage: boolean,
  isFetching: boolean,
  isFetchingNextPage: boolean,
  isFetchingResourcesRefs: boolean,
  serverPagination?: ServerPagination
) => {
  if (typeof widget.status === 'string') {
    return null
  }

  const {
    kind,
    metadata,
    status: { resourcesRefs, widgetData },
  } = widget

  const props = {
    resourcesRefs: { ...resourcesRefs, items: resourcesRefs?.items?.filter(({ allowed }) => allowed) ?? [] },
    // Classic server-side pager controls, threaded down to widgets that opt into
    // bounded pagination (e.g. the compositions Table). Undefined for all others.
    serverPagination,
    uid: metadata.uid,
  }

  const module = getWidgetModule(kind)

  if (!module) {
    throw new Error(`Unknown widget kind: ${kind}`)
  }

  const Component = module.component
  // Suspense boundary so lazy-loaded widgets (e.g. the chart widgets, which
  // code-split the heavy G2 bundle) show the loading state while their chunk loads.
  const element = (
    <Suspense fallback={<WidgetLoading />}>
      <Component {...props} widget={widget} widgetData={widgetData} />
    </Suspense>
  )

  if (module.paginated) {
    return (
      <ScrollPagination
        fetchNextPage={fetchNextPage}
        hasNextPage={hasNextPage}
        isFetching={isFetching}
        isFetchingNextPage={isFetchingNextPage}
        isFetchingResourcesRefs={isFetchingResourcesRefs}
      >
        {element}
      </ScrollPagination>
    )
  }

  return element
}

const WidgetRenderer = ({ invisible = false, onLoadingChange, prefix, widgetEndpoint, wrapper }: WidgetRendererProps) => {
  const { isWidgetFilteredByProps } = useFilter()
  const { catchError } = useCatchError()
  const { config } = useConfigContext()

  if (!widgetEndpoint?.includes('widgets.templates.krateo.io')) {
    console.warn(`WidgetRenderer received widgetEndpoint=${widgetEndpoint}, which is probably invalid. An url is expected.`)
  }

  // Bounded server-side pagination is opt-in by RESOURCE PLURAL (the `resource`
  // param on the widget's `/call` endpoint), resolved BEFORE the fetch — the
  // widget `kind` is only known after the response, but the plural is in the URL.
  // Keeps `useWidgetQuery` generic; the opt-in set is one explicit, greppable map.
  const defaultPageSize = getDefaultPageSizeForEndpoint(widgetEndpoint)

  const { isFetchingResourcesRefs, queryResult, serverPagination, timedOut, widgetId } = useWidgetQuery(widgetEndpoint, { defaultPageSize })
  const { data: widget, dataUpdatedAt, error, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage, isLoading, isPending, isStale, refetch } = queryResult

  // Freshness signal fed to the FreshnessBadge overlaid on the rendered widget.
  // `liveArmed` is the HONEST arm-state: this widget currently has a live `/refreshes`
  // subscription open on the tab-wide stream (isWidgetArmed(widgetId)), so the green
  // "Live" dot means a push channel is genuinely open — not merely that the last fetch
  // succeeded. Replaces the earlier render-local `isSuccess && !isStale` proxy.
  const liveRefreshEnabled = isWidgetLiveRefreshEnabled(config)
  const liveArmed = liveRefreshEnabled && isWidgetArmed(widgetId)

  useEffect(() => {
    if (onLoadingChange) {
      onLoadingChange(isLoading)
    }
  }, [isLoading, onLoadingChange])

  // `isPending` (not `isLoading`) keeps the loading state visible across retry
  // backoff gaps, so a not-yet-ready backend shows a skeleton — not the error
  // "red cross" — until retries are exhausted (see useWidgetQuery retry config).
  if (isPending) {
    return <WidgetLoading />
  }

  if (error) {
    console.error(error)
    // A slow/still-warming server (request deadline, cancelled fetch, 503/504) gets a
    // CALM, distinct timeout state — not the hard-error red cross — with a working Retry.
    // `timedOut` is the Freshness layer's classification of THIS error (useWidgetQuery),
    // reused here instead of re-classifying at the render.
    if (timedOut) {
      return <WidgetTimeout onRetry={() => { void refetch() }} />
    }

    // The server ANSWERED, and the answer was a legitimate outcome rather than a malfunction.
    // Only 401 (session resume) and the timeout statuses were classified before, so a 403 and a
    // 500 rendered the identical red cross — distinguishable only by an HTTP status buried in a
    // free-text sentence. On a platform that scopes reads per user by design, "you may not see
    // this" is an expected state and must not be dressed as a failure. Neither is retryable.
    const status = (error as { status?: number } | null)?.status
    const detail = (error as { detail?: string } | null)?.detail
    if (status === 403) {
      return <WidgetForbidden subtitle={detail} />
    }
    if (status === 404) {
      return <WidgetNotFound subtitle={detail} />
    }

    const failedToFetch = error instanceof Error && (error instanceof TypeError || error.message.includes('Failed to fetch'))
    // Prefer the backend's OWN words when the failure response carried them; `res.statusText`
    // alone is a generic HTTP phrase that says nothing about the cause.
    const subtitle = failedToFetch
      ? "Couldn't reach the server. It may still be starting up."
      : detail ?? `There has been an error while fetching the widget: ${error instanceof Error ? error.message : 'unknown error'}`
    return <WidgetError onRetry={() => { void refetch() }} subtitle={subtitle} />
  }

  if (!widget) {
    // P17: "widget" is our word, not the reader's. They are looking at a page that is missing
    // a piece; say that.
    return invisible ? null : <WidgetError subtitle={'This part of the page could not be loaded'} />
  }

  const { code, kind, message, status } = widget

  if (!status) {
    return <WidgetError subtitle={`Widget ${kind} does not have a status specification`} />
  }

  if (typeof status === 'string') {
    if (kind === 'Status') {
      if (code === 401) {
        catchError(
          {
            data: { message },
            message: `Authentication error (code: ${code})`,
            status: code,
          },
          'notification'
        )
      }

      if (code === 500 && status === 'Failure' && message?.includes('credentials')) {
        catchError(
          {
            data: { message },
            message: `Credentials error (code: ${code})`,
            status: code,
          },
          'notification'
        )

        window.location.replace('/login')
      }

      const params = new URLSearchParams(widgetEndpoint)

      return (
        <WidgetError subtitle={`There has been an error while rendering a widget with the following specification:`}>
          <div className={styles.content}>
            <pre className={styles.pre}>
              <b>Name:</b> {params.get('name')}
              {'\n'}
              <b>Namespace:</b> {params.get('namespace')}
              {'\n'}
              <b>Version:</b> {params.get('apiVersion')}
              {'\n'}
              <b>Endpoint:</b> {widgetEndpoint}
              {'\n'}
              {'\n'}
              <b>Widget:</b> {JSON.stringify(widget, null, 2)}
              {'\n'}
            </pre>
          </div>
        </WidgetError>
      )
    }

    return <WidgetError subtitle={`Status for ${kind} widget is in string format: ${status}`} />
  }

  if (prefix && isWidgetFilteredByProps(status.widgetData, prefix)) {
    return null
  }

  // Wrapped in a boundary so a render-time throw from THIS widget shows this widget's error card
  // instead of taking the page with it. React 19 unmounts the whole tree on an uncaught render
  // error, and the app had no boundary anywhere — so malformed `widgetDataTemplate` output (which
  // --dry-run=server never validates) blanked the page rather than failing in place.
  // `resetKey={dataUpdatedAt}` un-latches the boundary when a refetch brings new data, so a
  // transiently-bad payload does not leave the widget permanently stuck on its first bad render.
  const renderedWidget = (
    <WidgetErrorBoundary resetKey={dataUpdatedAt} widgetId={`${kind} @ ${widgetEndpoint}`}>
      {parseWidget(widget, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage, isFetchingResourcesRefs, serverPagination)}
    </WidgetErrorBoundary>
  )

  // Overlay a tiny freshness DOT on the widget ONLY when (1) the widget CR OPTS IN via
  // `spec.freshness: true` AND (2) its state is worth noticing — actively refreshing, or
  // stale. The steady/fresh state (live or just-updated) is the assumed default and
  // renders NO indicator at all: a marker on every widget, all the time, is noise not
  // signal. So the dot appears only as an exception, and only where an author asked for
  // it — the DEFAULT (no `freshness` in the spec) shows no badge ever. Skipped entirely
  // for invisible renders / live-refresh off.
  //
  // STRUCTURE STABILITY (issue #33): the wrapper `<div>` is rendered UNCONDITIONALLY
  // (only the badge inside it toggles). Wrapping only-when-noticeable changed the
  // subtree's root element type on every stale/refetch flip (Suspense ↔ div), which
  // React reconciles as unmount+remount — resetting ALL widget-local state, most
  // visibly wiping every in-progress Form field back to initialValues on each
  // live-refresh cycle. The wrapper is layout-neutral (fills the widget's slot).
  const withFreshness = (content: React.ReactNode): React.ReactNode => {
    if (invisible || !liveRefreshEnabled) {
      return content
    }
    const isRefreshing = isFetching && dataUpdatedAt > 0
    // Opt-in gate: the badge renders ONLY for widgets whose CR declares
    // `spec.freshness: true` — and even then only for the exception states.
    const showBadge = widget?.spec?.freshness === true && (isStale || isRefreshing)
    // The wrapper <div> renders UNCONDITIONALLY (stable subtree root → the widget never
    // remounts on a background refetch, preserving form-input state; see the remount-invariant
    // test). It is `display: contents` (layout-transparent) until a badge actually shows, so it
    // never forces sibling widgets in a horizontal Flex to collapse into equal columns (each
    // `width:100%` wrapper shrinking to a 1/N share defeats the parent CR's `justify`). When a
    // badge shows it becomes a real positioning box (`freshnessWrapActive`) for the overlay.
    return (
      <div className={showBadge ? `${styles.freshnessWrap} ${styles.freshnessWrapActive}` : styles.freshnessWrap}>
        {content}
        {showBadge
          ? (
            <div className={styles.freshnessOverlay}>
              <FreshnessBadge
                dataUpdatedAt={dataUpdatedAt}
                isFetching={isFetching}
                isStale={isStale}
                liveArmed={liveArmed}
                onRefresh={() => { void refetch() }}
              />
            </div>
          )
          : null}
      </div>
    )
  }

  if (wrapper) {
    return <wrapper.component {...wrapper.props}>{withFreshness(renderedWidget)}</wrapper.component>
  }

  return withFreshness(renderedWidget)
}

export default WidgetRenderer
