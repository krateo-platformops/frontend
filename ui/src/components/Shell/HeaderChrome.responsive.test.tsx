// @vitest-environment jsdom
/**
 * R1 (WCAG 1.4.10, design/audits/x4-remediation-backlog-2026-11.md item 1): at phone widths the
 * header keeps search, Agentiko and the account menu; below antd's `sm` (576 px) the theme toggle
 * and the notifications bell move INTO the account menu instead of being clipped off the edge (the
 * audit found them at 0 % visible at 390 px).
 *
 * The header's server-driven and agent-driven pieces are stubbed: this is about where HeaderChrome
 * puts the controls, with the real UserMenu, NotificationsBell and ThemeToggle.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setViewportWidth } from '../../test/viewportWidth'

const toggleTheme = vi.fn()
const openNotifications = vi.fn()

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({ config: { api: { INIT: '/call?resource=layouts&name=app-shell&namespace=krateo-system' } }, refetch: vi.fn() }),
}))
vi.mock('../../context/ThemeModeContext', () => ({ useThemeMode: () => ({ mode: 'light', setMode: vi.fn(), toggle: toggleTheme }) }))
vi.mock('../Notifications/NotificationsContext', () => ({
  NotificationsProvider: ({ children }: { children: unknown }) => children,
  useNotifications: () => ({ isLoading: false, notifications: [], open: false, scope: undefined, setOpen: openNotifications }),
}))
// The header-context (tenant tag + project picker) is a server-driven widget; its stand-in names it.
vi.mock('../WidgetRenderer', () => ({ default: ({ widgetEndpoint }: { widgetEndpoint: string }) => <span data-testid='widget'>{widgetEndpoint}</span> }))
vi.mock('../CommandPalette', () => ({ default: () => <button type='button'>Search</button> }))
vi.mock('../Agentiko', () => ({
  AgentikoProvider: ({ children }: { children: unknown }) => children,
  AgentikoShell: ({ children }: { children: unknown }) => children,
  AgentikoToggle: () => <button type='button'>Agentiko</button>,
}))

const { HeaderChrome } = await import('./Shell')

vi.stubGlobal('ResizeObserver', class {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const renderAt = (width: number) => {
  setViewportWidth(width)
  return render(<MemoryRouter><header><HeaderChrome /></header></MemoryRouter>)
}

const header = () => within(screen.getByRole('banner'))

describe('R1 — the header at phone widths', () => {
  for (const width of [1440, 768, 576]) {
    it(`${width} px: all five controls sit in the header`, () => {
      renderAt(width)
      for (const name of ['Search', 'Notifications', 'Toggle color theme', 'Agentiko', 'Account menu']) {
        expect(header().queryByRole('button', { name }), name).not.toBeNull()
      }
    })
  }

  for (const width of [575, 390, 320]) {
    it(`${width} px: search, Agentiko and the account menu stay; the theme toggle and the bell leave the header`, () => {
      renderAt(width)
      for (const name of ['Search', 'Agentiko', 'Account menu']) {
        expect(header().queryByRole('button', { name }), name).not.toBeNull()
      }
      expect(header().queryByRole('button', { name: 'Notifications' })).toBeNull()
      expect(header().queryByRole('button', { name: 'Toggle color theme' })).toBeNull()
    })
  }

  const headerContext = () => header().queryByText(/name=header-context/)

  it('768 px: the tenant tag and project picker sit in the header', () => {
    renderAt(768)
    expect(headerContext()).not.toBeNull()
  })

  it('767 px: they leave the header (they open at the top of the navigation drawer instead)', () => {
    renderAt(767)
    expect(headerContext()).toBeNull()
  })

  it('390 px: the account menu carries them, and they do what the header buttons do', async () => {
    renderAt(390)
    fireEvent.click(header().getByRole('button', { name: 'Account menu' }))

    const notifications = await screen.findByRole('menuitem', { name: /Notifications/ })
    const theme = screen.getByRole('menuitem', { name: 'Switch to dark mode' })

    fireEvent.click(theme)
    expect(toggleTheme).toHaveBeenCalledTimes(1)
    fireEvent.click(notifications)
    expect(openNotifications).toHaveBeenCalledWith(true)
  })

  it('1440 px: the account menu does not repeat them', async () => {
    renderAt(1440)
    fireEvent.click(header().getByRole('button', { name: 'Account menu' }))
    await screen.findByRole('menuitem', { name: 'Profile' })
    expect(screen.queryByRole('menuitem', { name: /Notifications/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Switch to dark mode' })).toBeNull()
  })
})
