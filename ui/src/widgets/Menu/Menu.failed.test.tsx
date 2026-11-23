// @vitest-environment jsdom
/**
 * frontend#533, as drawn: an entry snowplow could not check stays in the sidebar with a mark, says why
 * on hover and focus (and in its row's text, for a screen reader), and when nothing was checked one
 * notice speaks for all of them, with Try again only where a retry can change the answer.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Layout } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ParentRefetchContext } from '../../context/ParentRefetchContext'

vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: '/compositions' }),
  useNavigate: () => vi.fn(),
}))
vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({ config: { params: { FRONTEND_NAMESPACE: 'krateo-system' } } }),
}))
vi.mock('../../context/RoutesContext', () => ({
  createRoute: (route: unknown) => route,
  useRoutesContext: () => ({ menuRoutes: [], registerRoutes: vi.fn(), updateMenuRoutes: vi.fn() }),
}))

const { Menu } = await import('./Menu')

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

afterEach(cleanup)

const items = [
  { icon: 'cubes', label: 'Compositions', order: 10, path: '/compositions', resourceRefId: 'c' },
  { icon: 'store', label: 'Marketplace', order: 20, path: '/marketplace', resourceRefId: 'm' },
  { icon: 'bell', label: 'Incidents', order: 30, path: '/incidents', resourceRefId: 'i' },
]
const NO_ANSWER = { code: 503, message: 'The type flexes (widgets.templates.krateo.io/v1beta1) could not be looked up: discovery answered 503.' }
const NOT_INSTALLED = { code: 424, message: 'The type flexes (widgets.templates.krateo.io/v1beta1) is not installed on this cluster.' }
const REFUSED = { code: 403, message: 'refused' }
const allowed = { allowed: true, id: 'c', path: '/call?name=c', payload: {}, verb: 'GET' as const }

const renderNav = (failedRefs: Record<string, object>, { collapsed = false, refetch, refs = [allowed] }: { collapsed?: boolean; refetch?: () => void; refs?: typeof allowed[] } = {}) => render(
  <ParentRefetchContext.Provider value={refetch ?? null}>
    <Layout.Sider collapsed={collapsed}>
      <Menu failedRefs={failedRefs} resourcesRefs={{ items: refs }} uid='nav' widgetData={{ allowedResources: ['flexes'], items, mode: 'inline' }} />
    </Layout.Sider>
  </ParentRefetchContext.Provider>,
)
const row = (label: string) => screen.getAllByRole('menuitem').find((element) => element.textContent?.startsWith(label))!

describe('an entry snowplow could not check', () => {
  it('stays, marked by what can be done about it, and its row says why', () => {
    renderNav({ i: NOT_INSTALLED, m: NO_ANSWER })
    expect(screen.getAllByRole('menuitem').map((element) => element.querySelector('[data-nav-failure]')?.getAttribute('data-nav-failure'))).toEqual([undefined, 'unchecked', 'broken'])
    expect(row('Marketplace').textContent).toContain(NO_ANSWER.message)
    expect(screen.queryByTestId('nav-unchecked')).toBeNull()
  })

  it('explains itself beside the row on focus, and stops on blur', () => {
    renderNav({ m: NO_ANSWER })
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => { row('Marketplace').focus() })
    expect(within(screen.getByRole('tooltip')).getByText(/discovery answered 503/)).toBeTruthy()
    expect(row('Marketplace').querySelector('.ant-tooltip-open')).not.toBeNull()
    act(() => { row('Marketplace').blur() })
    // antd marks an OPEN tooltip's trigger: the label inside the row.
    expect(row('Marketplace').querySelector('.ant-tooltip-open')).toBeNull()
  })

  it('explains itself beside the row on hover', () => {
    renderNav({ m: NO_ANSWER })
    fireEvent.mouseEnter(row('Marketplace'))
    expect(within(screen.getByRole('tooltip')).getByText(/discovery answered 503/)).toBeTruthy()
  })
})

describe('nothing in the sidebar could be checked', () => {
  it('lists every entry unmarked, with one notice whose Try again re-reads the menu', () => {
    const refetch = vi.fn()
    renderNav({ c: NO_ANSWER, i: NOT_INSTALLED, m: NO_ANSWER }, { refetch, refs: [] })
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    expect(document.querySelector('[data-nav-failure]')).toBeNull()
    expect(screen.getByTestId('nav-unchecked').textContent).toContain('Some may be refused.')
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('offers no Try again when no retry can change the answer', () => {
    renderNav({ c: REFUSED, i: NOT_INSTALLED, m: NOT_INSTALLED }, { refetch: vi.fn(), refs: [] })
    expect(screen.getByTestId('nav-unchecked')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull()
  })

  it('offers Try again when snowplow returned no refs at all', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderNav({}, { refetch: vi.fn(), refs: [] })
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy()
  })
})

it('every entry answered: no mark and no notice', () => {
  renderNav({}, { refs: ['c', 'm', 'i'].map((id) => ({ ...allowed, id })) })
  expect(document.querySelector('[data-nav-failure]')).toBeNull()
  expect(screen.queryByTestId('nav-unchecked')).toBeNull()
})

it('in the collapsed icon rail the row opens antd\'s tooltip alone, not a second one', () => {
  renderNav({ m: NO_ANSWER }, { collapsed: true })
  act(() => { row('Marketplace').focus() })
  expect(screen.getAllByRole('tooltip')).toHaveLength(1)
})
