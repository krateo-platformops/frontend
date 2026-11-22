// @vitest-environment jsdom
/**
 * renderedChildRefIds must name exactly what each container MOUNTS on first render: no more (a read
 * nobody needed), no less (a child left to fetch on mount, the wait the prefetch removes). Each case
 * mounts the real widget with children it draws and children it does not (closed panels, inactive
 * tabs, the second page of a table), records every child it mounts through RefChild or
 * WidgetRenderer, and compares that with the declaration.
 */
import { cleanup, render } from '@testing-library/react'
import { App } from 'antd'
import type { ComponentType } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setViewportWidth } from '../../test/viewportWidth'
import type { ResourcesRefs } from '../../types/Widget'
import Card from '../../widgets/Card/Card'
import Col from '../../widgets/Col/Col'
import Collapse from '../../widgets/Collapse/Collapse'
import Flex from '../../widgets/Flex/Flex'
import Layout from '../../widgets/Layout/Layout'
import Row from '../../widgets/Row/Row'
import Table from '../../widgets/Table/Table'
import Tabs from '../../widgets/Tabs/Tabs'
import { ShellSlotsProvider } from '../Shell/ShellSlots'

import { renderedChildRefIds } from './renderedChildren'

const mounted: string[] = []
const idOf = (endpoint: string) => new URL(endpoint, 'http://x').searchParams.get('name') ?? endpoint

vi.mock('../WidgetRenderer', () => ({
  default: ({ widgetEndpoint }: { widgetEndpoint: string }) => { mounted.push(idOf(widgetEndpoint)); return null },
}))
vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: () => Promise.resolve(), isActionLoading: false }),
}))
// Table reads its rows through the filters context; unfiltered here, as in Table's own tests.
vi.mock('../FiltesProvider/FiltersProvider', () => ({
  useFilter: () => ({ getFilteredData: (data: unknown) => data }),
}))
vi.stubGlobal('ResizeObserver', class {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
})

afterEach(() => {
  cleanup()
  mounted.length = 0
  window.history.replaceState(null, '', '/')
})

const refsFor = (ids: string[]): ResourcesRefs => ({
  items: ids.map((id) => ({ allowed: true, id, path: `/call?resource=x&name=${id}`, payload: {}, verb: 'GET' as const })),
})

const mount = (Widget: ComponentType<never>, widgetData: Record<string, unknown>, ids: string[]) => {
  render(
    <MemoryRouter>
      <App>
        <ShellSlotsProvider value={{ content: null, header: null }}>
          <Widget {...({ resourcesRefs: refsFor(ids), uid: 'w1', widget: {}, widgetData } as never)} />
        </ShellSlotsProvider>
      </App>
    </MemoryRouter>,
  )
  return [...new Set(mounted)].sort()
}

const declared = (kind: string, widgetData: Record<string, unknown>) =>
  renderedChildRefIds(kind, widgetData, new URLSearchParams(window.location.search)).sort()

const child = (resourceRefId: string) => ({ resourceRefId })
const widgetCell = (id: string) => [{ kind: 'widget', resourceRefId: id, valueKey: 'w' }]

const CASES: Array<{ kind: string; Widget: ComponentType<never>; data: Record<string, unknown>; ids: string[]; search?: string; want: string[] }> = [
  { Widget: Flex as never, data: { items: [child('a'), child('b')] }, ids: ['a', 'b'], kind: 'Flex', want: ['a', 'b'] },
  { Widget: Col as never, data: { items: [child('a'), child('b')] }, ids: ['a', 'b'], kind: 'Col', want: ['a', 'b'] },
  { Widget: Row as never, data: { items: [child('a'), child('b')] }, ids: ['a', 'b'], kind: 'Row', want: ['a', 'b'] },
  { Widget: Card as never, data: { cover: 'cov', extraRefId: 'ext', footer: [child('foot')], items: [child('a'), child('b')] }, ids: ['a', 'b', 'cov', 'ext', 'foot'], kind: 'Card', want: ['a', 'b', 'cov', 'ext', 'foot'] },
  { Widget: Collapse as never, data: { items: [{ key: 'open', label: 'Open', resourceRefId: 'shown', status: 'warn' }, { key: 'shut', label: 'Shut', resourceRefId: 'folded' }] }, ids: ['folded', 'shown'], kind: 'Collapse', want: ['shown'] },
  { Widget: Tabs as never, data: { items: [{ label: 'One', resourceRefId: 'first' }, { label: 'Two', resourceRefId: 'second' }] }, ids: ['first', 'second'], kind: 'Tabs', want: ['first'] },
  { Widget: Tabs as never, data: { items: [{ label: 'One', resourceRefId: 'first' }, { label: 'Two', resourceRefId: 'second' }] }, ids: ['first', 'second'], kind: 'Tabs', search: '?tab=two', want: ['second'] },
  { Widget: Table as never, data: { allowedResources: [], columns: [{ title: 'W', valueKey: 'w' }], dataSource: [widgetCell('r1'), widgetCell('r2'), widgetCell('r3')], pagination: { pageSize: 2 } }, ids: ['r1', 'r2', 'r3'], kind: 'Table', want: ['r1', 'r2'] },
  { Widget: Layout as never, data: { content: 'body', hasSider: true, header: 'top', sider: { header: 'logo', resourceRefId: 'nav', width: 236 } }, ids: ['body', 'logo', 'nav', 'top'], kind: 'Layout', want: ['body', 'logo', 'nav', 'top'] },
]

describe('renderedChildRefIds names exactly what each container mounts on first render', () => {
  for (const { Widget, data, ids, kind, search, want } of CASES) {
    it(`${kind}${search ? ` (${search})` : ''}: mounts ${want.join(', ')}`, () => {
      setViewportWidth(1440)
      if (search) { window.history.replaceState(null, '', `/${search}`) }
      const got = mount(Widget, data, ids)
      expect(got, 'what the widget mounted').toEqual(want)
      expect(declared(kind, data), 'what it declares').toEqual(got)
    })
  }

  it('any other kind declares nothing: a Menu\'s items name pages, not children', () => {
    expect(renderedChildRefIds('Menu', { items: [child('page')] }, new URLSearchParams())).toEqual([])
  })

  it('a virtual Table declares nothing: it draws only the rows in view', () => {
    const rows = Array.from({ length: 400 }, (_, index) => widgetCell(`r${index}`))
    expect(renderedChildRefIds('Table', { dataSource: rows }, new URLSearchParams())).toEqual([])
  })
})
