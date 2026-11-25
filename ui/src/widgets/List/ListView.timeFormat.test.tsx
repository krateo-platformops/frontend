// @vitest-environment jsdom
/**
 * `itemTemplate.formats` (approved design "Dates and ages", 2026-11-24): a slot holding an ISO time is
 * written in its form and carries the full date on hover and focus, in each row variant that shows it.
 * A slot without a time form renders as it always has.
 */
import { library } from '@fortawesome/fontawesome-svg-core'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { cleanup, render, screen } from '@testing-library/react'
import { App } from 'antd'
import type * as ReactRouter from 'react-router'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('matchMedia', (query: string) => ({
  addEventListener: vi.fn(), addListener: vi.fn(), dispatchEvent: vi.fn(() => false), matches: false, media: query, onchange: null, removeEventListener: vi.fn(), removeListener: vi.fn(),
}))
vi.stubGlobal('ResizeObserver', class { disconnect = vi.fn(); observe = vi.fn(); unobserve = vi.fn() })
library.add(fas)
vi.mock('react-router', async (importOriginal) => ({ ...(await importOriginal<typeof ReactRouter>()), useNavigate: () => vi.fn() }))
vi.mock('../../hooks/useHandleActions', () => ({ useHandleAction: () => ({ handleAction: vi.fn(), isActionLoading: false }) }))

import type { ItemTemplate } from './itemTemplate'
import { ListView } from './ListView'

const NOW = Date.parse('2026-11-25T15:00:00Z')
beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date'] }) })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const item = { at: new Date(NOW - 52 * 60_000).toISOString(), name: 'acme-feedback', reason: 'Started' }
const renderList = (itemTemplate: ItemTemplate) => render(
  <MemoryRouter>
    <App>
      <ListView itemTemplate={itemTemplate} items={[item]} rowKey='feed' />
    </App>
  </MemoryRouter>,
)

describe('ListView time slots', () => {
  it('a default row: the time in its form, as a <time> carrying the instant', () => {
    renderList({ formats: { secondaryText: 'ago' }, primaryText: '{name}', secondaryText: '{at}', subSecondaryText: '{reason}' })
    const time = screen.getByText('52 minutes ago')
    expect(time.tagName).toBe('TIME')
    expect(time.getAttribute('dateTime')).toBe(new Date(item.at).toISOString())
    expect(screen.getByText('acme-feedback').tagName).not.toBe('TIME')
  })

  it('a title slot with ellipsis: the time, not an ellipsized string', () => {
    renderList({ ellipsis: true, formats: { primaryText: 'age' }, primaryText: '{at}' })
    expect(screen.getByText('52 minutes').tagName).toBe('TIME')
  })

  it('a card and a tree row show it the same way', () => {
    renderList({ formats: { subSecondaryText: 'age' }, primaryText: '{name}', rowVariant: 'card', subSecondaryText: '{at}' })
    expect(screen.getByText('52 minutes').tagName).toBe('TIME')
    cleanup()
    renderList({ formats: { secondaryText: 'age' }, primaryText: '{name}', rowVariant: 'tree', secondaryText: '{at}' })
    expect(screen.getByText('52 minutes').tagName).toBe('TIME')
  })

  it('a statistic tile’s value', () => {
    renderList({ formats: { secondaryText: 'ago' }, primaryText: 'Last reconcile', rowVariant: 'statistic', secondaryText: '{at}' })
    expect(screen.getByText('52 minutes ago').tagName).toBe('TIME')
  })

  it('no formats: no <time>, the DOM it always had', () => {
    const { container } = renderList({ primaryText: '{name}', secondaryText: '{at}' })
    expect(container.querySelectorAll('time')).toHaveLength(0)
    expect(screen.getByText(item.at)).toBeTruthy()
  })
})
