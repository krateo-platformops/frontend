/**
 * The widgets already on the cluster, for "Place existing".
 *
 * NO NEW BACKEND. `restaction.page-composable` has existed since the builder's first card and
 * already returns exactly what is needed: seven collection GETs (cards, tables, listies,
 * linecharts, statistics, paragraphs, markdowns) flattened into `{id, name, resource}`. It is what
 * `form.compose-page`'s multi-select reads, so the composer offers the SAME set the old card does —
 * which matters, because retiring that card must not quietly narrow what a person can place.
 *
 * WHY THAT IS THE RIGHT AUTHORIZATION MODEL. Every step is a plain collection GET with no
 * `endpointRef`, so snowplow resolves it against the caller's own `<user>-clientconfig` credential:
 * the list is exactly what THIS user may read, and the composer adds no authorization surface of
 * its own. The RA's own header comment says so.
 *
 * WHY A PLAIN FETCH. `callBlueprintRenderRA` is the precedent — a non-widget React module calling a
 * RESTAction over the same `/call` transport a widget uses, reading the jq output straight off
 * `.status`. There is no list hook in the codebase to reuse: every other widget read in the UI is a
 * single named CR GET, and `getResourceEndpoint` requires a name.
 *
 * FAILURE IS CONTENT, NEVER A THROW. A 403 (the user may not list these), a 404 (the RA is not
 * installed on this portal) and a 5xx all end as a string the surface shows, because an empty
 * picker that does not say why is the failure mode worth avoiding here.
 */
import { getAccessToken } from '../../utils/getAccessToken'

/** One placeable widget: the CR name and the CRD plural its parent must declare to render it. */
export interface PlaceableWidget {
  name: string
  /** The CRD plural — `cards`, `tables`, … Written to both resourcesRefs and allowedResources. */
  resource: string
}

export type PlaceableResult =
  | { ok: true; widgets: PlaceableWidget[] }
  | { ok: false; error: string }

/** The logged-in session's Bearer. Best-effort — no token (or no storage in tests) is no header. */
const authHeader = (): Record<string, string> => {
  try {
    return { Authorization: `Bearer ${getAccessToken()}` }
  } catch {
    return {}
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  ((typeof value === 'object' && value !== null && !Array.isArray(value)) ? value as Record<string, unknown> : null)

/**
 * Read `page-composable`'s widget list.
 *
 * `namespace` is both the RA's own namespace and — because the RA hardcodes
 * `{{ .Release.Namespace }}` in every step path — the namespace the listed widgets live in. The two
 * coincide today; a caller must not assume they always will, which is why the placed entry's
 * namespace is taken from here rather than from the draft.
 */
export const listPlaceableWidgets = async (
  snowplowBaseUrl: string,
  namespace: string,
): Promise<PlaceableResult> => {
  try {
    const url = new URL(`${snowplowBaseUrl.replace(/\/+$/, '')}/call`)
    url.searchParams.set('resource', 'restactions')
    url.searchParams.set('apiVersion', 'templates.krateo.io/v1')
    url.searchParams.set('name', 'page-composable')
    url.searchParams.set('namespace', namespace)
    const response = await fetch(url.toString(), { headers: { ...authHeader() } })
    if (!response.ok) {
      return { error: `could not list widgets — page-composable responded ${response.status}`, ok: false }
    }
    // snowplow puts a RESTAction's jq output DIRECTLY in `.status` (not `.status.widgetData`, which
    // is the widget shape).
    const cr = await response.json().catch(() => null) as { status?: unknown } | null
    const list = asRecord(cr?.status)?.widgets
    if (!Array.isArray(list)) {
      return { error: 'page-composable returned no widget list', ok: false }
    }
    const widgets: PlaceableWidget[] = []
    for (const entry of list) {
      const item = asRecord(entry)
      // Both fields or the row is dropped: a name with no plural cannot be placed (the container
      // would not declare it and would render nothing), and a plural with no name resolves to
      // nothing. Silently placing half an entry is worse than omitting it from the picker.
      if (typeof item?.name === 'string' && typeof item.resource === 'string' && item.name && item.resource) {
        widgets.push({ name: item.name, resource: item.resource })
      }
    }
    return { ok: true, widgets }
  } catch (error) {
    return { error: `could not reach page-composable — ${error instanceof Error ? error.message : String(error)}`, ok: false }
  }
}
