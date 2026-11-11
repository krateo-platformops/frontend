// @vitest-environment jsdom
/**
 * THE SIDEBAR'S SECTIONS, ICONS AND SELECTED ROW.
 *
 * Every portal page declares a `krateo.io/nav-group`, and restaction.sidebar-nav passes it through
 * on each item. A run of consecutive entries (in `order`) with the same group renders under one
 * heading carrying its name; an entry with no group renders with no heading, so a nav from before
 * groups existed looks exactly as it did. Each entry shows its page's icon, which the Menu's CSS
 * used to hide (`display: none`), and the selected row is a tint plus an accent bar, not a block.
 *
 * Geometry (one left edge, row height, the header band) needs a layout engine and is measured in
 * Chromium by visual/sidebar.spec.ts; the colours' contrast on the rail is in
 * theme/tokens.contrast.test.ts. This holds the structure and which tokens the stylesheet paints with.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { library } from '@fortawesome/fontawesome-svg-core'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: '/compositions/krateo-system' }),
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

// The app registers the solid set at startup (App.tsx); the nav's icons are names in it.
library.add(fas)

vi.stubGlobal('ResizeObserver', class {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
})

afterEach(cleanup)

type Item = { group?: string; icon?: string; label?: string; order: number; path?: string; type?: 'divider' }

const renderNav = (items: Item[]) => render(
  <Menu resourcesRefs={{ items: [] }} uid='nav' widgetData={{ allowedResources: ['flexes'], items, mode: 'inline' }} />
)

/** The sidebar as read top to bottom: `# Heading` for a group title, the label for an entry. */
const outlineOf = (element: Element) => {
  if (element.classList.contains('ant-menu-item-group-title')) { return `# ${element.textContent}` }
  if (element.classList.contains('ant-menu-item-divider')) { return '---' }
  return element.textContent
}
const outline = (container: HTMLElement) => [...container.querySelectorAll('.ant-menu-item-group-title, .ant-menu-item, .ant-menu-item-divider')].map(outlineOf)

const GROUPED: Item[] = [
  { icon: 'fa-gauge', label: 'Dashboard', order: 1, path: '/dashboard' },
  { group: 'Workspace', icon: 'fa-cubes', label: 'Compositions', order: 10, path: '/compositions' },
  { group: 'Workspace', icon: 'fa-layer-group', label: 'Blueprints', order: 11, path: '/blueprints' },
  { group: 'Operate', icon: 'fa-triangle-exclamation', label: 'Incidents', order: 20, path: '/incidents' },
  // Out of order on purpose: entries sort by `order` before they are grouped.
  { group: 'Workspace', icon: 'fa-store', label: 'Marketplace', order: 12, path: '/marketplace' },
  { group: 'Operate', icon: 'fa-bell', label: 'Alerts', order: 21, path: '/alerts' },
  // A route-only item (no label) is no entry, so it neither opens nor ends a group.
  { group: 'Operate', order: 22, path: '/alerts/{name}' },
]

describe('group headings', () => {
  it('a run of entries with the same nav-group renders under one heading, in order', () => {
    const { container } = renderNav(GROUPED)
    expect(outline(container)).toEqual([
      'Dashboard',
      '# Workspace', 'Compositions', 'Blueprints', 'Marketplace',
      '# Operate', 'Incidents', 'Alerts',
    ])
  })

  it('each heading names its section for assistive tech: the entries sit in a role=group list under it', () => {
    const { container } = renderNav(GROUPED)
    const titles = [...container.querySelectorAll('.ant-menu-item-group-title')]
    expect(titles.map((title) => title.textContent)).toEqual(['Workspace', 'Operate'])
    const lists = screen.getAllByRole('group')
    expect(lists.map((list) => within(list).getAllByRole('menuitem').map((item) => item.textContent))).toEqual([
      ['Compositions', 'Blueprints', 'Marketplace'],
      ['Incidents', 'Alerts'],
    ])
  })

  it('without nav-groups there are no headings and the dividers stay, as before', () => {
    const { container } = renderNav([
      { label: 'Dashboard', order: 1, path: '/dashboard' },
      { order: 5, type: 'divider' },
      { label: 'Compositions', order: 10, path: '/compositions' },
    ])
    expect(outline(container)).toEqual(['Dashboard', '---', 'Compositions'])
    expect(screen.queryAllByRole('group')).toEqual([])
  })

  it('a group that is interrupted opens again with its heading, so `order` always wins over grouping', () => {
    const { container } = renderNav([
      { group: 'Operate', label: 'Incidents', order: 1, path: '/incidents' },
      { label: 'Dashboard', order: 2, path: '/dashboard' },
      { group: 'Operate', label: 'Alerts', order: 3, path: '/alerts' },
    ])
    expect(outline(container)).toEqual(['# Operate', 'Incidents', 'Dashboard', '# Operate', 'Alerts'])
  })
})

describe('icons and the selected row', () => {
  it('every entry with a nav-icon draws it, an fa- prefixed name included', () => {
    renderNav(GROUPED)
    const icons = screen.getAllByRole('menuitem').map((item) => item.querySelector('svg.ant-menu-item-icon')?.getAttribute('data-icon'))
    expect(icons).toEqual(['gauge', 'cubes', 'layer-group', 'store', 'triangle-exclamation', 'bell'])
  })

  it('the longest-prefix entry is selected even inside a group', () => {
    renderNav(GROUPED)
    const selected = screen.getAllByRole('menuitem').filter((item) => item.classList.contains('ant-menu-item-selected'))
    expect(selected.map((item) => item.textContent)).toEqual(['Compositions'])
  })

  it('a row starts 8px in (antd\'s inline indent), so inside the Sider\'s 16px its icon is on x = 24', () => {
    renderNav(GROUPED)
    expect(screen.getAllByRole('menuitem').map((item) => item.style.paddingLeft)).toEqual(Array(6).fill('8px'))
  })
})

describe('Menu.module.css paints with the sidebar tokens', () => {
  const css = readFileSync(join(__dirname, 'Menu.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  /** The body of the first rule whose selector is exactly `selector`. */
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|[;{}\\s])${escaped}\\s*\\{([^{}]*)\\}`).exec(css)?.[1] ?? ''
  }

  it('icons are shown: nothing hides .ant-menu-item-icon', () => {
    expect(css).not.toMatch(/ant-menu-item-icon\)[^{]*\{[^}]*display:\s*none/)
  })

  it('the selected row is the --menuitembg-color tint, not a solid block, with a 3px bar in the selected-bar token', () => {
    expect(rule(':global(.ant-menu-item-selected)')).toMatch(/background-color:\s*var\(--menuitembg-color\)/)
    const bar = rule(':global(.ant-menu-item-selected)::before')
    expect(bar).toMatch(/background:\s*var\(--krateo-nav-item-selected-bar\)/)
    expect(bar).toMatch(/width:\s*3px/)
    expect(bar).toMatch(/left:\s*0/)
  })

  it('a group heading is 11px / 600, uppercase, +0.08em, in the nav-group token', () => {
    const heading = rule(':global(.ant-menu-item-group-title)')
    expect(heading).toMatch(/color:\s*var\(--krateo-nav-group\)/)
    expect(heading).toMatch(/font-size:\s*var\(--krateo-text-label-sm\)/)
    expect(heading).toMatch(/font-weight:\s*var\(--font-weight-bold\)/)
    expect(heading).toMatch(/letter-spacing:\s*0\.08em/)
    expect(heading).toMatch(/text-transform:\s*uppercase/)
  })
})
