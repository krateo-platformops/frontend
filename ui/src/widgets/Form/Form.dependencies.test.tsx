// @vitest-environment jsdom
/**
 * `x-krateo-options.dependsOn` in the real Form: a field whose options depend on another waits
 * for it (no call), loads with its value as `extras[param]`, and is cleared — with whatever
 * depends on it — when the PERSON changes it. Initial values, a resumed draft and an Autopilot
 * draft set fields programmatically and keep every value.
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

/** Options per RESTAction, keyed by the extras value it was called with ('' for none). */
const OPTIONS: Record<string, Record<string, string[]>> = {
  regions: { '': ['eu', 'us'] },
  subnets: { 'eu-a': ['eu-a-1'], 'eu-b': ['eu-b-1'], 'us-a': ['us-a-1'] },
  zones: { eu: ['eu-a', 'eu-b'], us: ['us-a'] },
}
const fetchMock = vi.fn<typeof fetch>((input) => {
  const url = new URL(input as string)
  const name = url.searchParams.get('name') ?? ''
  const extras = JSON.parse(url.searchParams.get('extras') ?? '{}') as Record<string, string>
  const status = OPTIONS[name]?.[Object.values(extras)[0] ?? ''] ?? []
  return Promise.resolve(new Response(JSON.stringify({ status }), { status: 200 }))
})
beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

const ref = (id: string) => ({ allowed: true, id, path: `/call?resource=restactions&name=${id}&namespace=demo`, payload: {}, verb: 'GET' as const })
const REFS: ResourcesRefs = { items: [ref('regions'), ref('zones'), ref('subnets')] }

/* eslint-disable sort-keys/sort-keys-fix */
const SCHEMA = {
  type: 'object',
  properties: {
    region: { title: 'Region', type: 'string', 'x-krateo-options': { closed: true, ref: 'regions' } },
    zone: { title: 'Zone', type: 'string', 'x-krateo-options': { closed: true, dependsOn: { field: 'region', param: 'region' }, ref: 'zones' } },
    subnet: { title: 'Subnet', type: 'string', 'x-krateo-options': { closed: true, dependsOn: { field: 'zone', param: 'zone' }, ref: 'subnets' } },
    token: { format: 'password', title: 'Token', type: 'string' },
    leak: { title: 'Leak', type: 'string', 'x-krateo-options': { dependsOn: { field: 'token', param: 'token' }, ref: 'zones' } },
    whoami: { title: 'Who', type: 'string', 'x-krateo-options': { dependsOn: { field: 'region', param: 'username' }, ref: 'zones' } },
  },
  required: ['region', 'zone', 'subnet', 'token', 'leak', 'whoami'],
}
/* eslint-enable sort-keys/sort-keys-fix */

const widgetData = (extra: Partial<FormWidgetData> = {}): FormWidgetData => ({
  actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] },
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
const selected = (label: string) => fieldItem(label).querySelector('.ant-select-content')?.textContent ?? ''
const pick = async (label: string, option: string) => {
  fireEvent.mouseDown(fieldItem(label).querySelector('.ant-select') as HTMLElement)
  const entries = await screen.findAllByText(option, { selector: '.ant-select-item-option-content *, .ant-select-item-option-content' })
  fireEvent.click(entries[entries.length - 1])
}
const calls = (name: string) => fetchMock.mock.calls
  .map(([input]) => new URL(input as string))
  .filter((url) => url.searchParams.get('name') === name)
  .map((url) => JSON.parse(url.searchParams.get('extras') ?? 'null') as unknown)

describe('Form — dependsOn', () => {
  it('waits for its parent without calling, then loads with the parent value', async () => {
    renderForm(widgetData())
    expect(fieldItem('Zone').textContent).toContain('Choose Region first.')
    await waitFor(() => { expect(calls('regions')).toHaveLength(1) })
    expect(calls('zones')).toHaveLength(0)
    await pick('Region', 'eu')
    await waitFor(() => { expect(calls('zones')).toEqual([{ region: 'eu' }]) })
    expect(fieldItem('Zone').textContent).not.toContain('Choose Region first.')
  })

  it('clears the dependent chain when the person changes the parent', async () => {
    renderForm(widgetData())
    await pick('Region', 'eu')
    await waitFor(() => { expect(calls('zones')).toHaveLength(1) })
    await pick('Zone', 'eu-b')
    await waitFor(() => { expect(calls('subnets')).toHaveLength(1) })
    await pick('Subnet', 'eu-b-1')
    expect(selected('Subnet')).toContain('eu-b-1')
    await pick('Region', 'us')
    await waitFor(() => { expect(selected('Zone')).not.toContain('eu-b') })
    expect(selected('Subnet')).not.toContain('eu-b-1')
    await waitFor(() => { expect(calls('zones')).toContainEqual({ region: 'us' }) })
  })

  it('keeps initial values: a programmatic set is not a change by the person', async () => {
    renderForm(widgetData({ initialValues: { region: 'eu', subnet: 'eu-a-1', zone: 'eu-a' } }))
    await waitFor(() => { expect(calls('subnets')).toEqual([{ zone: 'eu-a' }]) })
    // Let any effect that would clear a dependent run before reading the values.
    await act(() => new Promise((resolve) => { setTimeout(resolve, 50) }))
    expect(selected('Zone')).toContain('eu-a')
    expect(selected('Subnet')).toContain('eu-a-1')
  })

  it('never depends on a secret, nor sends a value under an identity name', () => {
    renderForm(widgetData())
    expect(fieldItem('Leak').textContent).toContain('misconfigured: options cannot depend on Token: it is a secret')
    expect(fieldItem('Who').textContent).toContain('cannot be "username"')
  })
})
