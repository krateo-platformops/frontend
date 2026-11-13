// @vitest-environment jsdom
/**
 * A Collapse panel header is a control, and is announced as one: a button with `aria-expanded`,
 * reachable with Tab and toggled with Enter (antd's own header), whose accessible name carries the
 * count — "Open 47" — so a screen-reader user hears how much a group holds before opening it.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
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

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(), isActionLoading: false }),
}))

import Collapse, { type CollapseWidgetData } from './Collapse'

const widgetData: CollapseWidgetData = {
  itemTemplate: { primaryText: '{name}' },
  items: [
    { count: 47, dataSource: [{ name: 'sre-probe-failing' }], key: 'open', label: 'Open', status: 'error' },
    { count: 12, dataSource: [{ name: 'node-not-ready' }], key: 'resolved', label: 'Resolved' },
  ],
}

afterEach(cleanup)

const renderCollapse = () => render(
  <MemoryRouter>
    <App>
      <Collapse resourcesRefs={{ items: [] }} uid='a11y' widgetData={widgetData} />
    </App>
  </MemoryRouter>,
)

describe('Collapse accessibility', () => {
  // antd's expand arrow is an img labelled "expanded" / "collapsed", so the name antd gives the
  // header starts with that word; what this widget owns is the end of it, the title and the count.
  it('each header is a button named by its title and its count', () => {
    renderCollapse()
    expect(screen.getByRole('button', { name: /\bOpen 47$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /\bResolved 12$/ })).toBeTruthy()
  })

  it('headers are in the Tab order and toggle with Enter', async () => {
    renderCollapse()
    const user = userEvent.setup()
    const resolved = screen.getByRole('button', { name: /\bResolved 12$/ })
    expect(resolved.getAttribute('aria-expanded')).toBe('false')

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /\bOpen 47$/ }))
    await user.tab()
    expect(document.activeElement).toBe(resolved)

    await user.keyboard('{Enter}')
    expect(resolved.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('node-not-ready')).toBeTruthy()
    await user.keyboard('{Enter}')
    expect(resolved.getAttribute('aria-expanded')).toBe('false')
  })
})
