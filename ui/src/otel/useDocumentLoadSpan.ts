/**
 * `krateo.page.load`, once per document.
 *
 * WHY IT IS REPORTED HERE AND NOT AT THE LOAD EVENT. The span carries `http.route`, and the route
 * must be the TEMPLATED one — the portal's routes arrive from the cluster after sign-in, so at the
 * load event there is no route table to match against and the only thing available would be the
 * concrete path, which is exactly what must never be sent. The duration does not depend on when
 * the span is created (`recordPageLoad` takes it from navigation timing), so the honest order is:
 * measure from navigation timing, report once the landing route is knowable.
 *
 * WHY FROM INSIDE THE AUTHENTICATED SHELL. The exporter authenticates with the session's own
 * bearer and snowplow answers 401 without one, so a span emitted before sign-in cannot be
 * delivered whatever we do with it. The shell is the first place where both a session and a route
 * table exist. A document loaded at `/login` therefore reports no page load — stated here because
 * it is a real gap in coverage, not an accident.
 *
 * ONCE PER DOCUMENT, and the guard is module-level on purpose: `RouterProvider` is keyed on
 * `routerVersion`, so registering a new route set REMOUNTS the whole tree, and a ref or state would
 * report a second document load for a document that never reloaded.
 */
import { useEffect } from 'react'
import type { RouteObject } from 'react-router'

import { recordPageLoad } from './interactions'
import { templatedRouteOf } from './route'

let reported = false

/**
 * Reports the document load once, as soon as `pathname` resolves to a templated route in `routes`.
 * While it does not — the table has not arrived, or the address has no page behind it — nothing is
 * reported: a span whose route would be a concrete path, or missing, is worse than no span.
 */
export const useDocumentLoadSpan = (routes: RouteObject[] | undefined, pathname: string): void => {
  useEffect(() => {
    if (reported) {
      return
    }
    const route = templatedRouteOf(routes, pathname)
    if (route === null) {
      return
    }
    reported = true
    recordPageLoad(route)
  }, [pathname, routes])
}
