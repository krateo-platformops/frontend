// @vitest-environment jsdom
/**
 * Which namespace a public address reads, when the config does not name the public-pages one.
 *
 * The trap (PublicPage.trap.test.tsx) renders the real app with one config for the whole file, and
 * the app caches its config across renders, so a config WITHOUT `PUBLIC_NAMESPACE` is tested here,
 * on the route element with the config provided directly. The case is an older chart (no
 * `publicNamespace` value, so no `params.PUBLIC_NAMESPACE`) under a newer image: a short address
 * must open nothing and say why, and must never read from FRONTEND_NAMESPACE, which is
 * krateo-system.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FiltersProvider from '../components/FiltesProvider/FiltersProvider'
import { type Config, ConfigContext } from '../context/ConfigContext'

import { NO_PUBLIC_NAMESPACE, PUBLIC_ROUTE_PATHS, PublicRoute } from './PublicPage'

const SNOWPLOW = 'http://snowplow.test'

const configWith = (params: Record<string, string>) => ({
  api: { SNOWPLOW_API_BASE_URL: SNOWPLOW },
  params: { DELAY_SAVE_NOTIFICATION: '10000', FRONTEND_NAMESPACE: 'krateo-system', ...params },
}) as unknown as Config

const fakeFetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ code: 403, kind: 'Status', status: 'Failure' }), {
  headers: { 'Content-Type': 'application/json' },
  status: 403,
})))

/** The providers App puts above every route (App.tsx), with the config given directly. */
const openAt = (address: string, config: Config) => render(
  <ConfigContext.Provider value={{ config, isLoading: false, refetch: vi.fn() } as never}>
    <AntdApp>
      <FiltersProvider>
        <MemoryRouter initialEntries={[address]}>
          <Routes>
            {PUBLIC_ROUTE_PATHS.map((path) => <Route element={<PublicRoute />} key={path} path={path} />)}
          </Routes>
        </MemoryRouter>
      </FiltersProvider>
    </AntdApp>
  </ConfigContext.Provider>,
)

const snowplowUrls = () => fakeFetch.mock.calls.map((call) => String((call as unknown[])[0])).filter((url) => url.startsWith(SNOWPLOW))

beforeEach(() => {
  fakeFetch.mockClear()
  vi.stubGlobal('fetch', fakeFetch)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('a short public address on a config with no public-pages namespace', () => {
  it('is not shared, says the installation names no namespace for public pages, and asks snowplow nothing', async () => {
    openAt('/public/demo', configWith({}))

    expect(await screen.findByText("This page isn't public")).toBeTruthy()
    expect(screen.getByText(NO_PUBLIC_NAMESPACE)).toBeTruthy()
    // Nothing read at all, so nothing read from FRONTEND_NAMESPACE (krateo-system).
    expect(snowplowUrls()).toEqual([])
  })

  it('treats an empty PUBLIC_NAMESPACE the same way', async () => {
    openAt('/public/demo', configWith({ PUBLIC_NAMESPACE: '' }))

    expect(await screen.findByText(NO_PUBLIC_NAMESPACE)).toBeTruthy()
    expect(snowplowUrls()).toEqual([])
  })

  it('leaves /public/:namespace/:slug as it is: it reads in the namespace the address names', async () => {
    openAt('/public/team-a/demo', configWith({}))

    await waitFor(() => { expect(snowplowUrls().length).toBeGreaterThan(0) })
    const url = new URL(snowplowUrls()[0])
    expect(url.searchParams.get('name')).toBe('page-demo')
    expect(url.searchParams.get('namespace')).toBe('team-a')
    expect(screen.queryByText(NO_PUBLIC_NAMESPACE)).toBeNull()
  })
})
