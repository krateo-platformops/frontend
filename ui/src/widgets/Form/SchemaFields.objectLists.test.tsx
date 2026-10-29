// @vitest-environment jsdom
/**
 * Lists of objects. With declared item fields: each row is a card titled by its title field
 * (`x-krateo-row-title`, else the first required string), collapsible — a row with an error opens
 * itself — and `minItems` / `maxItems` gate removing and adding rows. With NO declared item fields
 * (`imagePullSecrets`, `tolerations`): key/value rows per item instead of a JSON textarea, JSON
 * one click away.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Form as AntdForm } from 'antd'
import type { JSONSchema4 } from 'json-schema'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { fromText, isFlatObjectList } from './FreeObjectListInput'
import { rowTitleKey, SchemaFields } from './SchemaFields'

// No global test setup/auto-cleanup is configured (see vite.config.ts) — unmount between tests
// so accumulated DOM doesn't make document-wide queries ambiguous.
afterEach(() => { cleanup() })

beforeAll(() => {
  // antd needs these browser APIs; jsdom has neither.
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

/* eslint-disable sort-keys/sort-keys-fix */
const HOSTS: JSONSchema4 = {
  type: 'array',
  title: 'Hosts',
  maxItems: 2,
  minItems: 1,
  items: {
    type: 'object',
    required: ['host'],
    properties: { path: { type: 'string', default: '/' }, host: { type: 'string' } },
  },
}
const SCHEMA: JSONSchema4 = {
  type: 'object',
  properties: {
    hosts: HOSTS,
    pullSecrets: { type: 'array', title: 'Pull secrets', items: { type: 'object' } },
  },
}
/* eslint-enable sort-keys/sort-keys-fix */

const mount = (initialValues?: Record<string, unknown>, onFinish = vi.fn()) => {
  render(
    <AntdForm initialValues={initialValues} onFinish={onFinish}>
      <SchemaFields schema={SCHEMA} />
      <button type='submit'>submit</button>
    </AntdForm>,
  )
  return onFinish
}
const rowToggle = (name: string) => screen.getByText(name).closest('button') as HTMLButtonElement

describe('rowTitleKey', () => {
  it('prefers x-krateo-row-title, then the first required string, then the first string', () => {
    expect(rowTitleKey({ ...HOSTS, 'x-krateo-row-title': 'path' })).toBe('path')
    expect(rowTitleKey(HOSTS)).toBe('host')
    expect(rowTitleKey({ items: { properties: { name: { type: 'string' }, port: { type: 'integer' } }, type: 'object' }, type: 'array' })).toBe('name')
  })
})

describe('a list of objects with declared fields', () => {
  it('titles a row by its title field', async () => {
    mount()
    fireEvent.click(screen.getByText('Add Hosts'))
    fireEvent.change(document.getElementById('hosts_0_host') as Element, { target: { value: 'api.example.com' } })
    await waitFor(() => { expect(rowToggle('Hosts 1').textContent).toContain('api.example.com') })
  })

  it('a new row starts from the item defaults', async () => {
    const onFinish = mount()
    fireEvent.click(screen.getByText('Add Hosts'))
    fireEvent.change(document.getElementById('hosts_0_host') as Element, { target: { value: 'a.example.com' } })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => { expect(onFinish).toHaveBeenCalled() })
    expect(onFinish.mock.calls[0][0]).toMatchObject({ hosts: [{ host: 'a.example.com', path: '/' }] })
  })

  it('collapses to the title and opens again, its fields still submitted', async () => {
    const onFinish = mount({ hosts: [{ host: 'a.example.com' }] })
    fireEvent.click(rowToggle('Hosts 1'))
    expect(rowToggle('Hosts 1').getAttribute('aria-expanded')).toBe('false')
    expect((document.getElementById('hosts_0_host') as HTMLElement).closest('[style*="display: none"]')).toBeTruthy()
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => { expect(onFinish).toHaveBeenCalled() })
    expect(onFinish.mock.calls[0][0]).toMatchObject({ hosts: [{ host: 'a.example.com' }] })
  })

  it('a collapsed row with an error opens itself', async () => {
    mount({ hosts: [{ host: 'a.example.com' }] })
    fireEvent.change(document.getElementById('hosts_0_host') as Element, { target: { value: '' } })
    fireEvent.click(rowToggle('Hosts 1'))
    expect(rowToggle('Hosts 1').getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => { expect(rowToggle('Hosts 1').getAttribute('aria-expanded')).toBe('true') })
  })

  it('maxItems stops adding and minItems stops removing', () => {
    mount({ hosts: [{ host: 'a' }] })
    expect(screen.getByLabelText<HTMLButtonElement>('Remove Hosts 1').disabled).toBe(true)
    fireEvent.click(screen.getByText('Add Hosts'))
    expect(screen.getByLabelText<HTMLButtonElement>('Remove Hosts 1').disabled).toBe(false)
    expect(screen.getByText('Hosts: at most 2').closest('button')?.disabled).toBe(true)
  })
})

describe('a list of objects with NO declared fields', () => {
  it('reads values back typed: canonical numbers and booleans, else strings', () => {
    expect([fromText('300'), fromText('0300'), fromText('true'), fromText('NoSchedule'), fromText('')]).toEqual([300, '0300', true, 'NoSchedule', ''])
    expect(isFlatObjectList([{ a: 1, b: 'x' }])).toBe(true)
    expect(isFlatObjectList([{ a: { nested: 1 } }])).toBe(false)
  })

  it('is edited as key/value rows and submits the list', async () => {
    const onFinish = mount()
    fireEvent.click(screen.getByText('Add Pull secrets'))
    fireEvent.change(screen.getByLabelText('Pull secrets 1 key 1'), { target: { value: 'name' } })
    fireEvent.change(screen.getByLabelText('Pull secrets 1 value 1'), { target: { value: 'regcred' } })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => { expect(onFinish).toHaveBeenCalled() })
    expect(onFinish.mock.calls[0][0]).toMatchObject({ pullSecrets: [{ name: 'regcred' }] })
  })

  it('opens as JSON when an item holds something rows cannot', () => {
    mount({ pullSecrets: [{ nested: { a: 1 } }] })
    expect(screen.getByText('Edit as rows').closest('button')?.disabled).toBe(true)
    expect(document.querySelector('textarea')?.value).toContain('"nested"')
  })
})
