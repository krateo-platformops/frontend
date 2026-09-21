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

import { WIDGET_KINDS } from './widgetKinds.generated'

/**
 * The category EVERY widget CRD declares — verified across all forty-four: `[widgets, krateo]`.
 *
 * This is what retires `page-composable`. That RESTAction existed because `/call` cannot list a
 * collection: `ParseNamespacedName` refuses a request with no `name`, so the frontend could fetch a
 * named object and nothing else, and listing had to be delegated to an RA whose api steps do
 * collection GETs internally. The cost was a hand-written list of SEVEN kinds living in the portal
 * chart — a different repository, released separately, failing silently apart: a kind the RA omits
 * is simply absent from the palette with no error anywhere.
 *
 * `/list` takes a CATEGORY, discovers the GVRs in it server-side, and lists each under the CALLER'S
 * own client. So one request returns every widget instance the user may see, across all
 * forty-four kinds, with no hand-maintained list anywhere and nothing to keep in step.
 */
const WIDGET_CATEGORY = 'widgets'

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
    const url = new URL(`${snowplowBaseUrl.replace(/\/+$/, '')}/list`)
    url.searchParams.set('category', WIDGET_CATEGORY)
    url.searchParams.set('ns', namespace)
    const response = await fetch(url.toString(), { headers: { ...authHeader() } })
    if (response.status === 403) {
      // The user may not list these. Said plainly, because an empty picker that does not explain
      // itself is the failure this module exists to avoid.
      return { error: 'you may not list widgets in this namespace', ok: false }
    }
    if (!response.ok) {
      return { error: `could not list widgets — snowplow responded ${response.status}`, ok: false }
    }
    // /list encodes a bare ARRAY of unstructured objects — not an envelope, and not a k8s List.
    const items = await response.json().catch(() => null) as unknown
    if (!Array.isArray(items)) {
      return { error: 'the widget list came back in a shape this build does not understand', ok: false }
    }
    const widgets: PlaceableWidget[] = []
    for (const entry of items) {
      const item = asRecord(entry)
      const name = asRecord(item?.metadata)?.name
      // The PLURAL, derived from the kind through the generated table rather than guessed:
      // lowercase(kind)+"s" is wrong for a good number of them, and a wrong plural places a child
      // its parent will not render.
      const kind = typeof item?.kind === 'string' ? item.kind : ''
      const resource = WIDGET_KINDS[kind]?.plural
      // Both or the row is dropped: a name with no plural cannot be placed (the container would not
      // declare it and would render nothing), and a plural with no name resolves to nothing.
      if (typeof name === 'string' && name && resource) {
        widgets.push({ name, resource })
      }
    }
    return { ok: true, widgets }
  } catch (error) {
    return { error: `could not reach snowplow — ${error instanceof Error ? error.message : String(error)}`, ok: false }
  }
}
