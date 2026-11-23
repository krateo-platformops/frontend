// @vitest-environment jsdom
/**
 * The builder routes appear once the Builders are read, not before (ADR 0001): the shell starts with
 * none, a load mounts one per Builder before the `*` fallthrough, a failed read mounts none, and a
 * navigation route at a Builder's path still wins. The registry is driven directly — no network.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import type { NonIndexRouteObject, RouteObject } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { failBuilders, installBuilders, markBuildersLoading } from '../builders/builderRegistry'
import { fixtureBuilders } from '../builders/fixtures/fixtureBuilders'

import { useRoutesContext } from './RoutesContext'
import { RoutesProvider } from './RoutesProvider'

vi.mock('../components/Shell', () => ({ default: () => null }))
vi.mock('../components/WidgetPage', () => ({ default: () => null }))
vi.mock('../pages/Auth/Auth', () => ({ default: () => null }))
vi.mock('../pages/Login', () => ({ default: () => null }))
vi.mock('../pages/Logout', () => ({ default: () => null }))
vi.mock('../pages/Profile', () => ({ default: () => null }))

let context: ReturnType<typeof useRoutesContext> | undefined

const Probe = () => {
  context = useRoutesContext()
  return null
}

const shellPaths = (): (string | undefined)[] => {
  const shell = context!.routes.find((route) => route.id === 'shell') as NonIndexRouteObject
  return (shell.children ?? []).map((route: RouteObject) => route.path)
}

const BUILDER_PATHS = ['/portal-builder/compose', '/blueprint-builder/compose', '/controller-builder/compose']

const mount = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <RoutesProvider><Probe /></RoutesProvider>
  </QueryClientProvider>,
)

afterEach(() => {
  act(() => { installBuilders(fixtureBuilders()) })
  context = undefined
})

describe('RoutesContext — the builder routes follow the cluster read', () => {
  it('none while the read is in flight; each Builder\'s route, before the catch-all, once it answers', () => {
    act(() => {
      failBuilders('emptied for this test')
      markBuildersLoading()
    })
    mount()
    expect(shellPaths()).toEqual(['/profile', '*'])
    act(() => { installBuilders(fixtureBuilders()) })
    expect(shellPaths()).toEqual(['/profile', ...BUILDER_PATHS, '*'])
    // The router is rebuilt, so the path the person is already on now resolves to its composer.
  })

  it('a failed read mounts no builder route — the catch-all then says why (WidgetPage)', () => {
    mount()
    expect(shellPaths()).toEqual(['/profile', ...BUILDER_PATHS, '*'])
    act(() => { failBuilders('snowplow could not be reached.') })
    expect(shellPaths()).toEqual(['/profile', '*'])
  })

  it('a navigation route at a Builder\'s path still wins over a later load', () => {
    act(() => { failBuilders('not yet') })
    mount()
    act(() => { context!.registerRoutes([{ id: 'nav', path: '/portal-builder/compose' }]) })
    act(() => { installBuilders(fixtureBuilders()) })
    const shell = context!.routes.find((route) => route.id === 'shell') as NonIndexRouteObject
    expect((shell.children ?? []).filter((route) => route.path === '/portal-builder/compose').map((route) => route.id)).toEqual(['nav'])
    expect(shellPaths()).toEqual(expect.arrayContaining(BUILDER_PATHS))
  })
})

describe('RoutesContext — the menu routes follow their addresses', () => {
  const route = (path?: string) => ({ endpoint: path ?? '/call?name=page-x', path: '/x', resourceRef: path ? { allowed: true, id: 'x', path, payload: {}, verb: 'GET' as const } : undefined, resourceRefId: 'x' })
  it('a ref that resolves on a retry replaces the address; equal content keeps the same list', () => {
    mount()
    act(() => { context!.updateMenuRoutes([route()]) })
    const unresolved = context!.menuRoutes
    act(() => { context!.updateMenuRoutes([route()]) })
    expect(context!.menuRoutes).toBe(unresolved)
    act(() => { context!.updateMenuRoutes([route('/call?name=page-x&namespace=team')]) })
    expect(context!.menuRoutes[0].resourceRef?.path).toBe('/call?name=page-x&namespace=team')
  })
})

describe('RoutesContext — a re-read with the same Builders never replaces the builder routes', () => {
  it('neither `loading` nor a re-install of the same (name, route) set touches the routes', () => {
    mount()
    const { routes } = context!
    act(() => { markBuildersLoading() })
    act(() => { installBuilders(fixtureBuilders()) })
    // A new table re-matches the shell's children, and a replaced route object remounts the composer it serves.
    expect(context!.routes).toBe(routes)
  })

  it('a changed set does replace them', () => {
    mount()
    const [portal, blueprint] = fixtureBuilders().builders
    act(() => { installBuilders({ builders: [portal, blueprint], problems: [] }) })
    expect(shellPaths()).toEqual(['/profile', '/portal-builder/compose', '/blueprint-builder/compose', '*'])
  })
})
