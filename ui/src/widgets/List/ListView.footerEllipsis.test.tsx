// @vitest-environment jsdom
/**
 * Two Listy affordances the composition-detail page needed to stop being a wall of text:
 *   - `footerNavigateTo`: a footer that says "see all →" is a real link (P12), not a sentence;
 *   - `itemTemplate.ellipsis`: a row's title and sub-line on one line each, the full text kept in
 *     a tooltip (P19) — incidents titled by their root cause were 200-character sentences.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

// antd's ellipsis measures its text with a ResizeObserver, which jsdom lacks.
vi.stubGlobal('ResizeObserver', class { disconnect() { return undefined } observe() { return undefined } unobserve() { return undefined } })

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(), isActionLoading: false }),
}))

import { ListView } from './ListView'

afterEach(() => { cleanup() })

const Where = () => <span data-testid='where'>{useLocation().pathname}</span>

const LONG = 'The chart-inspector cannot pull the chart: the registry answers 403, so RBAC generation fails and the composition never reconciles'

describe('Listy footerNavigateTo', () => {
  it('renders the footer as a link that navigates in-app', () => {
    render(
      <MemoryRouter initialEntries={['/compositions/ns/x']}>
        <App>
          <Routes>
            <Route element={<><ListView footer='3 resolved · see all →' footerNavigateTo='/incidents' itemTemplate={{ primaryText: '{t}' }} items={[{ t: 'a' }]} rowKey='l' /><Where /></>} path='*' />
          </Routes>
        </App>
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: '3 resolved · see all →' })
    expect(link.getAttribute('href')).toBe('/incidents')
    fireEvent.click(link)
    expect(screen.getByTestId('where').textContent).toBe('/incidents')
  })

  it('without it, the footer stays plain text', () => {
    render(<MemoryRouter><App><ListView footer='just a note' itemTemplate={{ primaryText: '{t}' }} items={[{ t: 'a' }]} rowKey='l' /></App></MemoryRouter>)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('just a note')).toBeTruthy()
  })
})

describe('Listy itemTemplate.ellipsis', () => {
  it('renders title and sub-line as one-line ellipsis text, the full text still in the DOM', () => {
    const { container } = render(
      <MemoryRouter><App><ListView itemTemplate={{ ellipsis: true, primaryText: '{t}', subPrimaryText: '{d}' }} items={[{ d: LONG, t: LONG }]} rowKey='l' /></App></MemoryRouter>,
    )
    const oneLine = container.querySelectorAll('.ant-typography-ellipsis')
    expect(oneLine.length).toBe(2)
    expect(oneLine[0].textContent).toBe(LONG)
  })

  it('off by default — rows wrap as before', () => {
    const { container } = render(
      <MemoryRouter><App><ListView itemTemplate={{ primaryText: '{t}' }} items={[{ t: LONG }]} rowKey='l' /></App></MemoryRouter>,
    )
    expect(container.querySelector('.ant-typography-ellipsis')).toBeNull()
  })
})
