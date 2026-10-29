// @vitest-environment jsdom
/**
 * The Table's export control: when it appears, and what it says about each outcome.
 *
 * Two of the three formats cannot be exercised against a live snowplow until 1.12.62 is tagged, so
 * the outcomes are driven here through a stubbed fetch against the contract snowplow confirmed for
 * #980. If that contract moves, these are what fail.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App, notification } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('../../components/FiltesProvider/FiltersProvider', () => ({
  useFilter: () => ({ getFilteredData: (data: unknown) => data }),
}))
vi.mock('../../utils/getAccessToken', () => ({ getAccessToken: () => 'tok' }))

import Table from './Table'
import type { TableWidgetData } from './Table'

const cell = (valueKey: string, stringValue: string) => ({ kind: 'jsonSchemaType', stringValue, type: 'string', valueKey })

const widgetData = (columns: unknown) => ({
  columns,
  // One cell per column: a row shorter than `columns` makes antd's renderer read an undefined
  // cell, which the widget reports as "Table rendering error" and is a fixture bug, not a case.
  dataSource: [[cell('name', 'alpha'), cell('phase', 'Running')]],
} as unknown as TableWidgetData)

const TWO_COLUMNS = [{ title: 'Name', valueKey: 'name' }, { title: 'Phase', valueKey: 'phase' }]

/** The URL the hook would build: base + endpoint + extras, with the export query appended. */
const exportUrlFor = (query: string) => `http://sp/call?resource=tables&extras=%7B%7D&${query}`

let requested: string[] = []
let clicks: { download: string }[] = []

const stubFetch = (init: { status?: number; body?: BodyInit; headers?: Record<string, string> }) => {
  vi.stubGlobal('fetch', (url: string) => {
    requested.push(url)
    return Promise.resolve(new Response(init.body ?? 'a\n1\n', { headers: init.headers, status: init.status ?? 200 }))
  })
}

const renderTable = (options: { columns?: unknown; withUrl?: boolean } = {}) => {
  const { columns = TWO_COLUMNS, withUrl = true } = options
  return render(
    <MemoryRouter>
      <App>
        <Table exportUrlFor={withUrl ? exportUrlFor : undefined} resourcesRefs={{ items: [] }} uid='t1' widgetData={widgetData(columns)} />
      </App>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  requested = []
  clicks = []
  // Capture the download instead of letting jsdom navigate.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureDownload(this: HTMLAnchorElement) {
    clicks.push({ download: this.download })
  })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }))
})
// NOT vi.unstubAllGlobals(): the ResizeObserver/matchMedia stubs above are module-level, and
// clearing them left every test after the first dying on `window.matchMedia is not a function`.
//
// `notification.destroy()` matters as much: antd renders notifications into a document.body
// portal that testing-library's cleanup() does not own, so the truncation warning survived into
// the next test and made "says nothing" find a message it had not produced.
afterEach(() => {
  cleanup()
  notification.destroy()
  vi.restoreAllMocks()
})

const openMenuAndPick = async (label: string) => {
  fireEvent.click(screen.getByLabelText('Export'))
  await waitFor(() => expect(screen.getByText(label)).toBeTruthy())
  fireEvent.click(screen.getByText(label))
}

describe('when the control appears at all', () => {
  it('is ABSENT when the widget was given no export URL — nothing to export from', () => {
    renderTable({ withUrl: false })
    expect(screen.queryByLabelText('Export')).toBeNull()
  })

  it('is ABSENT when no column names a cell, so an existing table is untouched', () => {
    renderTable({ columns: [{ title: 'Decorative' }] })
    expect(screen.queryByLabelText('Export')).toBeNull()
  })

  it('is PRESENT when there is both a URL and an exportable column', () => {
    renderTable()
    expect(screen.getByLabelText('Export')).toBeTruthy()
  })
})

describe('what it asks snowplow for', () => {
  it('sends fields and one header per field, and downloads the file', async () => {
    stubFetch({})
    renderTable()
    await openMenuAndPick('CSV')
    await waitFor(() => expect(requested).toHaveLength(1))
    const params = new URLSearchParams(requested[0].split('?')[1])
    expect(params.get('format')).toBe('csv')
    expect(params.get('fields')).toBe('name,phase')
    expect(params.getAll('header')).toEqual(['Name', 'Phase'])
    // The hook's own extras survive onto the export, so it matches the filters on screen.
    expect(params.get('extras')).toBe('{}')
    await waitFor(() => expect(clicks).toEqual([{ download: 'export.csv' }]))
  })

  it('asks for pdf when pdf is picked', async () => {
    stubFetch({})
    renderTable()
    await openMenuAndPick('PDF')
    await waitFor(() => expect(requested).toHaveLength(1))
    expect(new URLSearchParams(requested[0].split('?')[1]).get('format')).toBe('pdf')
  })
})

describe('the outcomes a person has to be told about', () => {
  it('warns that a TRUNCATED csv is incomplete, while still delivering the file', async () => {
    stubFetch({ headers: { 'x-export-truncated': 'true' } })
    renderTable()
    await openMenuAndPick('CSV')
    await waitFor(() => expect(screen.getByText('CSV export is incomplete')).toBeTruthy())
    expect(screen.getByText(/first 50,000 rows/)).toBeTruthy()
    // Partial is not failed: the file is valid and still handed over.
    expect(clicks).toEqual([{ download: 'export.csv' }])
  })

  it('shows pdf\'s 422 at the row bound as an error, with no download', async () => {
    stubFetch({ body: JSON.stringify({ message: 'export exceeds the 50000 row bound for pdf' }), status: 422 })
    renderTable()
    await openMenuAndPick('PDF')
    await waitFor(() => expect(screen.getByText('PDF export failed')).toBeTruthy())
    expect(screen.getByText('export exceeds the 50000 row bound for pdf')).toBeTruthy()
    expect(clicks).toEqual([])
  })

  it('says nothing and downloads quietly when the export is complete', async () => {
    stubFetch({})
    renderTable()
    await openMenuAndPick('CSV')
    await waitFor(() => expect(clicks).toHaveLength(1))
    expect(screen.queryByText(/export is incomplete/)).toBeNull()
    expect(screen.queryByText(/export failed/)).toBeNull()
  })
})
