/**
 * The route TABLE and its provider: the signed-in shell as a pathless layout route, the sign-in
 * pages, the public pages, and the Builders' and the navigation's routes merged into the shell.
 * Imported by the app root only — see context/RoutesContext.tsx for why it is not the same module.
 */
import { useQueryClient } from '@tanstack/react-query'
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { NonIndexRouteObject, RouteObject } from 'react-router'

import { currentBuilderRegistry, subscribeBuilders } from '../builders/builderRegistry'
import { builderRoutes, builderRoutesSignature, mergeShellChildren, replaceBuilderRoutes } from '../builders/host/builderRoutes'
import ShellRoute from '../components/Shell'
import WidgetPage from '../components/WidgetPage'
import Auth from '../pages/Auth/Auth'
import Login from '../pages/Login'
import Logout from '../pages/Logout'
import Profile from '../pages/Profile'
import PublicRoute, { isPublicPath, PUBLIC_ROUTE_PATHS } from '../public/PublicPage'

import { type AppRoute, RoutesContext } from './RoutesContext'

// The authenticated area is a single persistent shell (the `Layout` widget from
// config INIT) rendered as a pathless layout route; every content route is a
// CHILD that renders into the shell's <Outlet/>. Login/Auth/Logout sit outside it
// (no chrome). Logout is a static route on purpose: it's the recovery escape hatch,
// so it must resolve even when the snowplow-driven shell pages fail to render.
// Dynamic routes are inserted into the shell's children by registerRoutes.
//
// The PUBLIC pages (public/PublicPage.tsx) sit outside the shell too, for a stronger reason than
// chrome: the shell is what provides the signed-in transport, so a page rendered outside it reads
// anonymously and cannot reach the stored token at all. The whole `/public/…` space is theirs — a
// navigation or Builder route there would be a shell child, and a static segment outranks the
// public route's dynamic one, so it would pull a public address back into the signed-in shell.
// Both kinds are dropped (and said so) instead.
const SHELL_ROUTE_ID = 'shell'

/** The paths the app serves itself — no Builder's route may take one. */
const STATIC_PATHS = ['/login', '/auth', '/logout', '/profile', '/public', ...PUBLIC_ROUTE_PATHS, '*']

/** Drop shell routes that would take a public address, naming each one. */
const outsidePublicSpace = (routes: RouteObject[], source: string): RouteObject[] => routes.filter((route) => {
  if (!isPublicPath(route.path)) { return true }
  console.warn(`[routes] ignored the ${source} route "${route.path}": /public/… addresses belong to public pages, outside the signed-in shell.`)
  return false
})

const defaultRoutes: RouteObject[] = [
  { element: <Login />, path: '/login' },
  { element: <Auth />, path: '/auth' },
  { element: <Logout />, path: '/logout' },
  ...PUBLIC_ROUTE_PATHS.map((path) => ({ element: <PublicRoute />, path })),
  {
    children: [
      { element: <Profile />, path: '/profile' },
      // The builders' authoring surfaces are inserted HERE once the Builder CRs are read from the
      // cluster (builders/clusterBuilders.ts → the RoutesProvider effect below): one route per
      // Builder, at its `spec.route`, each the composer host (builders/host/builderRoutes.tsx) —
      // /portal-builder/compose, /blueprint-builder/compose, /controller-builder/compose. Shell
      // children like /profile rather than CR-driven widget pages: a composer is React (drag and drop,
      // a live graph, a multi-file draft with undo), and what IS configuration about it is its Builder
      // CR, not widgetData. Until the read answers, the `*` fallthrough shows a loading state rather
      // than a 404 (WidgetPage); if it fails, the sentence saying why. A Builder never takes a path
      // the shell serves itself, and the navigation's routes replace a builder route at the same path.
      { element: <WidgetPage />, path: '*' },
    ],
    element: <ShellRoute />,
    id: SHELL_ROUTE_ID,
  },
]

export const RoutesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // use to force re-render the router when a new route is added
  const [routerVersion, setRouterVersion] = useState(0)
  const [routes, setRoutes] = useState<RouteObject[]>(defaultRoutes)
  const [menuRoutes, setMenuRoutes] = useState<AppRoute[]>([])
  const [isLoading] = useState(false)

  const queryClient = useQueryClient()

  // The Builders arrive after sign-in, from the cluster. Subscribed to the REGISTRY OBJECT, which
  // changes only when the Builders do — never on a `loading` status. And the routes are replaced only
  // when the set of (id, path) they mount changes: rebuilding them bumps routerVersion, a full
  // RouterProvider remount that would drop Agentiko's held draft and its streams. A re-read with the
  // same Builders reaches each composer through BuilderRouteHost instead.
  const registry = useSyncExternalStore(subscribeBuilders, currentBuilderRegistry)
  const mountedSignature = useRef('')
  useEffect(() => {
    const fresh = outsidePublicSpace(builderRoutes(STATIC_PATHS), 'Builder')
    const signature = builderRoutesSignature(fresh)
    if (signature === mountedSignature.current) { return }
    mountedSignature.current = signature
    setRoutes((prevRoutes) => {
      const shellIndex = prevRoutes.findIndex((route) => route.id === SHELL_ROUTE_ID)
      if (shellIndex === -1) { return prevRoutes }
      const shell = prevRoutes[shellIndex] as NonIndexRouteObject
      const children = shell.children ?? []
      const replaced = replaceBuilderRoutes(children, fresh)
      if (replaced === children) { return prevRoutes }
      const updatedRoutes = [...prevRoutes]
      updatedRoutes[shellIndex] = { ...shell, children: replaced }
      setRouterVersion((prev) => prev + 1)
      return updatedRoutes
    })
  }, [registry])

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
      const mergedChildren = mergeShellChildren(children, outsidePublicSpace(newRoutes, 'navigation'))
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
