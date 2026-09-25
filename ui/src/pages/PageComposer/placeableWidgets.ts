/**
 * The widgets already on the cluster, for "Place existing".
 *
 * NO NEW BACKEND, AND NO RESTACTION. This used to read `restaction.page-composable`, the list
 * `form.compose-page`'s multi-select read, so the composer offered the same set the old card did.
 * Both are gone from the portal chart: the form in portal#237, the RESTAction in portal#245, once
 * nothing fetched it. This module reads snowplow's `/list` instead (WIDGET_CATEGORY below), which
 * offers every widget kind rather than the seven that RESTAction named — the old card's set, and
 * more, so retiring the card did not narrow what a person can place.
 *
 * WHY THAT IS THE RIGHT AUTHORIZATION MODEL. `/list` resolves every GVR in the category under the
 * caller's own `<user>-clientconfig` credential: the list is exactly what THIS user may read, and the
 * composer adds no authorization surface of its own.
 *
 * WHY A PLAIN FETCH. There is no list hook in the codebase to reuse: every other widget read in the
 * UI is a single named CR GET, and `getResourceEndpoint` requires a name.
 *
 * FAILURE IS CONTENT, NEVER A THROW. A 403 (the user may not list these), a 404 (a snowplow that
 * does not serve `/list`) and a 5xx all end as a string the surface shows, because an empty picker
 * that does not say why is the failure mode worth avoiding here.
 */
import { getAccessToken } from '../../utils/getAccessToken'

import { WIDGET_KINDS } from './widgetKinds.generated'

/**
 * The category EVERY widget CRD declares — verified across all forty-four: `[widgets, krateo]`.
 *
 * This is what retired `page-composable`, since deleted from the portal chart (portal#245). That
 * RESTAction existed because `/call` cannot list a collection: `ParseNamespacedName` refuses a
 * request with no `name`, so the frontend could fetch a named object and nothing else, and listing
 * had to be delegated to an RA whose api steps do collection GETs internally. The cost was a
 * hand-written list of SEVEN kinds living in the portal chart — a different repository, released
 * separately, failing silently apart: a kind the RA omitted was simply absent from the palette with
 * no error anywhere.
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
 * One listing, parameterised by category — widgets and RESTActions differ only in which category
 * they declare and in what to call them when the call fails.
 */
