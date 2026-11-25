// @vitest-environment jsdom
/**
 * `itemTemplate.formats` (approved design "Dates and ages", 2026-11-24): a slot holding an ISO time is
 * written in its form and carries the full date on hover and focus, in each row variant that shows it.
 * A slot without a time form renders as it always has.
 */
import { library } from '@fortawesome/fontawesome-svg-core'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

import { formatFull } from '../../utils/dateFormat'

import type { ItemTemplate } from './itemTemplate'
import { ListView } from './ListView'

const NOW = Date.parse('2026-11-25T15:00:00Z')
beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date'] }) })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const item = { at: new Date(NOW - 52 * 60_000).toISOString(), name: 'acme-feedback', reason: 'Started' }
const renderList = (itemTemplate: ItemTemplate, items: unknown[] = [item]) => render(
  <MemoryRouter>
    <App>
      <ListView itemTemplate={itemTemplate} items={items} rowKey='feed' />
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

/**
 * Time tokens in item TEXT (components/TimeText/withTimeTokens, the same tokens as Paragraph and
 * PageHeader): an incident card's footer reads "Opened 52 minutes ago · 24th from this alert", the age
 * the browser's (never frozen in snowplow's cache), in the viewer's zone, the full date on hover. The
 * template puts a {dot.path} inside the token; text without one renders exactly as before.
 */
describe('ListView time tokens in item text', () => {
  const incident = {
    detail: 'Latency on checkout since {moment:2026-11-25T14:08:00Z}',
    name: 'checkout-latency',
    openedAt: new Date(NOW - 52 * 60_000).toISOString(),
    ordinal: '24th',
  }
  const tooltip = () => document.querySelector('.ant-tooltip:not(.ant-tooltip-hidden)')
  const footer = 'Opened {ago:{openedAt}} · {ordinal} from this alert'

  it('a card footer: the time a <time> inside its sentence, the full date on hover', async () => {
    renderList({ primaryText: '{name}', rowVariant: 'card', subSecondaryText: footer }, [incident])
    const time = screen.getByText('52 minutes ago')
    expect(time.tagName).toBe('TIME')
    expect(time.getAttribute('dateTime')).toBe(incident.openedAt)
    expect(time.parentElement?.textContent).toBe('Opened 52 minutes ago · 24th from this alert')
    fireEvent.mouseEnter(time)
    await waitFor(() => { expect(tooltip()?.textContent).toBe(formatFull(incident.openedAt)) })
  })

  it('a card description, from a token the RESTAction wrote into the value', () => {
    renderList({ description: '{detail}', primaryText: '{name}', rowVariant: 'card' }, [incident])
    const time = screen.getByText(/^25 Nov, \d{2}:08$/)
    expect(time.tagName).toBe('TIME')
    expect(time.parentElement?.textContent).toBe(`Latency on checkout since ${time.textContent}`)
  })

  it('a default row: the meta line and the line beside it, with ellipsis too', () => {
    renderList({ ellipsis: true, primaryText: '{name}', subPrimaryText: footer, subSecondaryText: 'last {age:{openedAt}}' }, [incident])
    expect(screen.getAllByText('52 minutes ago').every((node) => node.tagName === 'TIME')).toBe(true)
    expect(screen.getByText('52 minutes').tagName).toBe('TIME')
  })

  it('text without a token: the plain string it always was', () => {
    const { container } = renderList({ description: 'Latency on checkout', primaryText: '{name}', rowVariant: 'card', subSecondaryText: 'Opened 3d ago · {ordinal} from this alert' }, [incident])
    expect(container.querySelectorAll('time')).toHaveLength(0)
    expect(screen.getByText('Opened 3d ago · 24th from this alert').innerHTML).toBe('Opened 3d ago · 24th from this alert')
    expect(screen.getByText('Latency on checkout').innerHTML).toBe('Latency on checkout')
  })
})
