import type { AppRoute } from '../../context/RoutesContext'
import type { ResourcesRefs } from '../../types/Widget'
import { getResourceEndpoint, getResourceRef } from '../../utils/utils'

/** A folded nav entry on `Menu.widgetData.items` (inline nav data). */
export interface InlineNavItem {
  resourceRefId?: string
  icon?: string
  label?: string
  path?: string
  order?: number
  /** Convention page-slug override (required for templated paths to avoid
   * list-vs-detail collisions); else derived from `path`. */
  page?: string
  /** Set to 'divider' to render a visual separator at this order position. */
  type?: 'divider'
  /**
   * The namespace the page CR lives in, when it is NOT the portal's own.
   *
   * WHY IT EXISTS. The convention below resolves `page-<slug>` in ONE namespace — the frontend's
   * `FRONTEND_NAMESPACE` — so a page installed anywhere else is unreachable by it. That was
   * invisible while every page shipped in the portal chart, and becomes load-bearing the moment
   * pages arrive from other charts, or from a chart installed into another namespace,
   * where the nav entries that reach them today do so only via `resourceRefId` + a ref carrying an
   * explicit namespace. A menu assembled from a cluster listing has no such refs, so the namespace
   * has to travel on the item.
   *
   * Optional, and omitting it keeps today's behaviour exactly: fall back to the configured one.
   */
  namespace?: string
  /**
   * A sidebar LINK, not a page: contribute an entry, claim no route and no content.
   *
   * WHY IT EXISTS. Every other item is both at once — its `path` registers the route AND is the
   * entry's link — and that is right while the thing that owns the page is also the thing that
   * links to it. It breaks when one shared page must be reached at a path only the CALLER's own
   * context can spell. A nav item discovered from a cluster listing always resolves its content to
   * the page root that declared it: `restaction.sidebar-nav` stamps `resourceRefId` on every root
   * it emits, and that ref wins first in `resolveContentEndpoint`, so the content comes from that
   * root's own namespace and no annotation redirects it elsewhere.
   *
   * The CMP service desk forced it: one shared set of desk pages, tickets living per tenant
   * namespace, so the route must be `/service-desk/{namespace}` and each tenant needs a link with
   * their own filled in. Neither existing shape can do that:
   *
   * - a LABELLED root on the shared pages would navigate to the literal string
   *   `/service-desk/{namespace}`, braces and all, because an entry's key IS its path and the Menu
   *   navigates it verbatim — nothing substitutes route params into a nav link;
   * - a generated root in the tenant's namespace would open ITSELF, an empty page root, because of
   *   the `resourceRefId` rule above.
   *
   * So the two jobs separate. The shared root carries the templated `nav-path` and NO label: it
   * routes and owns the content. One generated object per tenant carries the label, the concrete
   * path and this flag: it links and owns nothing. The shared templated route then matches the
   * concrete URL, so `useParams()` yields the namespace and it reaches the data source's extras
   * through `buildExtrasParam`.
   *
   * A link-only item MUST NOT register a route, which is the one thing this flag does. Registering
   * its concrete path would shadow the templated one — a static segment outranks a dynamic one —
   * and then content would resolve to the empty generated object with no route param at all: the
   * exact failure the flag exists to avoid, reached from the other side.
   *
   * It carries no `resourceRefId`, so `isNavEntryAllowed` fail-opens and visibility rests entirely
   * on whether the caller may `list` the object in its namespace. That IS the intended gate — the
   * entry lives in the tenant's own namespace precisely so their own RBAC decides it.
   *
   * AUTHORING NOTE, because the obvious minimal object is refused. The carrier is still a `Flex`,
   * so it must satisfy the Flex CRD: `spec.required` is `[resourcesRefs, widgetData]`,
   * `widgetData.required` is `[allowedResources, items]` and `resourcesRefs.required` is `[items]`.
   * `widgetData: {}` is therefore rejected at admission. The minimal valid link-only entry is
   * `spec: { widgetData: { allowedResources: [], items: [] }, resourcesRefs: { items: [] } }` —
   * none of those arrays declares `minItems`, so empty ones are fine.
   */
  linkOnly?: boolean
}

/** Antd Menu entry data (icon resolved to JSX by the component). */
export interface NavEntry {
  iconName?: string
  key: string
  label?: string
  type?: 'divider'
}

const PAGE_RESOURCE = 'flexes'
const PAGE_API_VERSION = 'widgets.templates.krateo.io/v1beta1'

