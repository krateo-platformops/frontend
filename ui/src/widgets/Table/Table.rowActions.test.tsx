// @vitest-environment jsdom
/* eslint-disable no-template-curly-in-string -- a navigate action's `${valueKey}` path is the subject under test */
/**
 * `rowActions` on Table (#700) — List's `rowActions`, the same field, shape and semantics.
 *
 * Krateo 3.x Tables had a button per row. Krateo 4's only per-row interaction was `rowNavigateTo`,
 * and a Button embedded through a `widget` cell got no row data and fired the row's link as well.
 * What this pins:
 *
 * - a control fires its action with THAT row's values ({ [valueKey]: value }) as customPayload, and
 *   never the row's `rowNavigateTo` — by mouse or by keyboard;
 * - a click anywhere else on the row still navigates;
 * - the controls are real antd <button>s, reachable by Tab after the row itself;
 * - `rowActionsDisplay` reads as it does on List: `menu` (and absent) is the kebab, `buttons` the
 *   verbs on the row, the first primary and a `danger` entry as danger.
 *
 * A Table WITHOUT rowActions is pinned byte for byte by Table.unchanged.test.tsx (recorded on main).
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { App } from 'antd'
import type * as ReactRouter from 'react-router'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('ResizeObserver', class {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
})
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
vi.mock('../../components/FiltesProvider/FiltersProvider', () => ({
  useFilter: () => ({ getFilteredData: (data: unknown) => data }),
}))
const handleActionSpy = vi.fn()
vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: handleActionSpy, isActionLoading: false }),
}))

import Table from './Table'
import type { TableWidgetData } from './Table'

const actions = {
  navigate: [{ id: 'open-logs', path: '/compositions/${ns}/${name}/logs', type: 'navigate' }],
  rest: [{ id: 'restart', resourceRefId: 'restart-ref', type: 'rest' }],
}

const rowActions = [
  { actionId: 'open-logs', icon: 'fa-file-lines', label: 'Logs' },
  { actionId: 'restart', danger: true, label: 'Restart' },
]

const dataSource = [
  [
    { kind: 'jsonSchemaType', stringValue: 'alpha', type: 'string', valueKey: 'name' },
    { kind: 'jsonSchemaType', stringValue: 'team-a', type: 'string', valueKey: 'ns' },
    { kind: 'jsonSchemaType', numberValue: 3, type: 'number', valueKey: 'replicas' },
    { color: 'green', kind: 'tag', stringValue: 'Ready', valueKey: 'status' },
  ],
  [
    { kind: 'jsonSchemaType', stringValue: 'beta', type: 'string', valueKey: 'name' },
    { kind: 'jsonSchemaType', stringValue: 'team-b', type: 'string', valueKey: 'ns' },
    { kind: 'jsonSchemaType', numberValue: 1, type: 'number', valueKey: 'replicas' },
    { color: 'red', kind: 'tag', stringValue: 'Failed', valueKey: 'status' },
  ],
]

const renderTable = (extra: Partial<TableWidgetData> = {}) => render(
  <MemoryRouter>
    <App>
      <Table
        resourcesRefs={{ items: [] }}
        uid='row-actions'
        widgetData={{
          actions,
          allowedResources: [],
          columns: [{ title: 'Name', valueKey: 'name' }, { title: 'Status', valueKey: 'status' }],
          dataSource,
          rowActions,
          rowNavigateTo: '/compositions/{ns}/{name}',
          ...extra,
        } as unknown as TableWidgetData}
      />
    </App>
  </MemoryRouter>,
)

const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('tbody tr.ant-table-row')]
const buttonsIn = (row: HTMLElement) => [...row.querySelectorAll<HTMLButtonElement>('button')]
const buttonNamed = (row: HTMLElement, name: string) => buttonsIn(row).find((button) => button.textContent === name) as HTMLButtonElement

afterEach(() => {
  cleanup()
  navigateSpy.mockClear()
  handleActionSpy.mockClear()
})

describe('Table rowActions — rowActionsDisplay: buttons', () => {
  it('a button click runs its action once with THAT row\'s values, and does not navigate the row', () => {
    const { container } = renderTable({ rowActionsDisplay: 'buttons' })
    const [, second] = rows(container)
    fireEvent.click(buttonNamed(second, 'Logs'))

    expect(handleActionSpy).toHaveBeenCalledTimes(1)
    expect(handleActionSpy.mock.calls[0][0]).toMatchObject({ id: 'open-logs' })
    // The row's values, keyed by valueKey, typed as the cell declares them — not the first row's.
    expect(handleActionSpy.mock.calls[0][2]).toEqual({ name: 'beta', ns: 'team-b', replicas: 1, status: 'Failed' })
    expect(navigateSpy).not.toHaveBeenCalled()
  })

  it('each row fires with its own values', () => {
    const { container } = renderTable({ rowActionsDisplay: 'buttons' })
    fireEvent.click(buttonNamed(rows(container)[0], 'Restart'))
    fireEvent.click(buttonNamed(rows(container)[1], 'Restart'))

    const fired = (handleActionSpy.mock.calls as [{ id: string }, unknown, { name: string }][]).map(([action, , payload]) => [action.id, payload.name])
    expect(fired).toEqual([['restart', 'alpha'], ['restart', 'beta']])
    expect(navigateSpy).not.toHaveBeenCalled()
  })

  it('a click elsewhere on the row still navigates, and runs no action', () => {
    const { container, getByText } = renderTable({ rowActionsDisplay: 'buttons' })
    fireEvent.click(getByText('beta'))
    expect(navigateSpy).toHaveBeenCalledWith('/compositions/team-b/beta')

    // Every data cell is still the row, the one beside the actions included.
    navigateSpy.mockClear()
    const statusCell = rows(container)[0].children[1] as HTMLElement
    fireEvent.click(statusCell)
    expect(navigateSpy).toHaveBeenCalledWith('/compositions/team-a/alpha')
    expect(handleActionSpy).not.toHaveBeenCalled()
  })

  it.each(['Enter', ' '])('%j on a focused button is not taken by the row', (key) => {
    const { container } = renderTable({ rowActionsDisplay: 'buttons' })
    const logs = buttonNamed(rows(container)[0], 'Logs')
    logs.focus()
    const notPrevented = fireEvent.keyDown(logs, { key })

    expect(navigateSpy).not.toHaveBeenCalled()
    // Not default-prevented, so the browser still turns the key into the button's own click.
    expect(notPrevented).toBe(true)
  })

  it.each(['Enter', ' '])('%j on the row itself still navigates', (key) => {
    const { container } = renderTable({ rowActionsDisplay: 'buttons' })
    const [row] = rows(container)
    row.focus()
    fireEvent.keyDown(row, { key })

    expect(navigateSpy).toHaveBeenCalledWith('/compositions/team-a/alpha')
    expect(handleActionSpy).not.toHaveBeenCalled()
  })

  it('Tab order: each row, then its buttons in declared order', () => {
    const { container } = renderTable({ rowActionsDisplay: 'buttons' })
    const focusables = [...container.querySelectorAll<HTMLElement>('tbody [tabindex="0"], tbody button')]
      .filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0)
    const [first, second] = rows(container)

    expect(buttonsIn(first)).toHaveLength(2)
    expect(focusables).toEqual([first, ...buttonsIn(first), second, ...buttonsIn(second)])
    expect(buttonsIn(first).every((button) => button.tagName === 'BUTTON')).toBe(true)
  })

  it('renders List\'s buttons: declared order, the first primary, a danger entry as danger', () => {
    const { container } = renderTable({ rowActionsDisplay: 'buttons' })
    const buttons = buttonsIn(rows(container)[0])

    expect(buttons.map((button) => button.textContent)).toEqual(['Logs', 'Restart'])
    expect(buttons[0].className).toContain('ant-btn-primary')
    expect(buttons[1].className).not.toContain('ant-btn-primary')
    expect(buttons[1].className).toContain('ant-btn-dangerous')
    // Small in a Table, so a row of buttons is no taller than a row of text (List keeps middle).
    expect(buttons.every((button) => button.className.includes('ant-btn-sm'))).toBe(true)
  })

  it('the actions column is a trailing column, its header named for assistive tech only', () => {
    const { container } = renderTable({ rowActionsDisplay: 'buttons' })
    const headers = [...container.querySelectorAll('thead th')]

    expect(headers.map((header) => header.textContent)).toEqual(['Name', 'Status', 'Actions'])
    expect(headers[2].querySelector('span')?.className).toContain('srOnly')
    // No sorter on it: it is not data.
    expect(headers[2].className).not.toContain('ant-table-column-has-sorters')
  })

  it('a fitContent table gives the actions column a width, so its fixed layout cannot squeeze it to nothing', () => {
    const { container } = renderTable({ fitContent: true, rowActionsDisplay: 'buttons' })
    const cols = [...container.querySelectorAll<HTMLElement>('colgroup col')]
    // Logs (4 glyphs + icon) and Restart (7 glyphs) at 14px, 0.6em, with a small Button's chrome,
    // the Space gap and the cell padding — rowActionsColumnWidth over antd's default tokens.
    expect(cols.at(-1)?.style.width).toBe(`${Math.ceil(4 * 14 * 0.6) + 16 + 14 + 8 + Math.ceil(7 * 14 * 0.6) + 16 + 8 + 16}px`)
  })

  it('works on a table without rowNavigateTo: the action fires, nothing navigates', () => {
    const { container } = renderTable({ rowActionsDisplay: 'buttons', rowNavigateTo: undefined })
    fireEvent.click(buttonNamed(rows(container)[0], 'Logs'))

    expect(handleActionSpy).toHaveBeenCalledTimes(1)
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})

describe('Table rowActions — rowActionsDisplay: menu (and absent)', () => {
  it.each([undefined, 'menu' as const])('%s renders one kebab per row, and no visible verbs', (rowActionsDisplay) => {
    const { container } = renderTable(rowActionsDisplay ? { rowActionsDisplay } : {})
    for (const row of rows(container)) {
      const buttons = buttonsIn(row)
      expect(buttons).toHaveLength(1)
      expect(buttons[0].getAttribute('aria-label')).toBe('Row actions')
    }
  })

  it('opening the kebab does not navigate; a menu item fires with that row\'s values and does not navigate', async () => {
    const { container, findByText } = renderTable()
    const [kebab] = buttonsIn(rows(container)[1])
    fireEvent.click(kebab)
    expect(navigateSpy).not.toHaveBeenCalled()

    fireEvent.click(await findByText('Restart'))
    await waitFor(() => { expect(handleActionSpy).toHaveBeenCalledTimes(1) })
    expect(handleActionSpy.mock.calls[0][0]).toMatchObject({ id: 'restart' })
    expect((handleActionSpy.mock.calls[0][2] as { name: string }).name).toBe('beta')
    expect(navigateSpy).not.toHaveBeenCalled()
  })

  it('Enter on the kebab is not taken by the row', () => {
    const { container } = renderTable()
    const [kebab] = buttonsIn(rows(container)[0])
    kebab.focus()
    const notPrevented = fireEvent.keyDown(kebab, { key: 'Enter' })

    expect(navigateSpy).not.toHaveBeenCalled()
    expect(notPrevented).toBe(true)
  })
})

/**
 * The issue's first requirement: a click registers only on the control, never on the rest of the
 * row. The whole actions cell is therefore outside the row's interaction — its padding, the space
 * around and between the controls, and the kebab's dropdown, which antd renders in a portal under
 * <body> but which React still bubbles through the cell to the row.
 */
