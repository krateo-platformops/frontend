// @vitest-environment jsdom
/**
 * snowplow#777: chrome widgets must not inherit the page's route params or query string, and
 * page widgets must be byte-identical to before — their extras string is the react-query key and
 * the L1 cache cell key, so re-keying them would miss every warm cell in the fleet.
 */
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useParams, useSearchParams } from 'react-router'
import { describe, expect, it } from 'vitest'

import { WidgetScopeProvider, useWidgetScope } from '../context/WidgetScopeContext'

import { buildExtrasParam } from './useWidgetQuery'

/** What useWidgetQuery does with the scope, isolated from config/auth/fetch. */
const useEnvelope = () => {
  const [searchParams] = useSearchParams()
  const matched = useParams()
  const scope = useWidgetScope()
  return buildExtrasParam(
    scope === 'chrome' ? new URLSearchParams() : searchParams,
    scope === 'chrome' ? {} : matched,
    'Diego',
    'diego',
  )
}

/** Mounts at the Shell's level (a parent layout), under a child route that owns the params. */
const at = (url: string, wrap?: (children: ReactNode) => ReactNode) =>
  renderHook(useEnvelope, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route element={wrap ? wrap(children) : children} path='/compositions'>
            <Route element={null} path=':namespace/:name' />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  })

const CHROME = (children: ReactNode) => <WidgetScopeProvider scope='chrome'>{children}</WidgetScopeProvider>

describe('widget extras scope (snowplow#777)', () => {
  it('a PAGE widget is unchanged — the route params and query still reach it', () => {
    const { result } = at('/compositions/krateo-system/publish-spring-boot-app?range=24h')
    const extras = JSON.parse(result.current) as Record<string, string>
    expect(extras).toEqual({
      displayName: 'Diego',
      name: 'publish-spring-boot-app',
      namespace: 'krateo-system',
      range: '24h',
      username: 'diego',
    })
  })

  it('a CHROME widget inherits neither the params nor the query', () => {
    const { result } = at('/compositions/krateo-system/publish-spring-boot-app?range=24h', CHROME)
    expect(JSON.parse(result.current)).toEqual({ displayName: 'Diego', username: 'diego' })
  })

  it('chrome keeps ONE envelope across pages — this is the 74 declines', () => {
    const onComposition = at('/compositions/krateo-system/publish-spring-boot-app', CHROME).result.current
    const onAnother = at('/compositions/demo-system/publish-event-site?range=7d', CHROME).result.current
    expect(onAnother).toBe(onComposition)
  })

  it('a page widget is byte-identical with and without the provider in the tree', () => {
    const url = '/compositions/krateo-system/publish-spring-boot-app?range=24h'
    const bare = at(url).result.current
    const wrapped = at(url, (children) => <WidgetScopeProvider scope='page'>{children}</WidgetScopeProvider>).result.current
    // Not just deep-equal: the SAME STRING, because key order is the cache key.
    expect(wrapped).toBe(bare)
  })

  it('identity is not route input, so chrome still carries it', () => {
    const { result } = at('/compositions/krateo-system/x', CHROME)
    expect(JSON.parse(result.current)).toHaveProperty('username', 'diego')
  })
})
