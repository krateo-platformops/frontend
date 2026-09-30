import { useQueryClient } from '@tanstack/react-query'
import React, { createContext, useCallback, useContext, useState } from 'react'
import { useParams, type NonIndexRouteObject, type RouteObject } from 'react-router'

import { builderRoutes, mergeShellChildren } from '../builders/host/builderRoutes'
import ShellRoute from '../components/Shell'
import WidgetPage from '../components/WidgetPage'
import Auth from '../pages/Auth/Auth'
import Login from '../pages/Login'
import Logout from '../pages/Logout'
import Profile from '../pages/Profile'
import type { ResourceRef } from '../types/Widget'

export interface AppRoute {
  path: string
  resourceRefId: string
  resourceRef?: ResourceRef
  /** Resolved content endpoint — legacy resourceRef path or the convention
   * `flexes/page-<slug>` (see navModel.resolveContentEndpoint). Drives the
   * param-capable registered React-Router route. */
  endpoint?: string
  /** Browser-tab title for this route (e.g. the nav label); set via useDocumentTitle. */
  title?: string
}

interface RoutesContextType {
  menuRoutes: AppRoute[]
  routes: RouteObject[]
  isLoading: boolean
  updateMenuRoutes: (newRoutes: AppRoute[]) => void
  registerRoutes: (routes: RouteObject[]) => void
  reloadRoutes: () => Promise<void>
  routerVersion: number
}

const RoutesContext = createContext<RoutesContextType | undefined>(undefined)

// The authenticated area is a single persistent shell (the `Layout` widget from
// config INIT) rendered as a pathless layout route; every content route is a
// CHILD that renders into the shell's <Outlet/>. Login/Auth/Logout sit outside it
// (no chrome). Logout is a static route on purpose: it's the recovery escape hatch,
// so it must resolve even when the snowplow-driven shell pages fail to render.
// Dynamic routes are inserted into the shell's children by registerRoutes.
const SHELL_ROUTE_ID = 'shell'

/** The paths the app serves itself — no Builder's route may take one. */
const STATIC_PATHS = ['/login', '/auth', '/logout', '/profile', '*']

const defaultRoutes: RouteObject[] = [
  { element: <Login />, path: '/login' },
  { element: <Auth />, path: '/auth' },
  { element: <Logout />, path: '/logout' },
  {
    children: [
      { element: <Profile />, path: '/profile' },
      // The builders' authoring surfaces: one route per Builder, at its `spec.route`, each the
      // composer host (builders/host/builderRoutes.tsx) — /portal-builder/compose and
      // /blueprint-builder/compose today. STATIC children of the shell, like /profile, rather than
      // CR-driven widget pages: a composer is React (drag and drop, a live graph, a multi-file draft
      // with undo), and what IS configuration about it is its Builder CR, not widgetData. The `*`
      // fallthrough below keeps every CR-driven page unaffected. A Builder never takes a path the
      // shell serves itself, and the navigation's routes replace a builder route at the same path.
      ...builderRoutes(STATIC_PATHS),
      { element: <WidgetPage />, path: '*' },
    ],
    element: <ShellRoute />,
    id: SHELL_ROUTE_ID,
  },
]

const normalizeRouteParameters = (route: string) => {
  /**
  To map widgetData path to react-router path

  input: /compositions/{namespace}/{name}
  output: /compositions/:namespace/:name
  */
  let normalizeRoute = route
  if (normalizeRoute.endsWith('/')) {
    normalizeRoute = normalizeRoute.slice(0, -1)
  }
  const pattern = /\{([^}]+)\}/g
  return normalizeRoute.replace(pattern, ':$1')
}

/**
 * Substitutes template parameters in an endpoint string with actual values
 *
 * Example:
 * routerParams: { name: "pino", namespace: "gino" }
 * endpoint: '/call?resource=collections&apiVersion=templates.krateo.io/v1alpha1&name={name}&namespace={namespace}'
 * returns: '/call?resource=collections&apiVersion=templates.krateo.io/v1alpha1&name=pino&namespace=gino'
 */