const listPlaceableByCategory = async (
  snowplowBaseUrl: string,
  namespace: string,
  category: string,
  noun: string,
  /**
   * The PLURAL for a listed object's kind — and the reason this is a parameter rather than a
   * lookup. It was `WIDGET_KINDS[kind]?.plural`, which is the generated table of the forty-four
   * WIDGET kinds; `RESTAction` is not one of them (it is templates.krateo.io, from snowplow's
   * chart, and the generator reads helm/frontend-crds). So every RESTAction row resolved to
   * `undefined` and was dropped by the guard below — the listing returned 85 objects and the
   * picker showed none, with no error anywhere, because an empty result is exactly what an empty
   * namespace looks like.
   */
  pluralFor: (kind: string) => string | undefined,
): Promise<PlaceableResult> => {
  try {
    const url = new URL(`${snowplowBaseUrl.replace(/\/+$/, '')}/list`)
    url.searchParams.set('category', category)
    url.searchParams.set('ns', namespace)
    const response = await fetch(url.toString(), { headers: { ...authHeader() } })
    if (response.status === 403) {
      // The user may not list these. Said plainly, because an empty picker that does not explain
      // itself is the failure this module exists to avoid.
      return { error: `you may not list ${noun} in this namespace`, ok: false }
    }
    if (!response.ok) {
      return { error: `could not list ${noun} — snowplow responded ${response.status}`, ok: false }
    }
    // /list encodes a bare ARRAY of unstructured objects — not an envelope, and not a k8s List.
    const items = await response.json().catch(() => null) as unknown
    if (!Array.isArray(items)) {
      return { error: `the ${noun} list came back in a shape this build does not understand`, ok: false }
    }
    const widgets: PlaceableWidget[] = []
    for (const entry of items) {
      const item = asRecord(entry)
      const name = asRecord(item?.metadata)?.name
      // The PLURAL, derived from the kind through the generated table rather than guessed:
      // lowercase(kind)+"s" is wrong for a good number of them, and a wrong plural places a child
      // its parent will not render.
      const kind = typeof item?.kind === 'string' ? item.kind : ''
      const resource = pluralFor(kind)
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

/**
 * List the widgets the caller may see in `namespace`, across every widget kind.
 *
 * `namespace` is where the listed widgets LIVE, which is why the placed entry's namespace is taken
 * from here rather than from the draft: a placed widget stays where it is, and a ref that named the
 * draft's namespace would point at nothing.
 */
export const listPlaceableWidgets = async (
  snowplowBaseUrl: string,
  namespace: string,
): Promise<PlaceableResult> =>
  listPlaceableByCategory(snowplowBaseUrl, namespace, WIDGET_CATEGORY, 'widgets',
    (kind) => WIDGET_KINDS[kind]?.plural)

/**
 * The CATEGORY every RESTAction CRD declares — `categories: [krateo, rest, actions]`.
 *
 * A RESTAction is discovered exactly the way a widget is, by the same endpoint under the same
 * RBAC, because it is an ordinary CRD in a category. The composer treated widgets as the only
 * placeable thing, which is why a page's DATA could only ever come from the three-question
 * bind-data form — not because the platform said so, but because nothing else was ever offered.
 */
export const ACTION_CATEGORY = 'actions'

/** List the RESTActions the caller may see in a namespace — the `apiRef` picker's left half. */
export const listPlaceableActions = async (
  snowplowBaseUrl: string,
  namespace: string,
): Promise<PlaceableResult> =>
  // One kind in this category, and its plural is fixed by snowplow's CRD rather than discovered:
  // `restactions`. Looking it up in the widget table is what emptied the picker.
  listPlaceableByCategory(snowplowBaseUrl, namespace, ACTION_CATEGORY, 'RESTActions',
    (kind) => (kind === 'RESTAction' ? 'restactions' : undefined))

/** What a targeted existence probe can conclude about one named widget. */
export type WidgetPresence =
  | { presence: 'found' }
  | { presence: 'missing' }
  | { presence: 'forbidden' }
  | { presence: 'unknown'; error: string }

/**
 * Does ONE named widget exist, asked about directly.
 *
 * WHY NOT THE LISTING. `listPlaceableWidgets` answers this too, and it was what the placement check
 * originally used — but it enumerates a whole category in a namespace, and on a real cluster that
 * is 553 objects and SEVEN SECONDS. `requestCompose` gives the composer four seconds to answer, so
 * the check could never finish in time: every placement timed out and reported "no page composer is
 * open to apply this", on a page whose composer was open and working. A correctness fix that turns
 * a working path into a misleading timeout is a worse bug than the one it fixed.
 *
 * The same question asked about one object is a single GET: measured at 111ms when it exists and
 * 58ms when it does not, against ~7100ms for the listing.
 *
 * IT ALSO ANSWERS MORE PRECISELY. A listing can only say "not among the things you can see", which
 * conflates "no such widget" with "you may not read it" — and the refusal had to hedge accordingly.
 * A status code separates them: 404 is absence, 403 is permission. The reader gets the true reason
 * rather than the union of two.
 */
export const widgetExists = async (
  snowplowBaseUrl: string,
  namespace: string,
  resource: string,
  name: string,
): Promise<WidgetPresence> => {
  try {
    const url = new URL(`${snowplowBaseUrl.replace(/\/+$/, '')}/call`)
    url.searchParams.set('apiVersion', 'widgets.templates.krateo.io/v1beta1')
    url.searchParams.set('resource', resource)
    url.searchParams.set('name', name)
    url.searchParams.set('namespace', namespace)
    const response = await fetch(url.toString(), { headers: { ...authHeader() } })
    if (response.ok) {
      return { presence: 'found' }
    }
    if (response.status === 404) {
      return { presence: 'missing' }
    }
    if (response.status === 401 || response.status === 403) {
      return { presence: 'forbidden' }
    }
    return { error: `the cluster answered ${response.status}`, presence: 'unknown' }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'the request failed', presence: 'unknown' }
  }
}
