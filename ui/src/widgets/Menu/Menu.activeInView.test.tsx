// @vitest-environment jsdom
/**
 * The selected row is scrolled into the rail's view (UX audit SB-1, 2026-11-25). On a laptop the nav
 * is longer than the rail, and a page low in it (Clusters, Service desk), opened from a link, was
 * selected below the fold with nothing to say so. Whether the row then IS in view needs a layout
 * engine; this holds that the selected row is the one asked, `nearest` (a visible row stays put), and
 * that it is asked again when the selection changes.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockPathname = '/dashboard'
vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: mockPathname }),
  useNavigate: () => vi.fn(),
}))
vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({ config: { params: { FRONTEND_NAMESPACE: 'krateo-system' } } }),
}))
vi.mock('../../context/RoutesContext', () => ({
  createRoute: (route: unknown) => route,
  useRoutesContext: () => ({ menuRoutes: [], registerRoutes: vi.fn(), updateMenuRoutes: vi.fn() }),
}))
vi.stubGlobal('ResizeObserver', class {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
})

const { Menu } = await import('./Menu')

const ITEMS = [
  { label: 'Dashboard', order: 1, path: '/dashboard' },
  { group: 'Administration', label: 'Settings', order: 50, path: '/settings' },
  { group: 'Administration', label: 'Clusters', order: 51, path: '/clusters' },
  { group: 'Platform', label: 'Service desk', order: 60, path: '/service-desk' },
]

const nav = () => <Menu resourcesRefs={{ items: [] }} uid='nav' widgetData={{ allowedResources: ['flexes'], items: ITEMS, mode: 'inline' }} />

const scrolled = vi.fn()
beforeEach(() => {
  scrolled.mockClear()
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element, options?: boolean | ScrollIntoViewOptions) { scrolled(this.textContent, options) }
})
afterEach(cleanup)

describe('the selected row is brought into the rail\'s view', () => {
  it('a page low in the nav, opened directly: its row is scrolled to, nearest', () => {
    mockPathname = '/service-desk/requests/zr-admin-1795190153'
    render(nav())
    expect(scrolled).toHaveBeenCalledWith('Service desk', { block: 'nearest' })
    expect(scrolled).toHaveBeenCalledTimes(1)
  })

  it('a new selection is scrolled to again; the same one is not', () => {
    mockPathname = '/dashboard'
    const { rerender } = render(nav())
    mockPathname = '/clusters'
    rerender(nav())
    mockPathname = '/clusters/gke-1'
    rerender(nav())
    expect(scrolled.mock.calls.map(([label]) => label as string)).toEqual(['Dashboard', 'Clusters'])
  })

  it('an address no entry owns selects nothing and scrolls nothing', () => {
    mockPathname = '/profile'
    render(nav())
    expect(scrolled).not.toHaveBeenCalled()
  })
})
