// @vitest-environment jsdom
/**
 * R1 (WCAG 1.4.10, design/audits/x4-remediation-backlog-2026-11.md item 1): below `lg` the Sider
 * collapses to an icon rail, and the nav's names move into antd's collapsed-menu tooltip. antd
 * opens that tooltip on hover only; a keyboard user arrowing through bare icons would get no name
 * on screen, so the nav opens it on focus too. Outside a collapsed Sider there is no tooltip.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { Layout } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: '/compositions' }),
  useNavigate: () => vi.fn(),
}))
vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({ config: { params: { FRONTEND_NAMESPACE: 'krateo-system' } } }),
}))
vi.mock('../../context/RoutesContext', () => ({
  createRoute: (route: unknown) => route,
  useRoutesContext: () => ({ menuRoutes: [], registerRoutes: vi.fn(), updateMenuRoutes: vi.fn() }),
}))

const { Menu } = await import('./Menu')

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

afterEach(cleanup)

const items = [
  { icon: 'cubes', label: 'Compositions', order: 10, path: '/compositions' },
  { icon: 'layer-group', label: 'Blueprints', order: 20, path: '/blueprints' },
]

const renderNav = (collapsed: boolean) => render(
  <Layout.Sider collapsed={collapsed}>
    <Menu resourcesRefs={{ items: [] }} uid='nav' widgetData={{ allowedResources: ['flexes'], items, mode: 'inline' }} />
  </Layout.Sider>
)

const focusItem = (label: string) => {
  const item = screen.getAllByRole('menuitem').find((element) => element.textContent?.includes(label))!
  act(() => { item.focus() })
}

describe('R1 — the icon rail names each icon on keyboard focus', () => {
  it('collapsed: focusing an item opens a tooltip with its name', async () => {
    renderNav(true)
    focusItem('Blueprints')
    expect((await screen.findByRole('tooltip')).textContent).toContain('Blueprints')
  })

  it('collapsed: each item keeps its name as its accessible name, not only in the tooltip', () => {
    renderNav(true)
    expect(screen.getAllByRole('menuitem').map((element) => element.textContent)).toEqual(['Compositions', 'Blueprints'])
  })

  it('expanded: the label is on screen, so focus opens no tooltip', async () => {
    renderNav(false)
    focusItem('Blueprints')
    await new Promise((resolve) => { setTimeout(resolve, 300) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
