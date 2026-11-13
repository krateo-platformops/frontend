/**
 * The routes CONTEXT: its shape, the hook that reads it, and `createRoute` (a navigation route →
 * the WidgetPage that renders it). Deliberately a leaf: widgets (the Menu) and the hooks they use
 * (useHandleActions) import it, and so a public page does. The route TABLE — the shell, the sign-in
 * pages, the Builders — and the provider that owns it live in context/RoutesProvider.tsx, which only
 * the app root imports; keeping them here put the whole signed-in shell (Agentiko, Notifications, the
 * Builders, each reading the stored token) on every widget's import graph.
 */
import { createContext, useContext } from 'react'
import { useParams, type RouteObject } from 'react-router'

import WidgetPage from '../components/WidgetPage'
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

export interface RoutesContextType {
  menuRoutes: AppRoute[]
  routes: RouteObject[]
  isLoading: boolean
  updateMenuRoutes: (newRoutes: AppRoute[]) => void
  registerRoutes: (routes: RouteObject[]) => void
  reloadRoutes: () => Promise<void>
  routerVersion: number
}

export const RoutesContext = createContext<RoutesContextType | undefined>(undefined)

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

export const useRoutesContext = () => {
  const context = useContext(RoutesContext)

  if (!context) {
    throw new Error('useRoutesContext must be used within RoutesProvider')
  }

  return context
}
