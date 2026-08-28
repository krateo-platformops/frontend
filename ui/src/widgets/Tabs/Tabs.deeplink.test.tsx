// @vitest-environment jsdom
/**
 * S (Vincenzo feedback): a `?tab=<label>` query param selects the initial Tabs tab, so
 * hand-offs like `/observability?svc=…&tab=Telemetry` land on the logs instead of the default
 * first tab. Absent / non-matching param → antd's default (first tab), i.e. no behaviour change.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Tabs from './Tabs'

// The tab body renders WidgetRenderer (which would fetch) — stub it; we only assert tab selection.
vi.mock('../../components/WidgetRenderer', () => ({ default: () => <div data-testid='wr' /> }))
vi.mock('../../utils/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/utils')>()),
  getEndpointUrl: () => 'http://example.test/endpoint',
}))

vi.stubGlobal('matchMedia', (query: string) => ({
  addEventListener: vi.fn(), addListener: vi.fn(), dispatchEvent: vi.fn(() => false),
  matches: false, media: query, onchange: null, removeEventListener: vi.fn(), removeListener: vi.fn(),
}))
vi.stubGlobal('ResizeObserver', class { disconnect = vi.fn(); observe = vi.fn(); unobserve = vi.fn() })

const widgetData = {
  allowedResources: ['cols'],
  items: [
    { label: 'Reconciliation', resourceRefId: 'obs-tab-reconciliation' },
    { label: 'Telemetry', resourceRefId: 'obs-tab-telemetry' },
    { label: 'Components', resourceRefId: 'obs-tab-components' },
  ],
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderTabs = () => render(<Tabs resourcesRefs={{ items: [] }} uid='obs-main' widgetData={widgetData as any} />)

const setSearch = (search: string) => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL(`http://localhost/observability${search}`),
  })
}

const selected = (name: string) => screen.getByRole('tab', { name }).getAttribute('aria-selected')

describe('Tabs — deep-linkable active tab (?tab=)', () => {
  afterEach(cleanup)

  it('opens the tab named by ?tab= (case-insensitive)', () => {
    setSearch('?svc=snowplow&tab=telemetry')
    renderTabs()
    expect(selected('Telemetry')).toBe('true')
    expect(selected('Reconciliation')).toBe('false')
  })

  it('falls back to the first tab when ?tab= is absent', () => {
    setSearch('')
    renderTabs()
    expect(selected('Reconciliation')).toBe('true')
  })

  it('falls back to the first tab when ?tab= matches no label', () => {
    setSearch('?tab=does-not-exist')
    renderTabs()
    expect(selected('Reconciliation')).toBe('true')
  })
})
