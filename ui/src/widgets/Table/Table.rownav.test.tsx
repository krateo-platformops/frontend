// @vitest-environment jsdom
/**
 * UX #21: rowNavigateTo per-row navigation.
 * A whole-placeholder template (`{route}`) uses the row's cell VERBATIM — the server
 * precomputed a complete per-row path (composition rows -> /compositions/.., others ->
 * /resources/..), so its slashes must NOT be percent-encoded. A multi-segment template
 * (`/x/{a}`) keeps encoding each interpolated value.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type * as ReactRouter from 'react-router'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Table from './Table'

const navigateSpy = vi.fn()
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => navigateSpy,
}))
vi.mock('../../components/FiltesProvider/FiltersProvider', () => ({
  useFilter: () => ({ getFilteredData: (data: unknown) => data }),
}))
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

// `as const` on each `kind` and `type`: the values are valid members of the column-kind union, but an
// un-annotated helper widens them to `string`, which then does not assign. This is what the
// removed `as never` was hiding — the DATA was always right, the inference was not.
const row = (route: string) => [
  {
    kind: 'jsonSchemaType' as const,
    stringValue: 'payments-api',
    type: 'string' as const,
    valueKey: 'name',
  },
  {
    kind: 'jsonSchemaType' as const,
    stringValue: route,
    type: 'string' as const,
    valueKey: 'route',
  },
]

function renderTable(rowNavigateTo: string, routeValue: string) {
  return render(
    <MemoryRouter>
      <Table
        resourcesRefs={{ items: [] }}
        uid='t'
        widgetData={{
          allowedResources: [],
          columns: [{ title: 'Name', valueKey: 'name' }],
          dataSource: [row(routeValue)],
          rowNavigateTo,
        }}
      />
    </MemoryRouter>,
  )
}

describe('Table rowNavigateTo per-row route (UX #21)', () => {
  afterEach(() => {
    cleanup()
    navigateSpy.mockReset()
  })

  it('uses a whole-placeholder cell VERBATIM (no slash encoding)', () => {
    renderTable('{route}', '/compositions/krateo-system/payments-api')
    fireEvent.click(screen.getByText('payments-api'))
    expect(navigateSpy).toHaveBeenCalledWith('/compositions/krateo-system/payments-api')
  })

  it('routes a non-composition row to its precomputed /resources path verbatim', () => {
    renderTable('{route}', '/resources/cluster/rbac.authorization.k8s.io/v1/clusterroles/x')
    fireEvent.click(screen.getByText('payments-api'))
    expect(navigateSpy).toHaveBeenCalledWith('/resources/cluster/rbac.authorization.k8s.io/v1/clusterroles/x')
  })

  it('an empty route cell leaves the row inert (no navigation)', () => {
    renderTable('{route}', '')
    fireEvent.click(screen.getByText('payments-api'))
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})
