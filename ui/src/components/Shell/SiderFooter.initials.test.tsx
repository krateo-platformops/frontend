// @vitest-environment jsdom
/**
 * The sidebar footer's avatar, for a user without a photo: an initial on antd's default avatar
 * fill (`colorTextPlaceholder`). In dark that fill is #8C86A0, where the white initial measured
 * 3.48:1; the theme gives the Avatar the dark ink in dark (5.47:1, pinned in
 * tokens.contrast.test.ts). Light keeps antd's white on #6A6480 (5.60:1).
 *
 * The shell's server-driven and agent-driven pieces are stubbed, as in HeaderChrome's suite: only
 * the footer renders here.
 */
import { cleanup, render } from '@testing-library/react'
import { ConfigProvider, theme } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { paintedFill, paintedInk, toHex } from '../../test/paintedColour'
import { colorDark, darkTheme, lightTheme } from '../../theme/tokens'

// antd's Avatar subscribes to its responsive observer, which reads matchMedia; jsdom has none.
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
// The Avatar measures its initials to scale them into the disc; jsdom has no ResizeObserver.
vi.stubGlobal('ResizeObserver', class { disconnect = vi.fn(); observe = vi.fn(); unobserve = vi.fn() })

vi.mock('../../context/ConfigContext', () => ({ useConfigContext: () => ({ config: { api: { INIT: '' } }, refetch: vi.fn() }) }))
vi.mock('../../context/ThemeModeContext', () => ({ useThemeMode: () => ({ mode: 'light', setMode: vi.fn(), toggle: vi.fn() }) }))
vi.mock('../Notifications/NotificationsContext', () => ({
  NotificationsProvider: ({ children }: { children: unknown }) => children,
  useNotifications: () => ({ notifications: [], setOpen: vi.fn() }),
}))
vi.mock('../WidgetRenderer', () => ({ default: () => null }))
vi.mock('../CommandPalette', () => ({ default: () => null }))
vi.mock('../Agentiko', () => ({
  AgentikoProvider: ({ children }: { children: unknown }) => children,
  AgentikoShell: ({ children }: { children: unknown }) => children,
  AgentikoToggle: () => null,
}))

const { SiderFooter } = await import('./Shell')

const renderFooter = (mode: 'dark' | 'light') => render(
  <ConfigProvider theme={mode === 'dark' ? darkTheme : lightTheme}>
    <SiderFooter />
  </ConfigProvider>,
)

const avatar = (container: HTMLElement) => {
  const found = container.querySelector<HTMLElement>('.ant-avatar')
  if (!found) { throw new Error('no footer avatar rendered') }
  return found
}

describe('SiderFooter — a photo-less user\'s initial takes the dark ink in dark mode only', () => {
  beforeEach(() => { localStorage.setItem('K_user', JSON.stringify({ user: { displayName: 'Ada Lovelace', username: 'ada' } })) })
  afterEach(() => {
    cleanup()
    localStorage.removeItem('K_user')
  })

  it('dark: the initial is the dark ink on the default avatar fill', () => {
    const disc = avatar(renderFooter('dark').container)
    expect(disc.textContent).toBe('A')
    expect(paintedFill(disc)).toBe(toHex(theme.getDesignToken(darkTheme).colorTextPlaceholder))
    expect(paintedInk(disc)).toBe(toHex(colorDark.panelbg))
  })

  it('light: the initial stays white on the default avatar fill', () => {
    const disc = avatar(renderFooter('light').container)
    expect(paintedFill(disc)).toBe(toHex(theme.getDesignToken(lightTheme).colorTextPlaceholder))
    expect(paintedInk(disc)).toBe('#ffffff')
  })
})
