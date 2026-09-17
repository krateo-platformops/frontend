// @vitest-environment jsdom
/**
 * Regression guard for "header projects, when selected, are not kept selected when navigating
 * another page".
 *
 * The header's project switcher stores its selection ONLY in `?projects=` (widgets/Select in
 * queryParam mode, which useWidgetQuery forwards as every widget's `extras`). The sidebar nav
 * navigated to `item.key` — a BARE pathname — so the very first click dropped the query and the
 * scope reset to "All projects". The Menu now goes through utils/navigation, which carries the
 * global scope params across a page change while leaving page-local filters behind.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppRoute } from '../../context/RoutesContext'

const navigateMock = vi.fn()
const locationRef = { current: { pathname: '/compositions' } }
const menuRoutesRef: { current: AppRoute[] } = { current: [] }

vi.mock('react-router', () => ({
  useLocation: () => locationRef.current,
  useNavigate: () => navigateMock,
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
  { label: 'Blueprints', order: 20, path: '/blueprints' },
]

const renderMenu = (url: string) => {
  window.history.replaceState({}, '', url)
  locationRef.current = { pathname: new URL(url, 'http://localhost').pathname }

  return render(<Menu resourcesRefs={{ items: [] }} uid='nav' widgetData={{ allowedResources: ['pages'], items }} />)
}

beforeEach(() => {
  navigateMock.mockClear()
  menuRoutesRef.current = []
})
afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

describe('sidebar nav — the selected projects survive a page change', () => {
  it('keeps ?projects= when navigating to another page', () => {
    renderMenu('/compositions?projects=alpha,beta')
    fireEvent.click(screen.getByText('Blueprints'))

    expect(navigateMock).toHaveBeenCalledWith('/blueprints?projects=alpha%2Cbeta')
  })

  it('leaves a page-local filter behind — only the scope travels', () => {
    renderMenu('/compositions?projects=alpha&status=failed')
    fireEvent.click(screen.getByText('Blueprints'))

    expect(navigateMock).toHaveBeenCalledWith('/blueprints?projects=alpha')
  })

  it('navigates bare when no project is selected (a cleared scope stays cleared)', () => {
    renderMenu('/compositions')
    fireEvent.click(screen.getByText('Blueprints'))

    expect(navigateMock).toHaveBeenCalledWith('/blueprints')
  })

  it('keeps the scope through the "/" → first-nav-page redirect', () => {
    menuRoutesRef.current = [{ path: '/compositions', resourceRefId: 'compositions' }]
    renderMenu('/?projects=alpha')

    expect(navigateMock).toHaveBeenCalledWith('/compositions?projects=alpha')
  })
})
