// @vitest-environment jsdom
/**
 * A chip whose data element carries `removable: true` is an APPLIED FILTER in a page's filter bar:
 * one chip per active value, and activating it opens the page without that value (its navigateTo,
 * computed server-side from the same extras the page was resolved from).
 *
 * It must say so. A chip reading "Kind: Alert" announced as "Kind: Alert" tells a screen-reader user
 * what is applied, not that pressing it takes it away. So it carries a trailing remove mark and the
 * accessible name "Remove filter: Kind: Alert". ListView.variantsUnchanged pins that a chip which
 * does not set `removable` renders as before.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from 'antd'
import type * as ReactRouter from 'react-router'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

const navigate = vi.fn()
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => navigate,
}))
vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(), isActionLoading: false }),
}))

import { ListView } from './ListView'

const activeFilters = [
  { href: '/reviews?repo=org/x', label: 'Kind: Alert', removable: true },
  { href: '/reviews?kind=Alert', label: 'Repo: org/x', removable: true },
  { href: '/reviews', label: 'Clear all' },
]

const renderChips = () => render(
  <MemoryRouter>
    <App>
      <ListView itemTemplate={{ navigateTo: '{href}', primaryText: '{label}', rowVariant: 'chip' }} items={activeFilters} rowKey='filters' />
    </App>
  </MemoryRouter>,
)

describe('Listy chip `removable`', () => {
  afterEach(() => {
    cleanup()
    navigate.mockReset()
  })

  it('is named for what it does: "Remove filter: <label>"', () => {
    renderChips()
    expect(screen.getByRole('button', { name: 'Remove filter: Kind: Alert' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove filter: Repo: org/x' })).toBeTruthy()
  })

  it('carries a trailing remove mark after its label', () => {
    renderChips()
    const chip = screen.getByRole('button', { name: 'Remove filter: Kind: Alert' })
    const icon = chip.querySelector('.anticon-close')
    expect(icon).not.toBeNull()
    expect(chip.textContent).toBe('Kind: Alert')
    // after the label: antd iconPlacement 'end' (antd 6 keeps the icon first in the DOM and draws
    // it last through this class's row-reverse)
    expect(chip.classList.contains('ant-btn-icon-end')).toBe(true)
  })

  it('activating it opens the page without that value, from the keyboard too', async () => {
    renderChips()
    const chip = screen.getByRole('button', { name: 'Remove filter: Kind: Alert' })
    chip.focus()
    await userEvent.keyboard('{Enter}')
    expect(navigate).toHaveBeenCalledWith('/reviews?repo=org/x')
  })

  it('a chip without it stays a plain chip named by its label', () => {
    renderChips()
    const clear = screen.getByRole('button', { name: 'Clear all' })
    expect(clear.querySelector('.anticon-close')).toBeNull()
  })
})