describe('Table rowActions — the actions cell is a non-navigating region', () => {
  const actionsCellOf = (row: HTMLElement) => row.lastElementChild as HTMLElement

  it.each([undefined, 'buttons' as const])('a click on the actions cell\'s padding does not navigate (%s)', (rowActionsDisplay) => {
    const { container } = renderTable(rowActionsDisplay ? { rowActionsDisplay } : {})
    fireEvent.click(actionsCellOf(rows(container)[0]))

    expect(navigateSpy).not.toHaveBeenCalled()
    expect(handleActionSpy).not.toHaveBeenCalled()
  })

  it('a click on the space between the buttons does not navigate', () => {
    const { container } = renderTable({ rowActionsDisplay: 'buttons' })
    fireEvent.click(actionsCellOf(rows(container)[0]).querySelector('.ant-space') as HTMLElement)

    expect(navigateSpy).not.toHaveBeenCalled()
    expect(handleActionSpy).not.toHaveBeenCalled()
  })

  it('a click on the kebab\'s own padding and on its icon does not navigate', () => {
    const { container } = renderTable()
    const [kebab] = buttonsIn(rows(container)[0])
    fireEvent.click(kebab)
    fireEvent.click(kebab.querySelector('.ant-btn-icon') as HTMLElement)

    expect(navigateSpy).not.toHaveBeenCalled()
  })

  it('a click inside the open dropdown — its padding, its menu — does not navigate', async () => {
    const { container, findByText } = renderTable()
    fireEvent.click(buttonsIn(rows(container)[1])[0])
    const item = await findByText('Restart')
    const dropdown = item.closest('.ant-dropdown') as HTMLElement
    const menu = item.closest('.ant-dropdown-menu') as HTMLElement
    expect(dropdown).toBeTruthy()
    // Portalled out of the table: a DOM containment check alone could not catch it.
    expect(container.contains(dropdown)).toBe(false)

    fireEvent.click(dropdown)
    fireEvent.click(menu)
    expect(navigateSpy).not.toHaveBeenCalled()
    expect(handleActionSpy).not.toHaveBeenCalled()
  })

  it.each(['Enter', ' '])('%j on a focused action — a button, the kebab, a menu item — does not navigate', async (key) => {
    const buttons = renderTable({ rowActionsDisplay: 'buttons' })
    const logs = buttonNamed(rows(buttons.container)[0], 'Logs')
    logs.focus()
    expect(fireEvent.keyDown(logs, { key })).toBe(true)
    cleanup()

    const { container, findByText } = renderTable()
    const [kebab] = buttonsIn(rows(container)[0])
    kebab.focus()
    expect(fireEvent.keyDown(kebab, { key })).toBe(true)
    fireEvent.click(kebab)
    const item = (await findByText('Logs')).closest('li') as HTMLElement
    fireEvent.keyDown(item, { key })

    expect(navigateSpy).not.toHaveBeenCalled()
  })

  it('the cell does not look clickable: it drops the row\'s pointer cursor', () => {
    const { container } = renderTable()
    expect(actionsCellOf(rows(container)[0]).className).toContain('actionsCell')
  })
})

