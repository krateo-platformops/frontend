// @vitest-environment jsdom
/**
 * Autocomplete in the real Form: `autocomplete.extra.key` sends what the person types
 * (debounced, from `minChars`), a CLOSED list known in full rejects a value that came from
 * elsewhere, and the Review shows the label an option was picked by while the payload keeps
 * its value.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourcesRefs } from '../../types/Widget'

import Form, { type FormWidgetData } from './Form'

const handleAction = vi.fn((..._args: unknown[]) => Promise.resolve())
let agentDraft: Record<string, unknown> | null = null

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction, isActionLoading: false }),
}))
vi.mock('../../components/Autopilot/agentDraft', () => ({
  useAgentDraft: () => ({ draft: agentDraft, nonce: 1 }),
}))
vi.mock('../Drawer/DrawerContext', () => ({
  useDrawerContext: () => ({ insideDrawer: false, setDrawerData: vi.fn() }),
}))
vi.mock('../../components/WidgetRenderer', () => ({ default: () => null }))
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('antd/es/app/useApp', () => ({ default: () => ({ message: {}, modal: {}, notification: { error: vi.fn(), success: vi.fn() } }) }))

beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      addEventListener: noop,
      addListener: noop,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: noop,
      removeListener: noop,
    }),
    writable: true,
  })
  globalThis.ResizeObserver = class {
    disconnect = noop
    observe = noop
    unobserve = noop
  }
})
beforeEach(() => {
  handleAction.mockClear()
  agentDraft = null
  localStorage.clear()
})
afterEach(() => { cleanup() })

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({ config: { api: { SNOWPLOW_API_BASE_URL: 'http://snowplow.test' } } }),
}))
vi.mock('../../utils/getAccessToken', () => ({ getAccessToken: () => 'token-1' }))

const CITIES = [{ label: 'Paris', value: 'par' }, { label: 'Pavia', value: 'pav' }, { label: 'Rome', value: 'rom' }]
const fetchMock = vi.fn<typeof fetch>((input) => {
  const url = new URL(input as string)
  const name = url.searchParams.get('name') ?? ''
  const extras = JSON.parse(url.searchParams.get('extras') ?? '{}') as Record<string, string>
  let status: unknown[] = []
  if (name === 'regions') { status = [{ label: 'Europe', value: 'eu' }, { label: 'United States', value: 'us' }] }
  if (name === 'cities') { status = CITIES.filter((city) => city.label.toLowerCase().includes((extras.q ?? '').toLowerCase())) }
  return Promise.resolve(new Response(JSON.stringify({ status }), { status: 200 }))
})
beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

const ref = (id: string) => ({ allowed: true, id, path: `/call?resource=restactions&name=${id}&namespace=demo`, payload: {}, verb: 'GET' as const })
const REFS: ResourcesRefs = { items: [ref('regions'), ref('cities')] }

/* eslint-disable sort-keys/sort-keys-fix */
const SCHEMA = {
  type: 'object',
  properties: {
    region: { title: 'Region', type: 'string', autocomplete: { closed: true, resourceRefId: 'regions' } },
    city: { title: 'City', type: 'string', autocomplete: { extra: { key: 'q' }, minChars: 2, resourceRefId: 'cities' } },
    capital: { title: 'Capital', type: 'string', autocomplete: { closed: true, extra: { key: 'q' }, resourceRefId: 'cities' } },
  },
}
/* eslint-enable sort-keys/sort-keys-fix */

const widgetData = (extra: Partial<FormWidgetData> = {}): FormWidgetData => ({
  actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] },
  reviewBeforeSubmit: true,
  stringSchema: JSON.stringify(SCHEMA),
  submitActionId: 'submit',
  ...extra,
})

const renderForm = (data: FormWidgetData) => render(
  <QueryClientProvider client={new QueryClient()}>
    <Form resourcesRefs={REFS} uid='u' widgetData={data} />
  </QueryClientProvider>,
)

const fieldItem = (label: string) => screen.getByText(label, { selector: '[class*="fieldName"]' }).closest('.ant-form-item') as HTMLElement
const searchBox = (label: string) => fieldItem(label).querySelector('input') as HTMLInputElement
const calls = (name: string) => fetchMock.mock.calls
  .map(([input]) => new URL(input as string))
  .filter((url) => url.searchParams.get('name') === name)
  .map((url) => JSON.parse(url.searchParams.get('extras') ?? 'null') as unknown)
const optionTexts = () => [...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].map((el) => el.textContent)

describe('Form — autocomplete search', () => {
  it('sends nothing under minChars, then the typed text once typing pauses', async () => {
    renderForm(widgetData())
    fireEvent.change(searchBox('City'), { target: { value: 'p' } })
    await act(() => new Promise((resolve) => { setTimeout(resolve, 400) }))
    expect(calls('cities')).toHaveLength(0)
    fireEvent.change(searchBox('City'), { target: { value: 'pa' } })
    fireEvent.change(searchBox('City'), { target: { value: 'pav' } })
    await waitFor(() => { expect(calls('cities')).toEqual([{ q: 'pav' }]) })
  })

  it('a closed search keeps the picked label after the next search replaces the list', async () => {
    renderForm(widgetData())
    fireEvent.mouseDown(fieldItem('Capital').querySelector('.ant-select') as HTMLElement)
    fireEvent.change(searchBox('Capital'), { target: { value: 'ro' } })
    await waitFor(() => { expect(optionTexts()).toEqual(['Rome']) })
    fireEvent.click(screen.getByText('Rome', { selector: '.ant-select-item-option *' }))
    fireEvent.mouseDown(fieldItem('Capital').querySelector('.ant-select') as HTMLElement)
    fireEvent.change(searchBox('Capital'), { target: { value: 'pa' } })
    await waitFor(() => { expect(calls('cities')).toContainEqual({ q: 'pa' }) })
    expect(fieldItem('Capital').querySelector('.ant-select-content')?.textContent).toContain('Rome')
  })
})

describe('Form — a closed list known in full', () => {
  it('flags a value that is not in it, once the list arrives', async () => {
    renderForm(widgetData({ initialValues: { region: 'mars' } }))
    expect(await screen.findByText('Region: mars is not among the available options')).toBeTruthy()
  })
})

describe('Form — Review', () => {
  it('shows the label the option was picked by; the submit sends the value', async () => {
    renderForm(widgetData())
    await waitFor(() => { expect(calls('regions')).toHaveLength(1) })
    fireEvent.mouseDown(fieldItem('Region').querySelector('.ant-select') as HTMLElement)
    fireEvent.click(await screen.findByText('United States', { selector: '.ant-select-item-option *' }))
    fireEvent.click(screen.getByRole('button', { name: /Review/ }))
    expect(await screen.findByText('United States (us)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Submit|Create|Confirm/ }))
    await waitFor(() => { expect(handleAction).toHaveBeenCalled() })
    expect(handleAction.mock.calls[0][2]).toMatchObject({ region: 'us' })
  })
})
