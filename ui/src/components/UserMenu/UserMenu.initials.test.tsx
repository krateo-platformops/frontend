// @vitest-environment jsdom
/**
 * The account menu's initials, for a user without a photo: the header trigger and the avatar in
 * the open menu. Both wrapped the initials in a Typography.Text, which painted them `colorText` on
 * the avatar's fill: 2.97:1 in light and 2.99:1 in dark. Without the wrapper the initials take the
 * avatar's own ink: white on #6A6480 in light (5.60:1), the dark ink on #8C86A0 in dark (5.47:1),
 * both pinned in tokens.contrast.test.ts.
 *
 * The ink is read from the element that holds the initials text, so a wrapper that paints its own
 * colour is caught whatever its name.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConfigProvider, theme } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { paintedFill, paintedInk, toHex } from '../../test/paintedColour'
import { colorDark, darkTheme, lightTheme } from '../../theme/tokens'

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
// antd's Popover measures its popup; jsdom has no ResizeObserver.
vi.stubGlobal('ResizeObserver', class { disconnect = vi.fn(); observe = vi.fn(); unobserve = vi.fn() })

vi.mock('../../context/ConfigContext', () => ({ useConfigContext: () => ({ refetch: vi.fn() }) }))
vi.mock('../../context/ThemeModeContext', () => ({ useThemeMode: () => ({ mode: 'light', setMode: vi.fn(), toggle: vi.fn() }) }))
vi.mock('../Notifications/NotificationsContext', () => ({ useNotifications: () => ({ notifications: [], setOpen: vi.fn() }) }))

import UserMenu from './UserMenu'

const renderMenu = (mode: 'dark' | 'light') => render(
  <MemoryRouter>
    <ConfigProvider theme={mode === 'dark' ? darkTheme : lightTheme}>
      <UserMenu />
    </ConfigProvider>
  </MemoryRouter>,
)

/** The innermost element whose own text is the initials, and the avatar it sits in. */
const initialsIn = (scope: Element) => {
  const holder = [...scope.querySelectorAll<HTMLElement>('.ant-avatar *')].find((element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent === 'AL'))
  const disc = holder?.closest<HTMLElement>('.ant-avatar')
  if (!holder || !disc) { throw new Error('no avatar initials rendered') }
  return { disc, holder }
}

const cases = [
  { ink: toHex(colorDark.panelbg), mode: 'dark', theme: darkTheme },
  { ink: '#ffffff', mode: 'light', theme: lightTheme },
] as const

describe('UserMenu — the initials take the avatar ink, with no Typography override', () => {
  beforeEach(() => { localStorage.setItem('K_user', JSON.stringify({ user: { displayName: 'Ada Lovelace', username: 'ada' } })) })
  afterEach(() => {
    cleanup()
    localStorage.removeItem('K_user')
  })

  it('a user whose avatarURL is empty gets the initials, not an empty image, in the header and the menu', async () => {
    localStorage.setItem('K_user', JSON.stringify({ user: { avatarURL: '', displayName: 'Ada Lovelace', username: 'ada' } }))
    renderMenu('dark')
    const trigger = screen.getByRole('button', { name: 'Account menu' })
    expect(trigger.querySelector('img')).toBeNull()
    expect(initialsIn(trigger).disc.textContent).toBe('AL')
    fireEvent.click(trigger)
    await screen.findByRole('menuitem', { name: 'Profile' })
    const panel = document.querySelector('.ant-popover')
    if (!panel) { throw new Error('the account menu did not open') }
    expect(panel.querySelector('.ant-avatar img')).toBeNull()
    expect(initialsIn(panel).disc.textContent).toBe('AL')
  })

  cases.forEach(({ ink, mode, theme: modeTheme }) => {
    const fill = toHex(theme.getDesignToken(modeTheme).colorTextPlaceholder)

    it(`${mode}: the header trigger's initials`, () => {
      renderMenu(mode)
      const { disc, holder } = initialsIn(screen.getByRole('button', { name: 'Account menu' }))
      expect(paintedInk(holder)).toBe(ink)
      expect(paintedFill(disc)).toBe(fill)
      expect(disc.querySelector('.ant-typography')).toBeNull()
    })

    it(`${mode}: the open menu's avatar initials`, async () => {
      renderMenu(mode)
      fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
      await screen.findByRole('menuitem', { name: 'Profile' })
      const panel = document.querySelector('.ant-popover')
      if (!panel) { throw new Error('the account menu did not open') }
      const { disc, holder } = initialsIn(panel)
      expect(paintedInk(holder)).toBe(ink)
      expect(paintedFill(disc)).toBe(fill)
      expect(disc.querySelector('.ant-typography')).toBeNull()
    })
  })
})
