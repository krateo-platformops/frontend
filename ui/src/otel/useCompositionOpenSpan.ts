/**
 * `krateo.composition.open`, from the routed page that opens one.
 *
 * THE END OF THIS SPAN IS THE WHOLE DIFFICULTY. The contract (docs/observability.md) says it ends
 * when every initial widget has RESOLVED, not at first paint: an empty shell is not "open", and
 * first paint is the number that would have looked best. A Krateo page is not one component but a
 * tree of independently-resolved widget CRs — the page's own read, then a read per child it
 * renders — so "resolved" is a property of the page's whole fan-out, not of any one component.
 *
 * The signal used is react-query's in-flight count for the `widgets` key: the open is complete at
 * the first moment NO widget read is in flight. Two things about it are deliberate:
 *
 * - IT IS CONFIRMED ON THE NEXT TICK, not acted on immediately. `useIsFetching` gives the count as
 *   of the last render, and the children of a page mount in the SAME commit that renders the
 *   page's own resolved data — their reads start in their effects, after this render's count was
 *   taken. Ending at the first zero would therefore end at the parent's resolution and exclude
 *   every child: first paint, by another name. A zero is instead held for one macrotask and
 *   cancelled if a read appears, which costs the span a sub-frame tail and buys it the children.
 * - IT COUNTS WIDGET READS APP-WIDE, not only this page's. There is no page-scoped settle signal to
 *   key on, and the error direction is the safe one: a chrome widget refetching during an open can
 *   only make the span LONGER, never shorter, so the p95 is never flattered by it.
 *
 * KNOWN GAP, recorded rather than hidden: a widget whose code is code-split (the chart widgets) is
 * mounted behind a Suspense boundary and may start its read more than a tick after quiescence. The
 * span then ends before that one read. It is the same class of error as first paint, much smaller,
 * and closing it needs a page-scoped resolution registry in WidgetRenderer.
 */
import { useIsFetching } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { startCompositionOpen, type InteractionSpan } from './interactions'
import { isCompositionDetailRoute } from './route'

/** Every widget read the portal makes is cached under this key's prefix (`useWidgetQuery`). */
const WIDGET_READS = ['widgets'] as const

/**
 * Times the open of the composition detail page at `route` (a TEMPLATED route, or null when none
 * resolved). Inert for every other route, and inert when no provider is registered.
 */
export const useCompositionOpenSpan = (route: string | null): void => {
  const inFlight = useIsFetching({ queryKey: WIDGET_READS })
  const span = useRef<InteractionSpan | null>(null)
  const confirming = useRef<ReturnType<typeof setTimeout> | null>(null)
  const opensAComposition = isCompositionDetailRoute(route)

  // Starts at the navigation that mounted this page — the committed intent. Unmounting before the
  // fan-out settles is an abandonment: marked, never dropped, or the abandonment rate hides.
  useEffect(() => {
    if (!opensAComposition || route === null) {
      return
    }
    span.current = startCompositionOpen(route)

    return () => {
      if (confirming.current !== null) {
        clearTimeout(confirming.current)
        confirming.current = null
      }
      span.current?.abandoned()
      span.current = null
    }
  }, [opensAComposition, route])

  useEffect(() => {
    if (span.current === null) {
      return
    }
    if (inFlight > 0) {
      // A read appeared (or never stopped): whatever quiescence we were about to confirm was the
      // gap between the page's own resolution and its children's reads.
      if (confirming.current !== null) {
        clearTimeout(confirming.current)
        confirming.current = null
      }

      return
    }
    if (confirming.current !== null) {
      return
    }
    confirming.current = setTimeout(() => {
      confirming.current = null
      span.current?.ok()
      span.current = null
    })
  }, [inFlight])
}
