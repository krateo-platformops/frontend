// @vitest-environment jsdom
/**
 * `x-krateo-options`: a field whose options come from a RESTAction named by one of the Form's
 * resourcesRefs. The field calls the path snowplow resolved (never one built from the schema),
 * stores only the option's value, and says why when it cannot show a list — no toast.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Form as AntdForm } from 'antd'
import type { JSONSchema4 } from 'json-schema'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourcesRefs } from '../../types/Widget'

import { getFieldOptionsSpec, parseFieldOptions } from './fieldOptions'
import { SchemaFields } from './SchemaFields'
import { fetchFieldOptions, FormRefsContext } from './useFieldOptions'

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({ config: { api: { SNOWPLOW_API_BASE_URL: 'http://snowplow.test' } } }),
}))
vi.mock('../../utils/getAccessToken', () => ({ getAccessToken: () => 'token-1' }))

afterEach(() => { cleanup() })

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

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

const respond = (body: unknown, status = 200) => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }))
}

describe('getFieldOptionsSpec', () => {
  it('reads ref and closed', () => {
    expect(getFieldOptionsSpec({ type: 'string', 'x-krateo-options': { closed: true, ref: ' regions ' } })).toEqual({ closed: true, ref: 'regions' })
    expect(getFieldOptionsSpec({ type: 'string', 'x-krateo-options': { ref: 'regions' } })).toEqual({ closed: false, ref: 'regions' })
  })

  it('reads a malformed extension as absent', () => {
    expect(getFieldOptionsSpec({ type: 'string' })).toBeUndefined()
    expect(getFieldOptionsSpec({ type: 'string', 'x-krateo-options': 'regions' })).toBeUndefined()
    expect(getFieldOptionsSpec({ type: 'string', 'x-krateo-options': { ref: '' } })).toBeUndefined()
  })

  it('never loads options for a secret', () => {
    expect(getFieldOptionsSpec({ format: 'password', type: 'string', 'x-krateo-options': { ref: 'r' } })).toBeUndefined()
  })
})

describe('parseFieldOptions', () => {
  it('reads label/value pairs and bare values from the RESTAction status', () => {
    expect(parseFieldOptions({ status: [{ label: 'EU West', value: 'eu-west-1' }, 'us-east-1', 3, { description: 'd', value: true }] })).toEqual([
      { description: undefined, label: 'EU West', value: 'eu-west-1' },
      { label: 'us-east-1', value: 'us-east-1' },
      { label: '3', value: 3 },
      { description: 'd', label: 'true', value: true },
    ])
  })

  it('drops malformed entries and duplicates', () => {
    expect(parseFieldOptions({ status: [null, { label: 'x' }, 'a', 'a', { value: {} }] })).toEqual([{ label: 'a', value: 'a' }])
  })

  it('reads a status that is not a list as a failure', () => {
    expect(parseFieldOptions({ status: { list: [] } })).toBeUndefined()
    expect(parseFieldOptions(null)).toBeUndefined()
  })
})

describe('fetchFieldOptions', () => {
  it('calls the resolved path with the Bearer token and merges extras over the path\'s own', async () => {
    respond({ status: ['a'] })
    await fetchFieldOptions('http://snowplow.test', '/call?resource=restactions&name=zones&extras=%7B%22fixed%22%3A1%7D', { region: 'eu' })
    const [[url, init]] = fetchMock.mock.calls
    const parsed = new URL(url as string)
    expect(parsed.searchParams.get('name')).toBe('zones')
    expect(JSON.parse(parsed.searchParams.get('extras') ?? '')).toEqual({ fixed: 1, region: 'eu' })
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-1')
  })

  it('rejects a non-OK answer', async () => {
    respond({}, 500)
    await expect(fetchFieldOptions('http://snowplow.test', '/call?x=1', undefined)).rejects.toThrow('500')
  })
})

const REFS: ResourcesRefs = {
  items: [
    { allowed: true, id: 'regions', path: '/call?resource=restactions&apiVersion=templates.krateo.io/v1&name=regions&namespace=demo', payload: {}, verb: 'GET' },
    { allowed: false, id: 'secret-list', path: '/call?resource=restactions&name=secret-list', payload: {}, verb: 'GET' },
  ],
}

const renderField = (node: JSONSchema4, onFinish = vi.fn()) => {
  const schema: JSONSchema4 = { properties: { region: node }, required: ['region'], type: 'object' }
  const client = new QueryClient()
  const Harness = () => {
    const [form] = AntdForm.useForm()
    return (
      <QueryClientProvider client={client}>
        <FormRefsContext.Provider value={{ resourcesRefs: REFS }}>
          <AntdForm form={form} onFinish={onFinish}>
            <SchemaFields schema={schema} />
            <button type='submit'>submit</button>
          </AntdForm>
        </FormRefsContext.Provider>
      </QueryClientProvider>
    )
  }
  return { onFinish, ...render(<Harness />) }
}

const openSelect = (container: HTMLElement) => {
  fireEvent.mouseDown(container.querySelector('.ant-select') as HTMLElement)
}

describe('SchemaFields — a field with x-krateo-options', () => {
  it('loads the options from the resolved path and submits the picked value only', async () => {
    respond({ status: [{ label: 'EU West', value: 'eu-west-1' }, { label: 'US East', value: 'us-east-1' }] })
    const { container, onFinish } = renderField({ title: 'Region', type: 'string', 'x-krateo-options': { closed: true, ref: 'regions' } })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('name')).toBe('regions')
    openSelect(container)
    fireEvent.click(await screen.findByText('US East'))
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => { expect(onFinish).toHaveBeenCalled() })
    expect(onFinish.mock.calls[0][0]).toEqual({ region: 'us-east-1' })
  })

  it('an open field keeps a value that is not in the list', async () => {
    respond({ status: ['eu-west-1'] })
    const { container, onFinish } = renderField({ type: 'string', 'x-krateo-options': { ref: 'regions' } })
    const input = container.querySelector('input#region') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'my-own-region' } })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => { expect(onFinish).toHaveBeenCalled() })
    expect(onFinish.mock.calls[0][0]).toEqual({ region: 'my-own-region' })
  })

  it('a ref the form does not have disables the field and says so, without calling anything', () => {
    const { container } = renderField({ type: 'string', 'x-krateo-options': { closed: true, ref: 'nope' } })
    expect(screen.getByRole('status').textContent).toContain('no source "nope"')
    expect(container.querySelector('.ant-select-disabled')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a ref snowplow denied disables the field without calling it', () => {
    const { container } = renderField({ type: 'string', 'x-krateo-options': { closed: true, ref: 'secret-list' } })
    expect(screen.getByRole('status').textContent).toContain('do not have access')
    expect(container.querySelector('.ant-select-disabled')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a failed load says so on the field and retries on request', async () => {
    respond({}, 500)
    renderField({ type: 'string', 'x-krateo-options': { closed: true, ref: 'regions' } })
    expect((await screen.findByRole('status')).textContent).toContain('could not be loaded')
    respond({ status: ['eu-west-1'] })
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('an array field picks several values', async () => {
    respond({ status: [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }] })
    const { container, onFinish } = renderField({ items: { type: 'string' }, type: 'array', 'x-krateo-options': { closed: true, ref: 'regions' } })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalled() })
    openSelect(container)
    fireEvent.click(await screen.findByText('Alpha'))
    fireEvent.click(await screen.findByText('Beta'))
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => { expect(onFinish).toHaveBeenCalled() })
    expect(onFinish.mock.calls[0][0]).toEqual({ region: ['a', 'b'] })
  })
})