/** Convention slug for a route path: drop `{param}` segments + leading '/', '/'→'-'. */
const routeSlug = (path: string): string =>
  path.replace(/\/?\{[^}]+\}/g, '').replace(/^\//, '').replace(/\//g, '-') || 'home'

/**
 * Resolve a nav item's content endpoint, by precedence:
 *  1. `resourceRefId` → the Menu's own `resourcesRefs` (structured + RBAC-resolved
 *     by snowplow; the existing nav form);
 *  2. convention — a `flexes/page-<slug>` widget derived from `path` (`page:`
 *     overrides the slug; required for templated paths to avoid list-vs-detail collisions),
 *     in the item's own `namespace` when it declares one, else the configured default.
 * Both avoid hardcoding a raw /call URL (no `endpoint` escape hatch).
 */
export const resolveContentEndpoint = (
  item: InlineNavItem,
  resourcesRefs: ResourcesRefs,
  namespace: string,
): string => {
  if (item.resourceRefId) {
    const ref = resourcesRefs?.items?.find(({ id }) => id === item.resourceRefId)
    if (ref?.path) { return ref.path }
  }
  const slug = item.page ?? routeSlug(item.path ?? '')
  // The item's namespace wins, so a page from another chart or another tier resolves where it
  // actually lives. `??` and not `||`: an empty string is a real (if useless) value and silently
  // swapping it for the default would hide a misconfigured item rather than letting it 404.
  return getResourceEndpoint({
    apiVersion: PAGE_API_VERSION,
    name: `page-${slug}`,
    namespace: item.namespace ?? namespace,
    resource: PAGE_RESOURCE,
  })
}

/**
 * RBAC visibility gate for a sidebar entry. snowplow resolves each nav item's
 * page widget AS THE USER and stamps `allowed` on the matching `resourcesRefs`
 * entry; `allowed: false` means the user was denied that page.
 *
 * CRUCIAL: by the time this Menu widget receives `resourcesRefs`, WidgetRenderer
 * has ALREADY dropped every `allowed: false` ref
 * (`resourcesRefs.items.filter(({ allowed }) => allowed)`). So a denied page's ref
 * is not present-with-`allowed:false` — it is simply ABSENT. Therefore a menu item
 * that carries a `resourceRefId` is allowed IFF that ref SURVIVED that filter, i.e.
 * is still present. (An earlier version checked `ref.allowed !== false`, which never
 * fired — the denied refs were already gone, so it fell through to fail-open and
 * showed every admin page. This is the fix for that.)
 * FAIL-OPEN only for items with NO `resourceRefId` (route-only / convention
 * `page-<slug>` pages) — those carry no ref to gate on and stay visible; RBAC-driven
 * nav therefore requires each gated page to carry a `resourceRefId`.
 */
const isNavEntryAllowed = (
  item: InlineNavItem,
  resourcesRefs: ResourcesRefs,
  deniedRefIds: readonly string[] = [],
): boolean => {
  if (!item.resourceRefId) { return true }
  // ref present == survived WidgetRenderer's allowed-filter == user may GET the page.
  if (resourcesRefs?.items?.some(({ id }) => id === item.resourceRefId)) { return true }

  // The ref is ABSENT, and absence alone cannot say why. WidgetRenderer drops `allowed: false`
  // refs before the Menu sees them (WidgetRenderer.tsx), so at this layer these are identical:
  //
  //   a) the ref was evaluated and DENIED          -> must stay hidden
  //   b) NOTHING was evaluated — snowplow returned no refs at all (an RBAC evaluation error,
  //      a failed resolve, an iterator with no context) -> hiding is wrong
  //
  // `deniedRefIds` is the discriminator, and WidgetRenderer already computes and passes it for
  // exactly this ambiguity. If refs came back empty AND nothing was denied, no judgement was made
  // about anything, and the honest response is to show the nav rather than delete the product from
  // under the user — admins included. snowplow's rbac.UserCan returns false on every error path,
  // not only a genuine deny, so (b) is reachable without anyone losing a permission.
  //
  // Deliberately NOT a blanket fail-open: with any denied ref present, evaluation demonstrably
  // happened, so an absent ref means denied and stays hidden (frontend#295).
  const nothingWasEvaluated = !resourcesRefs?.items?.length && deniedRefIds.length === 0
  if (nothingWasEvaluated) {
    // Loud on purpose: the fallback saved the page, but a nav RESTAction that resolved no refs at
    // all is always a defect upstream — and since portal#225 it also means the prewarm walker got
    // nothing to descend, so the cache is cold for every page below the nav.
    console.error(
      `Menu: resourcesRefs resolved EMPTY with nothing denied — showing all nav entries rather than none. `
      + `The nav RESTAction returned no refs; entries are unfiltered until it does.`,
    )
    return true
  }
  return false
}

/**
 * Build the antd-Menu entries + app routes from inline nav items.
 * - ROUTES: every item with a `path` (label OPTIONAL → a label-less item is a
 *   route-only/hidden route, e.g. /search, detail, create). Content endpoint via
 *   `resolveContentEndpoint` (explicit → resourceRefId → convention `flexes/page-<slug>`),
 *   so the INIT nav is the single, param-capable route source — no routes-loader.
 *   Routes are NOT RBAC-filtered: a hidden entry's deep-link still resolves, and
 *   the page's own content `/call` returns 403 (defense stays at the content layer).
 * - ENTRIES: only items with a `label` (the visible sidebar) AND that the user is
 *   `allowed` (isNavEntryAllowed). Both sorted by `order`.
 */
export const buildNavModel = (
  items: readonly InlineNavItem[],
  resourcesRefs: ResourcesRefs,
  namespace: string = '',
  deniedRefIds: readonly string[] = [],
): { entries: NavEntry[]; routes: AppRoute[] } => {
  const sorted = [...items].sort((left, right) => (left.order ?? 100) - (right.order ?? 100))

  // `linkOnly` is filtered out here and ONLY here: such an item still reaches `entries` below like
  // any other labelled one. See InlineNavItem.linkOnly — registering its concrete path would
  // shadow the templated route that owns the page and strip the route param off the match.
  const routes: AppRoute[] = sorted
    .filter((item): item is InlineNavItem & { path: string } => !!item.path && !item.linkOnly)
    .map((item) => ({
      endpoint: resolveContentEndpoint(item, resourcesRefs, namespace),
      path: item.path,
      resourceRef: item.resourceRefId ? getResourceRef(item.resourceRefId, resourcesRefs) : undefined,
      resourceRefId: item.resourceRefId ?? '',
      title: item.label,
    }))

  const entries: NavEntry[] = sorted.flatMap((item, idx): NavEntry[] => {
    if (item.type === 'divider') {
      return [{ key: `divider-${item.order ?? idx}`, type: 'divider' as const }]
    }
    if (item.label && item.path && isNavEntryAllowed(item, resourcesRefs, deniedRefIds)) {
      return [{ iconName: item.icon, key: item.path, label: item.label }]
    }
    return []
  })

  return { entries, routes }
}
