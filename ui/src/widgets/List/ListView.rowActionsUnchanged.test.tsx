// @vitest-environment jsdom
/**
 * The default row's `rowActions` controls — the kebab (`menu`, and absent) and the buttons
 * (`buttons`) — and the card row's buttons render exactly the DOM they rendered before Table reused
 * them (#700). The snapshot was RECORDED ON `main` before the controls moved into
 * components/RowActions, so the move is proven to change nothing a List renders.
 */
import { cleanup, render } from '@testing-library/react'
import { App } from 'antd'
import type * as ReactRouter from 'react-router'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WidgetActions } from '../../types/Widget'

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

const actions = {
  navigate: [{ id: 'resume', path: '/resume', type: 'navigate' }],
  rest: [{ id: 'discard', resourceRefId: 'ref', type: 'rest' }],
} as unknown as WidgetActions

const rowActions: ItemTemplate['rowActions'] = [
  { actionId: 'resume', icon: 'fa-rotate-left', label: 'Resume' },
  { actionId: 'discard', danger: true, icon: 'fa-trash', label: 'Discard' },
]

const renderList = (itemTemplate: ItemTemplate) => render(
  <MemoryRouter>
    <App>
      <ListView
        actions={actions}
        itemTemplate={itemTemplate}
        items={[{ name: 'draft-a', state: 'Ready' }, { name: 'draft-b', state: 'Failed' }]}
        rowKey='unchanged'
      />
    </App>
  </MemoryRouter>,
)

describe('ListView rowActions render as they did before #700', () => {
  afterEach(() => { cleanup() })

  it.each([undefined, 'menu' as const, 'buttons' as const])('default row, rowActionsDisplay %s', (rowActionsDisplay) => {
    const { container } = renderList({
      navigateTo: '/row/{name}',
      primaryText: '{name}',
      rowActions,
      secondaryText: '{state}',
      ...(rowActionsDisplay ? { rowActionsDisplay } : {}),
    })
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('card row', () => {
    const { container } = renderList({ navigateTo: '/row/{name}', primaryText: '{name}', rowActions, rowVariant: 'card' })
    expect(container.innerHTML).toMatchSnapshot()
  })
})
