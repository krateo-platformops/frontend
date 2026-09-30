// @vitest-environment jsdom
/**
 * FRM1 — progressive disclosure in the schema→controls renderer (SchemaFields). The create
 * form partitions properties by `schema.required`: REQUIRED fields render up-front, the
 * NON-required ones are collected into an antd Collapse titled "Advanced · N settings"
 * (collapsed by default). This is disclosure, not hiding — a collapsed optional field is
 * still mounted, so it validates and submits its value exactly like a flat field. `hide`
 * still omits a property from either partition.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Form as AntdForm } from 'antd'
import type { JSONSchema4 } from 'json-schema'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { SchemaFields } from './SchemaFields'

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

// A deliberately NON-alphabetical property order (required interleaved with optional) — the
// renderer must partition by `required` while preserving each partition's original order.
/* eslint-disable sort-keys/sort-keys-fix */
const SCHEMA: JSONSchema4 = {
  properties: {
    // required, up-front
    name: { title: 'Name', type: 'string' },
    size: { title: 'Instance size', type: 'string' },
    // optional → Advanced collapse
    replicas: { title: 'Replica count', type: 'integer' },
    region: { title: 'Region', type: 'string' },
    debug: { title: 'Debug flag', type: 'boolean' },
    // hidden — must never render, in either partition
    internalToken: { title: 'Internal token', type: 'string' },
  },
  required: ['name', 'size'],
  type: 'object',
}
/* eslint-enable sort-keys/sort-keys-fix */

// Renders SchemaFields inside a real antd Form so submission / validation are exercised.
const renderInForm = (onFinish?: (values: Record<string, unknown>) => void, hide: string[] = ['internalToken']) => {
  const Harness = () => {
    const [form] = AntdForm.useForm()
    return (
      <AntdForm form={form} onFinish={(values) => onFinish?.(values as Record<string, unknown>)}>
        <SchemaFields hide={hide} schema={SCHEMA} />
        <button type='submit'>submit</button>
      </AntdForm>
    )
  }
  return render(<Harness />)
}

describe('SchemaFields — Advanced/required partition (FRM1)', () => {
  it('renders REQUIRED properties up-front, OUTSIDE the Advanced collapse', () => {
    const { container, getByText } = renderInForm()
    const collapse = container.querySelector('.ant-collapse')
    expect(collapse).toBeTruthy()
    // Required labels are present…
    expect(getByText('Name')).toBeTruthy()
    expect(getByText('Instance size')).toBeTruthy()
    // …and NOT contained within the Advanced collapse.
    expect(collapse?.contains(getByText('Name'))).toBe(false)
    expect(collapse?.contains(getByText('Instance size'))).toBe(false)
  })

  it('collects the OPTIONAL properties into the Advanced collapse with a correct count', () => {
    const { container, getByText } = renderInForm()
    const collapse = container.querySelector('.ant-collapse')
    // 3 optional props (replicas, region, debug) — internalToken is hidden, not counted.
    const header = collapse?.querySelector('.ant-collapse-header') as HTMLElement
    expect(header.textContent).toContain('Advanced · 3 settings')
    // Every optional label lives inside the collapse.
    expect(collapse?.contains(getByText('Replica count'))).toBe(true)
    expect(collapse?.contains(getByText('Region'))).toBe(true)
    expect(collapse?.contains(getByText('Debug flag'))).toBe(true)
  })

  it('is COLLAPSED by default — the Advanced panel content is not expanded', () => {
    const { container } = renderInForm()
    // No active/expanded panel item on first render.
    expect(container.querySelector('.ant-collapse-item-active')).toBeNull()
  })

  it('HIDES a hidden property from BOTH partitions', () => {
    const { queryByText } = renderInForm()
    expect(queryByText('Internal token')).toBeNull()
  })

  it('singularizes the count label for exactly one optional field', () => {
    const oneOptional: JSONSchema4 = {
      properties: {
        name: { title: 'Name', type: 'string' },
        note: { title: 'Note', type: 'string' },
      },
      required: ['name'],
      type: 'object',
    }
    const { container } = render(
      <AntdForm>
        <SchemaFields schema={oneOptional} />
      </AntdForm>,
    )
    const header = container.querySelector('.ant-collapse-header') as HTMLElement
    expect(header.textContent).toContain('Advanced · 1 setting')
    expect(header.textContent).not.toContain('settings')
  })

  it('renders NO Advanced collapse when every property is required', () => {
    const allRequired: JSONSchema4 = {
      properties: { name: { title: 'Name', type: 'string' } },
      required: ['name'],
      type: 'object',
    }
    const { container, getByText } = render(
      <AntdForm>
        <SchemaFields schema={allRequired} />
      </AntdForm>,
    )
    expect(getByText('Name')).toBeTruthy()
    expect(container.querySelector('.ant-collapse')).toBeNull()
  })

  it('a COLLAPSED optional field still SUBMITS its value (disclosure, not hiding)', async () => {
    const onFinish = vi.fn()
    const { container, getByText } = renderInForm(onFinish)
    // The collapse is closed — the optional "Region" field is mounted (forceRender) but hidden.
    expect(container.querySelector('.ant-collapse-item-active')).toBeNull()

    // Fill the required fields (so validation passes) and a COLLAPSED optional field.
    const nameInput = document.getElementById('name') as HTMLInputElement
    const sizeInput = document.getElementById('size') as HTMLInputElement
    const regionInput = document.getElementById('region') as HTMLInputElement
    // mounted despite being collapsed (forceRender)
    expect(regionInput).toBeTruthy()
    fireEvent.change(nameInput, { target: { value: 'demo' } })
    fireEvent.change(sizeInput, { target: { value: 'large' } })
    fireEvent.change(regionInput, { target: { value: 'eu-west' } })

    fireEvent.click(getByText('submit'))

    await vi.waitFor(() => {
      expect(onFinish).toHaveBeenCalledTimes(1)
    })
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ name: 'demo', region: 'eu-west', size: 'large' }))
  })
})

