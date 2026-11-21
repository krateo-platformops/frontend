// @vitest-environment jsdom
/**
 * A row action's `type` (portal UX review, Blueprints grid: every card had a filled "Create", so the
 * page had no focal point; Diego: keep Create on the cards, as a secondary button).
 *
 * Unset, the first action is primary and the rest default, exactly as before, in both places row
 * actions are buttons: a List card's footer and the default row's `buttons` display (the same
 * RowActionControls Table uses). `type: default` on the first leaves no primary at all; an explicit
 * `primary` on a later one makes that one primary.
 */
import { cleanup, render } from '@testing-library/react'
import { App } from 'antd'
import type * as ReactRouter from 'react-router'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { rowActionButtonType } from '../../components/RowActions'
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
  navigate: [{ id: 'create', path: '/create', type: 'navigate' }, { id: 'docs', path: '/docs', type: 'navigate' }],
} as unknown as WidgetActions

/** Each button's label and whether antd drew it primary, in order. */
const buttons = (itemTemplate: ItemTemplate) => {
  const { container } = render(
    <MemoryRouter>
      <App>
        <ListView actions={actions} itemTemplate={itemTemplate} items={[{ name: 'aws-rds-stack' }]} rowKey='name' />
      </App>
    </MemoryRouter>,
  )
  return [...container.querySelectorAll('button')]
    .filter((button) => ['Create', 'Docs'].includes(button.textContent ?? ''))
    .map((button) => [button.textContent, button.classList.contains('ant-btn-primary')])
}

const card = (rowActions: ItemTemplate['rowActions']): ItemTemplate => ({ primaryText: '{name}', rowActions, rowVariant: 'card' })
const row = (rowActions: ItemTemplate['rowActions']): ItemTemplate => ({ primaryText: '{name}', rowActions, rowActionsDisplay: 'buttons' })

describe('a row action button takes its own type', () => {
  afterEach(() => { cleanup() })

  it.each([['card footer', card], ['buttons display', row]] as const)('%s, unset: the first is primary, as before', (_where, shape) => {
    expect(buttons(shape([{ actionId: 'create', label: 'Create' }, { actionId: 'docs', label: 'Docs' }]))).toEqual([['Create', true], ['Docs', false]])
  })

  it.each([['card footer', card], ['buttons display', row]] as const)('%s, type default on the only action: no primary (the Blueprints grid)', (_where, shape) => {
    expect(buttons(shape([{ actionId: 'create', label: 'Create', type: 'default' }]))).toEqual([['Create', false]])
  })

  it.each([['card footer', card], ['buttons display', row]] as const)('%s, an explicit primary on a later action', (_where, shape) => {
    expect(buttons(shape([{ actionId: 'create', label: 'Create', type: 'default' }, { actionId: 'docs', label: 'Docs', type: 'primary' }])))
      .toEqual([['Create', false], ['Docs', true]])
  })

  it('the rule itself', () => {
    expect([0, 1, 2].map((index) => rowActionButtonType({ actionId: 'a', label: 'A' }, index))).toEqual(['primary', 'default', 'default'])
    expect(rowActionButtonType({ actionId: 'a', label: 'A', type: 'default' }, 0)).toBe('default')
  })
})
