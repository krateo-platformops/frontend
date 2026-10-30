// @vitest-environment jsdom
/**
 * When an options source is down. An OPEN field always takes typed text, and says so. A CLOSED
 * field with `fallback: "manual"` whose source fails or answers an empty list takes a typed value
 * instead of blocking the form — checked against the list again once the source is back. Without
 * the fallback a closed field stays closed. A call that does not answer is cut off.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

/** What each RESTAction answers: a status code, or a list. Changed per test. */
let answers: Record<string, number | unknown[]> = {}
const fetchMock = vi.fn<typeof fetch>((input) => {
  const name = new URL(input as string).searchParams.get('name') ?? ''
  const answer = answers[name] ?? 500
  return Promise.resolve(typeof answer === 'number'
    ? new Response('{}', { status: answer })
    : new Response(JSON.stringify({ status: answer }), { status: 200 }))
})
beforeEach(() => {
  fetchMock.mockClear()
  answers = {}
  vi.stubGlobal('fetch', fetchMock)
})

const ref = (id: string) => ({ allowed: true, id, path: `/call?resource=restactions&name=${id}&namespace=demo`, payload: {}, verb: 'GET' as const })
const REFS: ResourcesRefs = { items: [ref('regions'), ref('ports'), ref('cities')] }

/* eslint-disable sort-keys/sort-keys-fix */
const SCHEMA = {
  type: 'object',
  properties: {
    region: { title: 'Region', type: 'string', autocomplete: { closed: true, fallback: 'manual', resourceRefId: 'regions' } },
    port: { title: 'Port', type: 'integer', autocomplete: { closed: true, fallback: 'manual', resourceRefId: 'ports' } },
    strict: { title: 'Strict', type: 'string', autocomplete: { closed: true, resourceRefId: 'regions' } },
    city: { title: 'City', type: 'string', autocomplete: { resourceRefId: 'cities' } },
    odd: { title: 'Odd', type: 'string', autocomplete: { closed: true, fallback: 'always', resourceRefId: 'regions' } },
  },
}
/* eslint-enable sort-keys/sort-keys-fix */

const widgetData = (): FormWidgetData => ({
  actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] },
  stringSchema: JSON.stringify(SCHEMA),
  submitActionId: 'submit',
})
const renderForm = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <Form resourcesRefs={REFS} uid='u' widgetData={widgetData()} />
  </QueryClientProvider>,
)
const fieldItem = (label: string) => screen.getByText(label, { selector: '[class*="fieldName"]' }).closest('.ant-form-item') as HTMLElement
const note = (label: string) => fieldItem(label).querySelector('[role=status]')?.textContent ?? ''
const submit = () => { fireEvent.submit(document.querySelector('form') as HTMLFormElement) }

describe('Form — an options source that is down', () => {
  it('a closed field with fallback: manual takes a typed value, and submits it', async () => {
    renderForm()
    await waitFor(() => { expect(note('Region')).toBe('The options could not be loaded. You can type the value.Retry') })
    fireEvent.change(document.querySelector('input#region') as HTMLInputElement, { target: { value: 'eu-custom' } })
    fireEvent.change(document.querySelector('input#port') as HTMLInputElement, { target: { value: '8443' } })
    submit()
    await waitFor(() => { expect(handleAction).toHaveBeenCalled() })
    expect(handleAction.mock.calls[0][2]).toMatchObject({ port: 8443, region: 'eu-custom' })
  })

  it('so does one whose source answers an empty list', async () => {
    answers = { ports: [], regions: [] }
    renderForm()
    await waitFor(() => { expect(note('Region')).toContain('No options are available right now. You can type the value.') })
    expect(document.querySelector('input#region')?.closest('.ant-select')).toBeNull()
  })

  it('once the source is back, a typed value not in its list is flagged', async () => {
    renderForm()
    await waitFor(() => { expect(note('Region')).toContain('You can type the value') })
    fireEvent.change(document.querySelector('input#region') as HTMLInputElement, { target: { value: 'eu-custom' } })
    answers = { regions: [{ label: 'Europe', value: 'eu' }] }
    fireEvent.click(within(fieldItem('Region')).getByText('Retry'))
    expect(await screen.findByText('Region: eu-custom is not among the available options')).toBeTruthy()
  })

  it('without the fallback a closed field stays closed', async () => {
    renderForm()
    await waitFor(() => { expect(note('Strict')).toBe('The options could not be loaded.Retry') })
    expect(fieldItem('Strict').querySelector('.ant-select')).toBeTruthy()
  })

  it('an open field says it still takes typed text', async () => {
    renderForm()
    await waitFor(() => { expect(note('City')).toContain('The options could not be loaded. You can type the value.') })
  })

  it('an unknown fallback is a misconfiguration', () => {
    renderForm()
    expect(note('Odd')).toContain('misconfigured: fallback must be "manual"')
  })

  it('a call that does not answer is cut off', async () => {
    renderForm()
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled() })
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })
})
