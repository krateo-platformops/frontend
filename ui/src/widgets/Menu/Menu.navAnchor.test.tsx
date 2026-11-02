// @vitest-environment jsdom
/**
 * The nav-anchor contract, pinned end to end against a REAL render: the Menu widget stamps
 * `navAnchor`'s attributes, and `findNavItem` — which the Autopilot tour resolves `nav:<Label>`
 * steps through — finds the rendered row by them.
 *
 * This is the loud half of the fix. The tour's miss is silent on purpose (a step with no target
 * renders centered), so nothing at runtime would report the hook having stopped reaching the DOM
 * — whether because someone dropped the stamp here, or because an antd upgrade stopped
 * forwarding `data-*` from an item descriptor to its `<li>`. Either way this test goes red,
 * which is the only reason it is worth having.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppRoute } from '../../context/RoutesContext'

import { NAV_ITEM_ATTRIBUTE, NAV_ROOT_ATTRIBUTE, findNavItem } from './navAnchor'

const menuRoutesRef: { current: AppRoute[] } = { current: [] }

vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: '/compositions' }),
  useNavigate: () => vi.fn(),
}))
vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({ config: { params: { FRONTEND_NAMESPACE: 'krateo-system' } } }),
}))
vi.mock('../../context/RoutesContext', () => ({
  createRoute: (route: unknown) => route,
  useRoutesContext: () => ({
    menuRoutes: menuRoutesRef.current,
    registerRoutes: vi.fn(),
    updateMenuRoutes: vi.fn(),
  }),
}))

const { Menu } = await import('./Menu')

// jsdom lacks the browser APIs antd's Menu touches (responsive overflow).
vi.stubGlobal('ResizeObserver', class {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
})
vi.stubGlobal('matchMedia', (query: string) => ({
  addEventListener: vi.fn(),
  addListener: vi.fn(),
  dispatchEvent: vi.fn(() => false),
  matches: false,
  media: query,
  onchange: null,
  removeEventListener: vi.fn(),
  removeListener: vi.fn(),
}))

const items = [
  { label: 'Compositions', order: 10, path: '/compositions' },
  { order: 15, type: 'divider' as const },
  { icon: 'cubes', label: 'Blueprints', order: 20, path: '/blueprints' },
]

const renderMenu = (navItems: unknown[] = items) =>
  render(<Menu resourcesRefs={{ items: [] }} uid='nav' widgetData={{ allowedResources: ['pages'], items: navItems as never }} />)

beforeEach(() => {
  menuRoutesRef.current = []
})
afterEach(() => {
  cleanup()
})

describe('the sidebar nav carries our own anchors', () => {
  it('stamps the nav root', () => {
    renderMenu()

    expect(document.querySelectorAll(`[${NAV_ROOT_ATTRIBUTE}]`)).toHaveLength(1)
  })

  it('stamps every nav row with its label, verbatim', () => {
    renderMenu()

    const stamped = [...document.querySelectorAll(`[${NAV_ITEM_ATTRIBUTE}]`)]

    expect(stamped.map((el) => el.getAttribute(NAV_ITEM_ATTRIBUTE))).toEqual(['Compositions', 'Blueprints'])
    // On the <li> itself, not on some inner node — the tour spotlights the whole row.
    expect(stamped.map((el) => el.tagName)).toEqual(['LI', 'LI'])
  })

  it('stamps nothing on a divider', () => {
    renderMenu()

    expect(document.querySelectorAll(`[class*="divider"][${NAV_ITEM_ATTRIBUTE}]`)).toHaveLength(0)
  })

  it('findNavItem resolves a rendered row — the contract the Autopilot tour reads', () => {
    renderMenu()

    const lookup = findNavItem('Blueprints')

    expect(lookup.status).toBe('found')
    expect(lookup.element).toBe(document.querySelector(`[${NAV_ITEM_ATTRIBUTE}="Blueprints"]`))
  })

  it('findNavItem reports a label this nav does not have as absent, not as a broken hook', () => {
    renderMenu()

    expect(findNavItem('Marketplace')).toEqual({ element: null, status: 'absent' })
  })

  it('findNavItem reports an RBAC-emptied nav as absent — no rows is not a broken hook', () => {
    renderMenu([])

    expect(findNavItem('Compositions')).toEqual({ element: null, status: 'absent' })
  })

  it('keeps the label readable as text too, so action:/text: anchors still see it', () => {
    renderMenu()

    expect(document.querySelector(`[${NAV_ITEM_ATTRIBUTE}="Compositions"]`)?.textContent).toContain('Compositions')
  })
})