/**
 * REPEATABLE ROWS — an array of declared objects, and a map with a typed value.
 *
 * Both used to fall through to the JSON textarea, which in a form reads as an empty box with no
 * hint of the fields inside: a Table's `columns` in the composer's create form, a list of objects
 * in any blueprint form. The item schema is right there, so each item is a row of its own fields.
 */
describe('SchemaFields — rows for lists of objects and typed maps', () => {
  const ROWS: JSONSchema4 = {
    properties: {
      columns: {
        items: {
          properties: { title: { type: 'string' }, valueKey: { type: 'string' } },
          required: ['title', 'valueKey'],
          type: 'object',
        },
        type: 'array',
      },
      labels: { additionalProperties: { type: 'string' }, type: 'object' },
      records: { items: { type: 'object', 'x-kubernetes-preserve-unknown-fields': true }, type: 'array' },
    },
    required: ['columns', 'labels', 'records'],
    type: 'object',
  }

  const mount = (onFinish = vi.fn()) => {
    render(
      <AntdForm onFinish={onFinish}>
        <SchemaFields schema={ROWS} />
        <button type='submit'>submit</button>
      </AntdForm>,
    )
    return onFinish
  }

  it('submits the rows as an array of objects and the map as an object', async () => {
    const onFinish = mount()
    fireEvent.click(screen.getByText('Add columns'))
    fireEvent.change(document.getElementById('columns_0_title') as Element, { target: { value: 'Pod' } })
    fireEvent.change(document.getElementById('columns_0_valueKey') as Element, { target: { value: 'pod' } })
    fireEvent.click(screen.getByText('Add entry'))
    fireEvent.change(screen.getByLabelText('key 1'), { target: { value: 'team' } })
    fireEvent.change(screen.getByLabelText('value 1'), { target: { value: 'platform' } })
    fireEvent.change(screen.getByPlaceholderText('{ } — JSON (key/value map)'), { target: { value: '[{"a":1}]' } })
    fireEvent.click(screen.getByText('submit'))

    await vi.waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1))
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({
      columns: [{ title: 'Pod', valueKey: 'pod' }],
      labels: { team: 'platform' },
      records: [{ a: 1 }],
    }))
  })

  it('a row keeps its item schema\'s required fields — a blank valueKey does not submit', async () => {
    const onFinish = mount()
    fireEvent.click(screen.getByText('Add columns'))
    fireEvent.change(document.getElementById('columns_0_title') as Element, { target: { value: 'Pod' } })
    fireEvent.click(screen.getByText('submit'))
    await vi.waitFor(() => expect(document.body.textContent).toContain('valueKey is required'))
    expect(onFinish).not.toHaveBeenCalled()
  })

  it('a required list with no rows says so', async () => {
    mount()
    fireEvent.click(screen.getByText('submit'))
    await vi.waitFor(() => expect(document.body.textContent).toContain('columns is required'))
  })
})

