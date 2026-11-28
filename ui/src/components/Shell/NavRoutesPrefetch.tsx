/**
 * THE ROUTE MAP AT STARTUP, NOT AFTER THE SIDEBAR HAS RENDERED.
 *
 * The frontend learns which page widget serves a URL from the navigation Menu (navModel's routes).
 * The Menu sits inside the INIT Layout's sider, so before this its routes arrived only after the shell,
 * its children and the Menu had all been fetched AND rendered; the page request waited for that, and
 * a landing on `/` waited again for the Menu's redirect. snowplow's bench (run 30, frontend 1.8.44)
 * measured it: the dashboard page request started 510 ms into a landing, 215 ms after the last shell
 * response, while every request itself took 3-8 ms.
 *
 * With `api.NAV` set (the navigation Menu's /call endpoint), the shell reads that Menu at mount, in
 * parallel with INIT, and registers its routes (and resolves `/`) as soon as it answers. The read is
 * the SAME query as the Menu's own: same chrome scope, same endpoint string (rebuilt through
 * getResourceEndpoint, the builder WidgetRenderer uses for a child ref), so the Menu renders from the
 * cache and nothing is fetched twice. The Menu still registers its routes too; registerRoutes and
 * updateMenuRoutes ignore content-equal routes, so the second call changes nothing.
 *
 * Without `api.NAV`, nothing changes: the Menu remains the only route source.
 */
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { useConfigContext } from '../../context/ConfigContext'
import { createRoute, useRoutesContext } from '../../context/RoutesContext'
import { useWidgetQuery } from '../../hooks/useWidgetQuery'
import { carryScopeParams } from '../../utils/navigation'
import { getResourceEndpoint } from '../../utils/utils'
import { buildNavModel, type InlineNavItem } from '../../widgets/Menu/navModel'

/** `api.NAV` rebuilt in the exact form a child ref's endpoint takes, or null when it is not a /call read of a named widget. */
export const navEndpoint = (nav: string | undefined): string | null => {
  if (!nav) { return null }
  const query = new URLSearchParams(nav.split('?')[1] ?? '')
  const resource = query.get('resource')
  const apiVersion = query.get('apiVersion')
  const name = query.get('name')
  if (!nav.split('?')[0].endsWith('/call') || !resource || !apiVersion || !name) { return null }
  return getResourceEndpoint({ apiVersion, name, namespace: query.get('namespace') ?? undefined, resource })
}

const NavRoutesFromMenu = ({ endpoint }: { endpoint: string }) => {
  const { config } = useConfigContext()
  const { registerRoutes, updateMenuRoutes } = useRoutesContext()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { queryResult } = useWidgetQuery(endpoint)
  const widget = queryResult.data
  const namespace = config?.params.FRONTEND_NAMESPACE

  useEffect(() => {
    if (!widget || typeof widget.status === 'string' || !widget.status) { return }
    const { resourcesRefs, widgetData } = widget.status
    // As WidgetRenderer hands the Menu its refs: only the allowed ones.
    const allowedRefs = { ...resourcesRefs, items: resourcesRefs?.items?.filter(({ allowed }) => allowed) ?? [] }
    const items = ((widgetData as { items?: InlineNavItem[] } | undefined)?.items ?? [])
    const { routes } = buildNavModel(items, allowedRefs, namespace)
    if (routes.length === 0) { return }
    updateMenuRoutes(routes)
    registerRoutes(routes.flatMap((route) => (route.endpoint ? [createRoute({ endpoint: route.endpoint, path: route.path })] : [])))
    if (pathname === '/') {
      void navigate(carryScopeParams(routes[0].path))
    }
  }, [widget, namespace, pathname, navigate, registerRoutes, updateMenuRoutes])

  return null
}

const NavRoutesPrefetch = () => {
  const { config } = useConfigContext()
  const endpoint = navEndpoint(config?.api.NAV)
  return endpoint ? <NavRoutesFromMenu endpoint={endpoint} /> : null
}

export default NavRoutesPrefetch
