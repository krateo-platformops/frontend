// @vitest-environment jsdom
/**
 * Every existing ListView row variant, pinned. RECORDED ON `main` before `rowVariant: statistic`
 * and the chip's per-item `removable` existed, so adding them is proven to change nothing a list
 * that uses neither renders: the default row, the tree row, the card tile, the chip (plain, active,
 * with a count) and the linked footer.
 */
import { cleanup, render } from '@testing-library/react'
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

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => vi.fn(),
}))
vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(), isActionLoading: false }),
}))

import type { ItemTemplate } from './itemTemplate'
import { ListView } from './ListView'

const items = [
  { active: true, count: 4, desc: 'First', name: 'alpha', state: 'Ready', to: '/a' },
  { count: 0, desc: 'Second', name: 'beta', state: 'Failed', to: '/b' },
  { name: 'gamma', state: 'Unknown' },
]

const renderList = (itemTemplate: ItemTemplate, extra: { footer?: string; footerNavigateTo?: string } = {}) => render(
  <MemoryRouter>
    <App>
      <ListView itemTemplate={itemTemplate} items={items} rowKey='pin' {...extra} />
    </App>
  </MemoryRouter>,
)

const color = { map: { Failed: 'red', Ready: 'green' }, value: '{state}' }

describe('ListView variants render as they did before statistic / removable', () => {
  afterEach(() => { cleanup() })

  it('default row', () => {
    const { container } = renderList({ color, icon: 'fa-circle', navigateTo: '{to}', primaryText: '{name}', secondaryText: '{state}', subPrimaryText: '{desc}' })
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('tree row', () => {
    const { container } = renderList({ color, primaryText: '{name}', rowVariant: 'tree', secondaryText: '{state}', subPrimaryText: '{desc}' })
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('card tile', () => {
    const { container } = renderList({ cardCta: 'Open', color, description: '{desc}', navigateTo: '{to}', primaryText: '{name}', rowVariant: 'card', secondaryText: '{state}' })
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('chip row', () => {
    const { container } = renderList({ navigateTo: '{to}', primaryText: '{name}', rowVariant: 'chip' })
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('linked footer', () => {
    const { container } = renderList({ primaryText: '{name}' }, { footer: 'See all 3 →', footerNavigateTo: '/all' })
    expect(container.innerHTML).toMatchSnapshot()
  })
})
