// @vitest-environment jsdom
/**
 * `itemTemplate.rowActionsDisplay` — how the default row presents its `rowActions`.
 *
 * `menu` (and absent) is the kebab every existing Listy renders; it must not move. `buttons` puts
 * the verbs on the row as antd Buttons (the drafts lists: Resume / Discard), and three things make
 * that honest rather than decorative: each button is a real, labelled <button> in declared order;
 * a click runs its action exactly once WITHOUT also firing the row's own navigation; and the same
 * holds for the keyboard — Enter on a focused button must not be swallowed by the row's onKeyDown,
 * which would navigate and preventDefault the button's activation away.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
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

const navigateSpy = vi.fn()
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => navigateSpy,
}))

const handleActionSpy = vi.fn()
vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: handleActionSpy, isActionLoading: false }),
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

const renderList = (rowActionsDisplay?: 'menu' | 'buttons') => render(
  <MemoryRouter>
    <App>
      <ListView
        actions={actions}
        itemTemplate={{
          navigateTo: '/row/{name}',
          primaryText: '{name}',
          rowActions,
          ...(rowActionsDisplay ? { rowActionsDisplay } : {}),
        }}
        items={[{ name: 'draft-a' }]}
        rowKey='row-actions-test'
      />
    </App>
  </MemoryRouter>,
)

const rowOf = (container: HTMLElement) => container.querySelector('.ant-list-item') as HTMLElement
const actionButtons = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLButtonElement>('.ant-list-item-action button')]

describe('ListView — rowActionsDisplay', () => {
  afterEach(() => {
    cleanup()
    navigateSpy.mockClear()
    handleActionSpy.mockClear()
  })

  it.each([undefined, 'menu' as const])('%s renders the kebab exactly as before, and no visible verbs', (display) => {
    const { container, queryByRole } = renderList(display)
    const row = rowOf(container)

    const buttons = actionButtons(container)
    expect(buttons).toHaveLength(1)
    expect(buttons[0].getAttribute('aria-label')).toBe('Row actions')
    expect(buttons[0].className).toContain('ant-btn-text')
    expect(queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(row.className).not.toContain('actionsLast')
  })

  it('buttons renders one real <button> per action, in order, with the right types', () => {
    const { container } = renderList('buttons')
    const buttons = actionButtons(container)

    expect(buttons.map((button) => button.textContent)).toEqual(['Resume', 'Discard'])
    expect(buttons.every((button) => button.tagName === 'BUTTON')).toBe(true)
    expect(buttons[0].className).toContain('ant-btn-primary')
    expect(buttons[0].className).not.toContain('ant-btn-dangerous')
    expect(buttons[1].className).not.toContain('ant-btn-primary')
    expect(buttons[1].className).toContain('ant-btn-dangerous')
    expect(container.querySelector('[aria-label="Row actions"]')).toBeNull()
    // The verbs close the row (after its time/state), not sit between the name and them.
    expect(rowOf(container).className).toContain('actionsLast')
  })

  it('a button click runs its action once and does not fire the row click', () => {
    const { container } = renderList('buttons')
    fireEvent.click(actionButtons(container)[1])

    expect(handleActionSpy).toHaveBeenCalledTimes(1)
    expect(handleActionSpy.mock.calls[0][0]).toMatchObject({ id: 'discard' })
    expect(handleActionSpy.mock.calls[0][2]).toEqual({ name: 'draft-a' })
    expect(navigateSpy).not.toHaveBeenCalled()
  })

  it('the row click is unchanged: it still navigates and runs no action', () => {
    const { container } = renderList('buttons')
    fireEvent.click(rowOf(container))

    expect(navigateSpy).toHaveBeenCalledWith('/row/draft-a')
    expect(handleActionSpy).not.toHaveBeenCalled()
  })

  it('Enter on a focused button is not taken by the row', () => {
    const { container } = renderList('buttons')
    const [resume] = actionButtons(container)
    resume.focus()
    const event = fireEvent.keyDown(resume, { key: 'Enter' })

    expect(navigateSpy).not.toHaveBeenCalled()
    // Not default-prevented, so the browser still turns the Enter into the button's click.
    expect(event).toBe(true)
  })

  it('focus order: the row, then each button in declared order', () => {
    const { container } = renderList('buttons')
    const focusables = [...container.querySelectorAll<HTMLElement>('[tabindex="0"], button')]
      .filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0)

    expect(focusables).toEqual([rowOf(container), ...actionButtons(container)])
  })
})

/**
 * The row's own Enter/Space handler used to take a key from ANY control inside the row: it
 * navigated and preventDefault-ed the control's activation away, so Enter on the "⋮" trigger opened
 * the row instead of the menu, and Enter on a clickable card's action button navigated instead of
 * running the action. The row now handles only keys aimed at itself.
 */
describe('ListView — a key on a control inside a row belongs to the control', () => {
  afterEach(() => {
    cleanup()
    navigateSpy.mockClear()
    handleActionSpy.mockClear()
  })

  it('Enter on the row-actions kebab is not taken by the row', () => {
    const { container } = renderList('menu')
    const [kebab] = actionButtons(container)
    kebab.focus()
    const event = fireEvent.keyDown(kebab, { key: 'Enter' })

    expect(navigateSpy).not.toHaveBeenCalled()
    expect(event).toBe(true)
  })

  it.each(['Enter', ' '])('%j on the row itself still navigates', (key) => {
    const { container } = renderList('menu')
    const row = rowOf(container)
    row.focus()
    const event = fireEvent.keyDown(row, { key })

    expect(navigateSpy).toHaveBeenCalledWith('/row/draft-a')
    expect(event).toBe(false)
  })

  it('Enter on a clickable card\'s action button is not taken by the card', () => {
    const { container } = render(
      <MemoryRouter>
        <App>
          <ListView
            actions={actions}
            itemTemplate={{ navigateTo: '/row/{name}', primaryText: '{name}', rowActions, rowVariant: 'card' }}
            items={[{ name: 'draft-a' }]}
            rowKey='card-keys-test'
          />
        </App>
      </MemoryRouter>,
    )
    expect(container.querySelector('[role="button"][tabindex="0"]')).not.toBeNull()
    // The real <button>: the clickable card is role="button" too, and its name includes "Resume".
    const resume = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Resume') as HTMLButtonElement
    resume.focus()
    const event = fireEvent.keyDown(resume, { key: 'Enter' })

    expect(navigateSpy).not.toHaveBeenCalled()
    expect(event).toBe(true)
  })
})
