import { useEffect } from 'react'

import type { AppRoute } from '../context/RoutesContext'

/** App default browser-tab title (mirrors index.html <title>). */
export const DEFAULT_DOCUMENT_TITLE = 'Krateo'

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * The browser-tab title for an address, from the navigation's own routes (the labels the sidebar
 * shows, so the two cannot drift):
 *
 *   - a route with a label of its own (a list page): that label, "Compositions";
 *   - an address below a labelled section (a detail, form or compose page): "<object> · <page>", the
 *     last segment of the address (the object's name) and the section's label,
 *     "webapp-orders-2 · Compositions". Only the label names the page; the segments between are
 *     places (a namespace), which the breadcrumb shows;
 *   - anything else: undefined, and the tab reads the app default.
 *
 * Before this every detail, form and compose page was "Krateo": only an exact match with a labelled
 * route was named, so with several tabs open they could not be told apart (UX audit TTL-1).
 */
export const documentTitleOf = (pathname: string, routes: readonly AppRoute[]): string | undefined => {
  const own = routes.find((route) => route.path === pathname)?.title?.trim()
  if (own) { return own }
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length < 2) { return undefined }
  const page = routes.find((route) => route.path === `/${segments[0]}`)?.title?.trim()
  return page ? `${decodeSegment(segments[segments.length - 1])} · ${page}` : undefined
}

/**
 * Single, route-driven owner of the browser-tab title. Sets `document.title`
 * to `title` (falling back to the app default) whenever it changes.
 *
 * Called once, by the signed-in shell (components/Shell), for every page it serves: the widget
 * pages and the Builders alike. It used to be set off the `Page` widget (a `<title>` element from
 * its `widgetData.title`), then from WidgetPage, which the Builders do not go through.
 */
export const useDocumentTitle = (title?: string) => {
  useEffect(() => {
    document.title = title?.trim() ? title : DEFAULT_DOCUMENT_TITLE
  }, [title])
}
