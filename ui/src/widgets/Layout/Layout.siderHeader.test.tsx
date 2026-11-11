// @vitest-environment jsdom
/**
 * The Sider's own header slots, `sider.header` and `sider.collapsedHeader`: a portal's full logo
 * while the Sider is expanded, a compact one while it is collapsed to the icon rail. The Layout
 * learns the collapsed state from antd's Sider, which reports both its `breakpoint` (below `lg` by
 * default) and its trigger.
 *
 * WidgetRenderer stands in for the Image widgets the slots reference: each endpoint renders the
 * image an Image CR would, so a test can tell which one is on screen by its `src` and check that
 * the logo keeps its name in both states.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellSlotsProvider } from '../../components/Shell/ShellSlots'
import type { ShellSlots } from '../../components/Shell/ShellSlots'
import { setViewportWidth } from '../../test/viewportWidth'
import type { ResourcesRefs } from '../../types/Widget'

import Layout, { type LayoutWidgetData } from './Layout'

const LOGO = '/call?resource=images&name=brand-logo'
const GLYPH = '/call?resource=images&name=brand-glyph'
const NAV = '/call?resource=menus&name=sidebar-nav'

vi.mock('../../components/WidgetRenderer', () => ({
  default: ({ widgetEndpoint }: { widgetEndpoint: string }) => (
    widgetEndpoint === NAV
      ? <nav aria-label='Primary'><a href='/compositions'>Compositions</a></nav>
      : <img alt='Krateo PlatformOps' src={widgetEndpoint} />
  ),
}))

vi.stubGlobal('ResizeObserver', class {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
})

afterEach(cleanup)

const ref = (id: string, path: string) => ({ allowed: true, id, path, payload: {}, verb: 'GET' as const })

const resourcesRefs: ResourcesRefs = {
  items: [ref('brand', LOGO), ref('brand-compact', GLYPH), ref('sider-content', NAV)],
}

const shellSlots: ShellSlots = {
  content: <p>the page</p>,
  header: <button type='button'>Account menu</button>,
}

const widgetData = (sider: Partial<NonNullable<LayoutWidgetData['sider']>>): LayoutWidgetData => ({
  hasSider: true,
  sider: { resourceRefId: 'sider-content', width: 236, ...sider },
})

const shell = (data: LayoutWidgetData, slots: ShellSlots = shellSlots): ReactNode => (
  <ShellSlotsProvider value={slots}>
    <Layout resourcesRefs={resourcesRefs} uid='app-shell' widgetData={data} />
  </ShellSlotsProvider>
)

const renderAt = (width: number, data: LayoutWidgetData, slots?: ShellSlots) => {
  setViewportWidth(width)
  return render(shell(data, slots))
}

/** The Sider that sits in the layout, beside the page (not the one inside the phone drawer). */
const inLayoutSider = (container: HTMLElement) => container.querySelector<HTMLElement>('.ant-layout-has-sider > .ant-layout-sider')!

const isCollapsed = (container: HTMLElement) => inLayoutSider(container).classList.contains('ant-layout-sider-collapsed')

/** The logo on screen, found by its name, so each assertion also holds that it HAS one. */
const logoSrc = () => screen.getByRole('img', { name: 'Krateo PlatformOps' }).getAttribute('src')

const BOTH = { collapsedHeader: 'brand-compact', header: 'brand' }

describe('the Sider header follows the collapsed state', () => {
  it('1440 px, expanded: `header` (the full logo), and not the compact one', () => {
    const { container } = renderAt(1440, widgetData(BOTH))
    expect(isCollapsed(container)).toBe(false)
    expect(logoSrc()).toBe(LOGO)
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('900 px, collapsed by the breakpoint: `collapsedHeader` (the compact logo), with the same name', () => {
    const { container } = renderAt(900, widgetData(BOTH))
    expect(isCollapsed(container), 'below lg the Sider is the icon rail').toBe(true)
    expect(logoSrc()).toBe(GLYPH)
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('1440 px, collapsed by the trigger: `collapsedHeader`, and `header` again when it is expanded', () => {
    const { container } = renderAt(1440, widgetData({ ...BOTH, collapsible: true }))
    const trigger = container.querySelector<HTMLElement>('.ant-layout-sider-trigger')!
    expect(logoSrc()).toBe(LOGO)

    fireEvent.click(trigger)
    expect(isCollapsed(container)).toBe(true)
    expect(logoSrc()).toBe(GLYPH)

    fireEvent.click(trigger)
    expect(isCollapsed(container)).toBe(false)
    expect(logoSrc()).toBe(LOGO)
  })

  it('the header sits above the Sider\'s content', () => {
    const { container } = renderAt(1440, widgetData(BOTH))
    const logo = screen.getByRole('img', { name: 'Krateo PlatformOps' })
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(inLayoutSider(container).contains(logo)).toBe(true)
    expect(logo.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('390 px, in the phone drawer: the Sider is full width there, so `header`', () => {
    renderAt(390, widgetData(BOTH))
    // The drawer is pre-rendered while closed, so its content is in the document but hidden.
    const images = [...document.querySelectorAll('img')]
    expect(images.map((image) => image.getAttribute('src'))).toEqual([LOGO])
  })
})

describe('only `header` set: today\'s behaviour, the one logo in both states', () => {
  it('1440 px, expanded', () => {
    renderAt(1440, widgetData({ header: 'brand' }))
    expect(logoSrc()).toBe(LOGO)
  })

  it('900 px, collapsed by the breakpoint', () => {
    const { container } = renderAt(900, widgetData({ header: 'brand' }))
    expect(isCollapsed(container)).toBe(true)
    expect(logoSrc()).toBe(LOGO)
  })
})

describe('neither set: nothing changes', () => {
  // The column holds exactly what it held before the slots existed: the shell's sider header,
  // the body (the CR's resourceRefId) and the shell's sider footer, in that order.
  const slots: ShellSlots = { ...shellSlots, siderFooter: <footer>the user</footer>, siderHeader: <p>the eyebrow</p> }

  for (const width of [1440, 900]) {
    it(`${width} px: no header element, the column is eyebrow, body, footer`, () => {
      const { container } = renderAt(width, widgetData({}), slots)
      const column = inLayoutSider(container).querySelector('.ant-layout-sider-children')!.firstElementChild!
      const children = [...column.children]
      expect(children).toHaveLength(3)
      expect(children[0].textContent).toBe('the eyebrow')
      expect(children[1].querySelector('nav[aria-label="Primary"]')).not.toBeNull()
      expect(children[2].textContent).toBe('the user')
      expect(screen.queryByRole('img')).toBeNull()
    })
  }
})