describe('Table rowActions — an id the action map does not define', () => {
  it('is reported, not dispatched', async () => {
    const { container, findByText } = renderTable({ rowActions: [{ actionId: 'nope', label: 'Nope' }], rowActionsDisplay: 'buttons' })
    fireEvent.click(buttonNamed(rows(container)[0], 'Nope'))

    expect(await findByText('The table does not define an action (ID: nope)')).toBeTruthy()
    expect(handleActionSpy).not.toHaveBeenCalled()
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})

describe('Table — rowActions in a table whose columns were resized (#556)', () => {
  it('the actions column carries no resize handle, keeps its width and counts in the table width', () => {
    window.localStorage.clear()
    const { container } = renderTable({ rowActionsDisplay: 'buttons' })
    const handles = () => [...container.querySelectorAll<HTMLElement>('.ant-table-thead [role="separator"]')]
    expect(handles()).toHaveLength(2)

    fireEvent.keyDown(handles()[0], { key: 'ArrowRight' })

    const cols = [...(container.querySelector('colgroup')?.querySelectorAll('col') ?? [])].map((col) => parseFloat(col.style.width))
    expect(cols).toHaveLength(3)
    expect(cols.every((width) => width > 0)).toBe(true)
    const table = container.querySelector<HTMLElement>('.ant-table-content table')
    expect(table?.style.tableLayout).toBe('fixed')
    expect(parseFloat(table?.style.width ?? '')).toBe(cols.reduce((sum, width) => sum + width, 0))
    expect(buttonNamed(rows(container)[0], 'Restart')).toBeTruthy()
  })
})
