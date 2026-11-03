// @vitest-environment jsdom
/**
 * `http.route` must be the TEMPLATED route, and this is where that is decided.
 *
 * THE FAILURE BEING PREVENTED IS NOT A CRASH. `/compositions/krateo-system/foo-123` is a perfectly
 * good string: the span exports, the dashboard renders, and the metric quietly becomes one series
 * per composition until the consumer's 1,000-combination cap is exhausted and the whole aggregation
 * is useless (observability#90). Nothing in the browser or in CI says so. Only this test does.
 *
 * THE ROUTE TABLE IS BUILT BY THE APP'S OWN `createRoute`, not written out here. The portal's
 * routes arrive from the cluster as `/compositions/{namespace}/{name}` and RoutesContext converts
 * them; a hand-written `:namespace` fixture would agree with a hand-written matcher and prove
 * nothing about what the router actually holds — the same trap spanContract.instrumentation.test.ts
 * exists to avoid, where the fixture and the predicate shared one wrong belief. The nesting is the
 * app's too: a PATHLESS shell layout route whose children carry absolute paths, with the `*`
 * catch-all last.
 */
import type { RouteObject } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { createRoute } from '../context/RoutesContext'

import { isCompositionDetailRoute, templatedRouteOf } from './route'

// RoutesContext pulls the whole authenticated shell in with it; none of it is this file's subject.
vi.mock('../components/Shell', () => ({ default: () => null }))
vi.mock('../components/WidgetPage', () => ({ default: () => null }))
vi.mock('../pages/Auth/Auth', () => ({ default: () => null }))
vi.mock('../pages/Login', () => ({ default: () => null }))
vi.mock('../pages/Logout', () => ({ default: () => null }))
vi.mock('../pages/Profile', () => ({ default: () => null }))

/** The widgetData route spellings the cluster sends, through the app's own conversion. */
const detail = createRoute({
  endpoint: '/call?resource=compositions&name={name}&namespace={namespace}',
  path: '/compositions/{namespace}/{name}',
})
const list = createRoute({ endpoint: '/call?resource=compositions', path: '/compositions' })

const table: RouteObject[] = [
  { element: null, path: '/login' },
  {
    // The authenticated shell: pathless, so the templated route is the CHILD's absolute path.
    children: [
      { element: null, path: '/profile' },
      list,
      detail,
      { element: null, path: '*' },
    ],
    element: null,
    id: 'shell',
  },
]

describe('templatedRouteOf', () => {
  it('gives the PATTERN for a composition detail page, never the concrete path', () => {
    const route = templatedRouteOf(table, '/compositions/krateo-system/foo-123')
    expect(route).toBe('/compositions/:namespace/:name')
    // Said twice on purpose: this is the assertion the cap depends on, and `toBe` above would also
    // pass for a pattern that happened to contain a namespace.
    expect(route).not.toContain('krateo-system')
    expect(route).not.toContain('foo-123')
  })

  it('resolves a static page through the pathless shell', () => {
    expect(templatedRouteOf(table, '/profile')).toBe('/profile')
  })

  it('resolves a route outside the shell', () => {
    expect(templatedRouteOf(table, '/login')).toBe('/login')
  })

  it('is null for an address only the catch-all matches — a URL with no page is not a route', () => {
    expect(templatedRouteOf(table, '/nothing/here')).toBeNull()
  })

  it('is null before the cluster\'s routes have arrived', () => {
    // The table is the two default shells only at that point; the interaction is simply unmeasured
    // rather than measured under a made-up route.
    expect(templatedRouteOf([], '/compositions/ns/name')).toBeNull()
    expect(templatedRouteOf(undefined, '/compositions/ns/name')).toBeNull()
  })

  it('reports one spelling for a trailing slash', () => {
    expect(templatedRouteOf(table, '/profile/')).toBe('/profile')
  })
})

describe('isCompositionDetailRoute', () => {
  it('is true for the detail pattern the app mounts', () => {
    expect(isCompositionDetailRoute(templatedRouteOf(table, '/compositions/krateo-system/foo'))).toBe(true)
  })

  it('is false for the LIST — opening a list is not opening a composition', () => {
    expect(isCompositionDetailRoute(templatedRouteOf(table, '/compositions'))).toBe(false)
  })

  it('is false for another page, and for no route at all', () => {
    expect(isCompositionDetailRoute('/profile')).toBe(false)
    expect(isCompositionDetailRoute(null)).toBe(false)
  })
})
