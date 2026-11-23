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
import { Outlet } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppInitializer } from './App'
import { createRoute, useRoutesContext } from './context/RoutesContext'
import { RoutesProvider } from './context/RoutesProvider'

const mounts = { page: 0, shell: 0 }

vi.mock('./context/ConfigContext', () => ({ useConfigContext: () => ({ config: {}, isLoading: false }) }))
vi.mock('./components/Shell', () => {
  const ShellStub = () => {
    useEffect(() => { mounts.shell += 1 }, [])
    return <Outlet />
  }
  return { default: ShellStub }
})
vi.mock('./components/WidgetPage', () => {
  const WidgetPageStub = ({ defaultWidgetEndpoint }: { defaultWidgetEndpoint?: string }) => {
    useEffect(() => { mounts.page += 1 }, [])
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

beforeEach(() => {
  mounts.page = 0
  mounts.shell = 0
  window.history.replaceState(null, '', '/compositions/team-a/shop')
})
afterEach(() => { cleanup() })

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
