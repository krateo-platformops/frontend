import { createContext } from 'react'

/**
 * The refetch of the nearest widget above: the one whose status listed this child. A part snowplow
 * reported as failed is a line in its PARENT's resourcesRefs, so "Try again" (components/RefChild/
 * FailedPart) re-reads the parent. Its own module so WidgetRenderer and RefChild can both import it
 * without a cycle (RefChild imports WidgetRenderer).
 */
export const ParentRefetchContext = createContext<(() => void) | null>(null)
