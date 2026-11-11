// @vitest-environment jsdom
/**
 * A list row's icon avatar: a solid disc in the row's colour under a glyph in the avatar's ink.
 * The disc follows the mode (`gray`, the default row colour, resolves to #A39DB5 in dark), and a
 * white glyph on it measured 2.61:1, under the 3:1 a meaningful icon needs. The theme gives the
 * Avatar the dark ink in dark (7.29:1, pinned in tokens.contrast.test.ts); light keeps white.
 */
import { library } from '@fortawesome/fontawesome-svg-core'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { cleanup, render } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { paintedFill, paintedInk, toHex } from '../../test/paintedColour'
import { color, colorDark, darkTheme, lightTheme } from '../../theme/tokens'

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

// The row glyph is a Font Awesome name; the app registers the set in App.tsx.
library.add(fas)

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(), isActionLoading: false }),
}))

import { ListView } from './ListView'

// The row colour is a palette NAME, resolved for the mode on <html data-theme> (getColorCode).
const renderRow = (mode: 'dark' | 'light') => {
  document.documentElement.dataset.theme = mode
  return render(
    <MemoryRouter>
      <ConfigProvider theme={mode === 'dark' ? darkTheme : lightTheme}>
        <ListView itemTemplate={{ color: { value: '{colour}' }, icon: '{icon}', primaryText: '{name}' }} items={[{ colour: 'gray', icon: 'fa-cube', name: 'Row one' }]} rowKey='dark-ink' />
      </ConfigProvider>
    </MemoryRouter>,
  )
}

const avatar = (container: HTMLElement) => {
  const found = container.querySelector<HTMLElement>('.ant-list-item .ant-avatar')
  if (!found) { throw new Error('no row avatar rendered') }
  return found
}

describe('ListView — a row icon avatar takes the dark ink in dark mode only', () => {
  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.theme
  })

  it('dark: the glyph is the dark ink on the dark `gray` disc', () => {
    const disc = avatar(renderRow('dark').container)
    expect(disc.querySelector('svg')).not.toBeNull()
    expect(paintedFill(disc)).toBe(toHex(colorDark.gray))
    expect(paintedInk(disc)).toBe(toHex(colorDark.panelbg))
  })

  it('light: the glyph stays white on the light `gray` disc', () => {
    const disc = avatar(renderRow('light').container)
    expect(paintedFill(disc)).toBe(toHex(color.gray))
    expect(paintedInk(disc)).toBe('#ffffff')
  })
})