const substituteEndpointParams = (endpoint: string, routerParams: Record<string, string>): string => {
  const decoded = decodeURIComponent(endpoint)

  const substituted = decoded.replace(/\{([^}]+)\}/g, (match, paramName: string) => {
    const paramValue = routerParams[paramName]
    return paramValue !== undefined ? paramValue : match
  })

  try {
    const url = new URL(substituted, window.location.origin)
    url.search = new URLSearchParams(url.searchParams).toString()
    return url.pathname + url.search
  } catch {
    return substituted
  }
}

export function createRoute({ endpoint, path }: { endpoint: string; path: string }) {
  const reactRouterPath = normalizeRouteParameters(path)

  return {
    Component: () => {
      const routerParams = useParams()
      const widgetEndpoint = substituteEndpointParams(endpoint, routerParams as Record<string, string>)
      return <WidgetPage defaultWidgetEndpoint={widgetEndpoint} />
    },
    path: reactRouterPath,
  }
}

export const RoutesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // use to force re-render the router when a new route is added
  const [routerVersion, setRouterVersion] = useState(0)
  const [routes, setRoutes] = useState<RouteObject[]>(defaultRoutes)
  const [menuRoutes, setMenuRoutes] = useState<AppRoute[]>([])
  const [isLoading] = useState(false)

  const queryClient = useQueryClient()

  // The Menu re-derives its `routes` array on every render (its buildNavModel
  // memo depends on a useQueries.combine output whose reference changes each
  // render), so this is called repeatedly with content-equal routes. Returning
  // the previous array reference when nothing actually changed prevents an
  // infinite render loop (setState → re-render → effect → setState → …).
  const updateMenuRoutes = useCallback((newRoutes: AppRoute[]) => {
    setMenuRoutes((prev) => {
      const unchanged = prev.length === newRoutes.length
        && prev.every((route, index) =>
          route.path === newRoutes[index].path && route.resourceRefId === newRoutes[index].resourceRefId)
      return unchanged ? prev : newRoutes
    })
  }, [])

  const reloadRoutes = async () => {
    await queryClient.invalidateQueries({
      predicate: (query) => {
        // query.queryKey[0] is always 'widgets'
        // query.queryKey[1] is the URL (e.g. "http://localhost:30081/call?resource=routesloaders&apiVersion=widgets.templates.krateo.io/v1beta1&name=routes-loader&namespace=krateo-system")
        return (query.queryKey[1] as string).includes('resource=routes')
      },
    })
  }

  const registerRoutes = useCallback((newRoutes: RouteObject[]) => {
    setRoutes((prevRoutes) => {
      const shellIndex = prevRoutes.findIndex((route) => route.id === SHELL_ROUTE_ID)
      if (shellIndex === -1) { return prevRoutes }

      // The shell is the pathless layout route (non-index: it has children).
      const shell = prevRoutes[shellIndex] as NonIndexRouteObject
      const children = shell.children ?? []
      // A path already served is kept — except a builder route, which the portal's own replaces;
      // the '*' catch-all stays last (mergeShellChildren).
      const mergedChildren = mergeShellChildren(children, newRoutes)
      if (mergedChildren === children) { return prevRoutes }

      const updatedRoutes = [...prevRoutes]
      updatedRoutes[shellIndex] = { ...shell, children: mergedChildren }
      setRouterVersion((prev) => prev + 1)
      return updatedRoutes
    })
  }, [])

  return (
    <RoutesContext.Provider
      value={{
        isLoading,
        menuRoutes,
        registerRoutes,
        reloadRoutes,
        routerVersion,
        routes,
        updateMenuRoutes,
      }}
    >
      {children}
    </RoutesContext.Provider>
  )
}

export const useRoutesContext = () => {
  const context = useContext(RoutesContext)

  if (!context) {
    throw new Error('useRoutesContext must be used within RoutesProvider')
  }

  return context
}
