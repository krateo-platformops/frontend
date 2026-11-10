// @vitest-environment jsdom
/**
 * R1 (WCAG 1.4.10 Reflow, design/audits/x4-remediation-backlog-2026-11.md item 1): the shell's
 * responsive default. The app-shell Layout CR sets none of the Sider's responsive props, so these
 * render a Layout whose `sider` names only a width, as the portal's does, at the widths the audit
 * measured, with a matchMedia that answers for that width (src/test/viewportWidth.ts).
 *
 *   ≥ 992 px  the full Sider, unchanged
 *   < 992 px  antd's collapsed Sider: the icon rail
 *   < 768 px  no Sider in the layout; a header button opens its content in a Drawer
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellSlotsProvider } from '../../components/Shell/ShellSlots'
import type { ShellSlots } from '../../components/Shell/ShellSlots'
import { setViewportWidth } from '../../test/viewportWidth'

import Layout, { type LayoutWidgetData } from './Layout'

vi.stubGlobal('ResizeObserver', class {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
})

afterEach(cleanup)

// The sider's nav stands in for the chart's Menu: a link to find, inside the region that moves.
const shellSlots = (routeKey = '/dashboard'): ShellSlots => ({
  content: <p>the page</p>,
  header: <button type='button'>Account menu</button>,
  routeKey,
  siderHeader: <nav aria-label='Primary'><a href='/compositions'>Compositions</a></nav>,
})

const widgetData = (sider: LayoutWidgetData['sider'] = { width: 236 }): LayoutWidgetData => ({ hasSider: true, sider })

const shell = (data: LayoutWidgetData, slots: ShellSlots): ReactNode => (
  <ShellSlotsProvider value={slots}>
    <Layout resourcesRefs={{ items: [] }} uid='app-shell' widgetData={data} />
  </ShellSlotsProvider>
)

const renderAt = (width: number, data = widgetData(), slots = shellSlots()) => {
  setViewportWidth(width)
  const view = render(shell(data, slots))
  return { ...view, rerenderWith: (next: ShellSlots) => view.rerender(shell(data, next)) }
}

/** The Sider that sits in the layout, beside the page (not the one inside the phone drawer). */
const inLayoutSider = (container: HTMLElement) => container.querySelector<HTMLElement>('.ant-layout-has-sider > .ant-layout-sider')

const menuButton = () => screen.queryByRole('button', { name: 'Navigation menu' })

describe('R1 — the shell reflows by default (the CR sets no breakpoint)', () => {
  it('1440 px: the full 236 px Sider, no menu button', () => {
    const { container } = renderAt(1440)
    const sider = inLayoutSider(container)
    expect(sider, 'the Sider is in the layout').not.toBeNull()
    expect(sider?.className).not.toContain('ant-layout-sider-collapsed')
    expect(sider?.style.width).toBe('236px')
    expect(menuButton()).toBeNull()
  })

  it('900 px: the Sider collapses to the icon rail (antd\'s collapsed Sider), no menu button', () => {
    const { container } = renderAt(900)
    const sider = inLayoutSider(container)
    expect(sider, 'the rail stays in the layout').not.toBeNull()
    expect(sider?.className).toContain('ant-layout-sider-collapsed')
    expect(sider?.style.width).toBe('80px')
    expect(menuButton()).toBeNull()
  })

  it('390 px: no Sider in the layout, and a named menu button in the header that is collapsed', () => {
    const { container } = renderAt(390)
    expect(inLayoutSider(container), 'the page gets the whole width').toBeNull()
    const button = menuButton()
    expect(button, 'the header carries the menu button').not.toBeNull()
    expect(container.querySelector('header')?.contains(button)).toBe(true)
    expect(button?.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog', { name: 'Navigation' }), 'the drawer starts closed').toBeNull()
  })

  it('390 px: the button opens the nav in a Drawer; Escape closes it and focus returns to the button', async () => {
    renderAt(390)
    const button = menuButton()!
    act(() => { button.focus() })
    fireEvent.click(button)

    const drawer = await screen.findByRole('dialog', { name: 'Navigation' })
    expect(drawer.querySelector('a[href="/compositions"]'), 'the drawer holds the sider\'s nav').not.toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(drawer, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull())
    expect(button.getAttribute('aria-expanded')).toBe('false')
    await waitFor(() => expect(document.activeElement, 'focus goes back to the menu button').toBe(button))
  })

  it('390 px: a tap on the mask outside the drawer closes it', async () => {
    renderAt(390)
    fireEvent.click(menuButton()!)
    await screen.findByRole('dialog', { name: 'Navigation' })
    fireEvent.click(document.querySelector('.ant-drawer-mask')!)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull())
  })

  it('390 px: picking a page (a navigation) closes the drawer', async () => {
    const { rerenderWith } = renderAt(390)
    fireEvent.click(menuButton()!)
    await screen.findByRole('dialog', { name: 'Navigation' })
    rerenderWith(shellSlots('/compositions'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull())
  })

  it('390 px: the nav stays mounted while the drawer is closed — it is the app\'s route source', () => {
    renderAt(390)
    // Hidden (not in the accessibility tree), but in the document, so the Menu's route
    // registration has run before anyone opens the drawer.
    expect(screen.queryByRole('link', { name: 'Compositions' })).toBeNull()
    expect(document.querySelector('a[href="/compositions"]')).not.toBeNull()
  })
})

describe('R1 — the CR still overrides the default', () => {
  it('a CR breakpoint of `md` keeps the full Sider at 900 px', () => {
    const { container } = renderAt(900, widgetData({ breakpoint: 'md', width: 236 }))
    expect(inLayoutSider(container)?.className).not.toContain('ant-layout-sider-collapsed')
  })

  it('a CR collapsedWidth sizes the rail', () => {
    const { container } = renderAt(900, widgetData({ collapsedWidth: 64, width: 236 }))
    expect(inLayoutSider(container)?.style.width).toBe('64px')
  })

  it('a Layout with no header keeps the rail on a phone: there is nowhere to put the menu button', () => {
    const { container } = renderAt(390, widgetData(), { ...shellSlots(), header: undefined })
    expect(inLayoutSider(container)?.className).toContain('ant-layout-sider-collapsed')
    expect(menuButton()).toBeNull()
  })
})
