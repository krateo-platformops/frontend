// @vitest-environment jsdom
/**
 * A Table that declares no `rowActions` renders exactly the DOM it rendered before `rowActions`
 * existed (#700). The snapshot was RECORDED ON `main` before any Table code changed, so a later
 * change that adds a column, a wrapper, an attribute or a handler to an existing Table fails here.
 *
 * Two fixtures cover the two row contracts an existing CR can have: a navigable row
 * (`rowNavigateTo`: role=button, tabIndex, pointer cursor) over string, number and tag cells, and a
 * plain table with no row interaction at all.
 */
import { cleanup, render } from '@testing-library/react'
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

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => vi.fn(),
}))
vi.mock('../../components/FiltesProvider/FiltersProvider', () => ({
  useFilter: () => ({ getFilteredData: (data: unknown) => data }),
}))

import Table from './Table'
import type { TableWidgetData } from './Table'

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

const columns = [
  { title: 'Name', valueKey: 'name' },
  { title: 'Namespace', valueKey: 'ns' },
  { title: 'Replicas', valueKey: 'replicas' },
  { title: 'Status', valueKey: 'status' },
]

const renderTable = (widgetData: Partial<TableWidgetData>) => render(
  <MemoryRouter>
    <App>
      <Table
        resourcesRefs={{ items: [] }}
        uid='unchanged'
        widgetData={{ allowedResources: [], columns, dataSource, ...widgetData } as unknown as TableWidgetData}
      />
    </App>
  </MemoryRouter>,
)

describe('Table without rowActions renders as it did before #700', () => {
  afterEach(() => { cleanup() })

  it('a navigable table (rowNavigateTo)', () => {
    const { container } = renderTable({ rowNavigateTo: '/compositions/{ns}/{name}' })
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('a plain table (no row interaction)', () => {
    const { container } = renderTable({})
    expect(container.innerHTML).toMatchSnapshot()
  })
})