describe('SchemaFields — secret fields render as a password control', () => {
  /* eslint-disable sort-keys/sort-keys-fix */
  const SECRET_SCHEMA: JSONSchema4 = {
    properties: {
      username: { title: 'Username', type: 'string' },
      password: { format: 'password', title: 'Password', type: 'string' },
      apiKey: { title: 'API key', type: 'string', writeOnly: true },
      // a secret wins over enum: its value is never offered back
      pin: { enum: ['1234'], format: 'password', title: 'PIN', type: 'string' },
    },
    required: ['username', 'password', 'apiKey', 'pin'],
    type: 'object',
  }
  /* eslint-enable sort-keys/sort-keys-fix */

  const inputFor = (container: HTMLElement, id: string) => container.querySelector<HTMLInputElement>(`input#${id}`)

  it('format: password and writeOnly: true both render antd Input.Password (masked)', () => {
    const { container } = render(<AntdForm><SchemaFields schema={SECRET_SCHEMA} /></AntdForm>)
    for (const id of ['password', 'apiKey', 'pin']) {
      const input = inputFor(container, id)
      expect(input?.type).toBe('password')
      expect(input?.getAttribute('autocomplete')).toBe('new-password')
      expect(input?.closest('.ant-input-password')).toBeTruthy()
    }
    // a plain string is still a plain text input
    expect(inputFor(container, 'username')?.type).toBe('text')
    // the enum on a secret did not become a Select
    expect(container.querySelector('.ant-select')).toBeNull()
  })

  it('a list, a map and a nullable string of secrets are masked too — never a tags Select or JSON box', () => {
    const { container, getAllByText } = render(
      <AntdForm initialValues={{ creds: { admin: 'map-secret' }, tokens: ['list-secret'] }}>
        <SchemaFields
          schema={{
            properties: {
              creds: { additionalProperties: { format: 'password', type: 'string' }, title: 'Creds', type: 'object' },
              maybe: { format: 'password', title: 'Maybe', type: ['string', 'null'] },
              tokens: { items: { format: 'password', type: 'string' }, title: 'Tokens', type: 'array' },
            },
            required: ['creds', 'maybe', 'tokens'],
            type: 'object',
          }}
        />
      </AntdForm>,
    )
    expect(container.querySelector('.ant-select')).toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
    expect(inputFor(container, 'maybe')?.type).toBe('password')
    const masked = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="password"]')).map((input) => input.value)
    expect(masked).toEqual(expect.arrayContaining(['map-secret', 'list-secret']))
    expect(container.textContent).not.toContain('list-secret')
    expect(getAllByText('Add entry')).toHaveLength(2)
  })

  it('still submits the typed value under the same name', async () => {
    const onFinish = vi.fn()
    const { container, getByText } = render(
      <AntdForm onFinish={onFinish}>
        <SchemaFields schema={{ properties: { password: { format: 'password', type: 'string' } }, type: 'object' }} />
        <button type='submit'>submit</button>
      </AntdForm>,
    )
    fireEvent.change(inputFor(container, 'password')!, { target: { value: 'hunter2' } })
    fireEvent.click(getByText('submit'))
    await vi.waitFor(() => { expect(onFinish).toHaveBeenCalledWith({ password: 'hunter2' }) })
  })
})
