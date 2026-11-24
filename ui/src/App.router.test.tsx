// @vitest-environment jsdom
/**
 * The router is built once: a route registered after the landing (the Menu's routes arrive after the
 * shell has mounted) re-matches the page through the shell's descendant routes and remounts nothing
 * above it. Rendered through the real AppInitializer and RoutesProvider; only the shell, the page and
 * the sign-in pages are stubbed, each counting its mounts.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { Outlet, useMatches } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppInitializer } from './App'
import { createRoute, useRoutesContext } from './context/RoutesContext'
import { RoutesProvider } from './context/RoutesProvider'
import { useWidgetQuery } from './hooks/useWidgetQuery'

const mounts = { page: 0, shell: 0 }
let shellMatches: string[] = []

vi.mock('./context/ConfigContext', () => ({ useConfigContext: () => ({ config: { api: { SNOWPLOW_API_BASE_URL: 'http://snowplow.test' } }, isLoading: false }) }))
vi.mock('./components/Shell', () => {
  const ShellStub = () => {
    useEffect(() => { mounts.shell += 1 }, [])
    shellMatches = useMatches().map(({ pathname }) => pathname)
    return <Outlet />
  }
  return { default: ShellStub }
})
vi.mock('./components/WidgetPage', () => {
  const WidgetPageStub = ({ defaultWidgetEndpoint }: { defaultWidgetEndpoint?: string }) => {
    useEffect(() => { mounts.page += 1 }, [])
    useWidgetQuery(defaultWidgetEndpoint ?? '/call?resource=flexes&name=none')
    return <p>{defaultWidgetEndpoint ? `page ${defaultWidgetEndpoint}` : 'fallthrough'}</p>
  }
  return { default: WidgetPageStub }
})
vi.mock('./pages/Auth/Auth', () => ({ default: () => null }))
vi.mock('./pages/Login', () => ({ default: () => null }))
vi.mock('./pages/Logout', () => ({ default: () => null }))
vi.mock('./pages/Profile', () => ({ default: () => null }))

let register: ReturnType<typeof useRoutesContext>['registerRoutes'] = () => undefined
const Probe = () => {
  register = useRoutesContext().registerRoutes
  return null
}

const COMPOSITION = { endpoint: '/call?resource=flexes&name={name}&namespace={namespace}', path: '/compositions/{namespace}/{name}' }

let fetched: string[] = []
/** The extras envelope of each read the page made, by widget name. */
const extrasOf = (name: string): string[] => fetched.map((url) => new URL(url)).filter(({ searchParams }) => searchParams.get('name') === name)
  .map(({ searchParams }) => searchParams.get('extras') ?? '')

beforeEach(() => {
  fetched = []
  vi.stubGlobal('fetch', vi.fn((url: string | URL) => {
    fetched.push(String(url))
    return Promise.resolve(new Response(JSON.stringify({ kind: 'Flex', status: { widgetData: {} } }), { status: 200 }))
  }))
  mounts.page = 0
  mounts.shell = 0
  window.history.replaceState(null, '', '/compositions/team-a/shop')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const mount = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <RoutesProvider>
      <Probe />
      <AppInitializer />
    </RoutesProvider>
  </QueryClientProvider>,
)

describe('the router is built once; registered routes re-match the page and remount nothing above it', () => {
  it('a route registered after the landing serves the page with its params, and the shell mounted once', async () => {
    mount()
    expect(await screen.findByText('fallthrough')).toBeTruthy()
    act(() => { register([createRoute(COMPOSITION)]) })
    expect(await screen.findByText('page /call?resource=flexes&name=shop&namespace=team-a')).toBeTruthy()
    expect(mounts.shell, 'the shell was not remounted by the registration').toBe(1)
  })

  it('the shell still sees the full address through useMatches, which the breadcrumb reads', async () => {
    mount()
    act(() => { register([createRoute(COMPOSITION)]) })
    await screen.findByText('page /call?resource=flexes&name=shop&namespace=team-a')
    expect(shellMatches.find((pathname) => pathname !== '/')).toBe('/compositions/team-a/shop')
  })

  it('a page’s reads carry its named route params and nothing of the route that serves it', async () => {
    mount()
    act(() => { register([createRoute(COMPOSITION)]) })
    await screen.findByText('page /call?resource=flexes&name=shop&namespace=team-a')
    await vi.waitFor(() => { expect(extrasOf('shop')).toHaveLength(1) })
    expect(JSON.parse(extrasOf('shop')[0])).toEqual({ name: 'shop', namespace: 'team-a' })
  })

  it('a page at a fixed address carries no route params', async () => {
    window.history.replaceState(null, '', '/fleet')
    mount()
    act(() => { register([createRoute({ endpoint: '/call?resource=flexes&name=fleet', path: '/fleet' })]) })
    await screen.findByText('page /call?resource=flexes&name=fleet')
    await vi.waitFor(() => { expect(extrasOf('fleet')).toEqual(['']) })
  })

  it('registering the same routes again, or another one, leaves the shell and the page mounted', async () => {
    mount()
    act(() => { register([createRoute(COMPOSITION)]) })
    await screen.findByText('page /call?resource=flexes&name=shop&namespace=team-a')
    const pageMounts = mounts.page
    act(() => { register([createRoute(COMPOSITION)]) })
    act(() => { register([createRoute({ endpoint: '/call?resource=flexes&name=fleet', path: '/fleet' })]) })
    expect(screen.getByText('page /call?resource=flexes&name=shop&namespace=team-a')).toBeTruthy()
    expect({ page: mounts.page, shell: mounts.shell }).toEqual({ page: pageMounts, shell: 1 })
  })
})
