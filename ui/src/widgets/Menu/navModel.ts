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
   * pages arrive from other charts or from the `tiers` split (portal.tierNamespace admin/tenant),
   * where the nav entries that reach them today do so only via `resourceRefId` + a ref carrying an
   * explicit namespace. A menu assembled from a cluster listing has no such refs, so the namespace
   * has to travel on the item.
   *
   * Optional, and omitting it keeps today's behaviour exactly: fall back to the configured one.
   */
  namespace?: string
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
const isNavEntryAllowed = (item: InlineNavItem, resourcesRefs: ResourcesRefs): boolean => {
  if (!item.resourceRefId) { return true }
  // ref present == survived WidgetRenderer's allowed-filter == user may GET the page.
  return !!resourcesRefs?.items?.some(({ id }) => id === item.resourceRefId)
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
): { entries: NavEntry[]; routes: AppRoute[] } => {
  const sorted = [...items].sort((left, right) => (left.order ?? 100) - (right.order ?? 100))

  const routes: AppRoute[] = sorted
    .filter((item): item is InlineNavItem & { path: string } => !!item.path)
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
    if (item.label && item.path && isNavEntryAllowed(item, resourcesRefs)) {
      return [{ iconName: item.icon, key: item.path, label: item.label }]
    }
    return []
  })

  return { entries, routes }
}
