// @vitest-environment jsdom
/**
 * The constraints a schema states — `pattern`, string length, number bounds, item counts — are
 * checked in the form, beside the field, instead of first surfacing as an API-server rejection
 * after the confirm step. Messages name the field by its `title`, never by the raw key. A node
 * with no `type` that holds an object (an open `extras` map) is edited as JSON, so it submits an
 * object rather than the string the user typed.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Form as AntdForm } from 'antd'
import type { JSONSchema4 } from 'json-schema'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { SchemaFields } from './SchemaFields'
import { rulesFor } from './schemaRules'

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

/** Runs every rule `rulesFor` returns against a value; resolves to the first message, or null. */
const firstError = async (node: JSONSchema4, value: unknown, isRequired = false): Promise<string | null> => {
  const validators = (rulesFor('key', node, isRequired) ?? [])
    .flatMap((rule) => (typeof rule !== 'function' && 'validator' in rule && rule.validator ? [rule.validator] : []))
  const results = await Promise.allSettled(validators.map(async (validate) => { await validate({}, value, () => undefined) }))
  const failed = results.find((result) => result.status === 'rejected')
  return failed ? (failed.reason as Error).message : null
}

describe('rulesFor', () => {
  it('names the field by its title in the required message', () => {
    const rules = rulesFor('__composition_name__', { title: 'Name', type: 'string' }, true)
    expect(rules?.[0]).toMatchObject({ message: 'Name is required', required: true })
  })

  it('falls back to the key when there is no title', () => {
    expect(rulesFor('secretName', { type: 'string' }, true)?.[0]).toMatchObject({ message: 'secretName is required' })
  })

  it('returns no rules for an unconstrained optional field', () => {
    expect(rulesFor('free', { type: 'string' }, false)).toBeUndefined()
  })

  it('checks pattern, minLength and maxLength on strings', async () => {
    const node: JSONSchema4 = { maxLength: 5, minLength: 2, pattern: '^[a-z]+$', title: 'Repo', type: 'string' }
    expect(await firstError(node, 'Abc')).toBe('Repo must match ^[a-z]+$')
    expect(await firstError(node, 'a')).toBe('Repo must be at least 2 characters')
    expect(await firstError(node, 'abcdef')).toBe('Repo must be at most 5 characters')
    expect(await firstError(node, 'abc')).toBeNull()
  })

  it('leaves an empty optional value alone', async () => {
    expect(await firstError({ minLength: 2, pattern: '^x$', type: 'string' }, '')).toBeNull()
    expect(await firstError({ minimum: 1, type: 'integer' }, undefined)).toBeNull()
  })

  it('skips a pattern the browser cannot compile instead of blocking the form', async () => {
    expect(await firstError({ pattern: '(?<', type: 'string' }, 'anything')).toBeNull()
  })

  it('checks number bounds, both draft-04 and draft-06 exclusive forms', async () => {
    expect(await firstError({ minimum: 1, title: 'Workers', type: 'integer' }, -5)).toBe('Workers must be at least 1')
    expect(await firstError({ maximum: 10, type: 'number' }, 11)).toBe('key must be at most 10')
    expect(await firstError({ exclusiveMinimum: 0, type: 'number' } as unknown as JSONSchema4, 0)).toBe('key must be greater than 0')
    expect(await firstError({ exclusiveMaximum: true, maximum: 5, type: 'number' }, 5)).toBe('key must be less than 5')
    expect(await firstError({ type: 'integer' }, 1.5)).toBe('key must be a whole number')
    expect(await firstError({ maximum: 10, minimum: 1, type: 'integer' }, 3)).toBeNull()
  })

  it('checks minItems and maxItems on arrays', async () => {
    const node: JSONSchema4 = { items: { type: 'string' }, maxItems: 2, minItems: 2, title: 'Zones', type: 'array' }
    expect(await firstError(node, ['a'])).toBe('Zones needs at least 2 entries')
    expect(await firstError(node, ['a', 'b', 'c'])).toBe('Zones allows at most 2 entries')
    expect(await firstError(node, ['a', 'b'])).toBeNull()
  })
})

/* eslint-disable sort-keys/sort-keys-fix */
const SCHEMA: JSONSchema4 = {
  properties: {
    name: { pattern: '^[a-z0-9-]+$', title: 'Name', type: 'string' },
    workers: { minimum: 1, title: 'Workers', type: 'integer' },
    extras: { 'x-kubernetes-preserve-unknown-fields': true },
  },
  required: ['name'],
  type: 'object',
}
/* eslint-enable sort-keys/sort-keys-fix */

const renderInForm = (onFinish: (values: Record<string, unknown>) => void) => {
  const Harness = () => {
    const [form] = AntdForm.useForm()
    return (
      <AntdForm form={form} onFinish={(values) => { onFinish(values as Record<string, unknown>) }}>
        <SchemaFields schema={SCHEMA} />
        <button type='submit'>submit</button>
      </AntdForm>
    )
  }
  return render(<Harness />)
}

describe('SchemaFields — schema constraints in the form', () => {
  it('blocks the submit and shows the titled message beside the field', async () => {
    const onFinish = vi.fn()
    const { container } = renderInForm(onFinish)
    fireEvent.change(container.querySelector('input#name') as HTMLInputElement, { target: { value: 'Not Valid' } })
    fireEvent.click(screen.getByText('submit'))
    expect(await screen.findByText('Name must match ^[a-z0-9-]+$')).toBeTruthy()
    expect(onFinish).not.toHaveBeenCalled()
  })

  it('says "Name is required", not the raw key', async () => {
    renderInForm(vi.fn())
    fireEvent.click(screen.getByText('submit'))
    expect(await screen.findByText('Name is required')).toBeTruthy()
  })

  it('edits a typeless preserve-unknown node as JSON and submits an object', async () => {
    const onFinish = vi.fn()
    const { container } = renderInForm(onFinish)
    fireEvent.change(container.querySelector('input#name') as HTMLInputElement, { target: { value: 'ok' } })
    const extras = container.querySelector('textarea#extras') as HTMLTextAreaElement
    expect(extras).toBeTruthy()
    fireEvent.change(extras, { target: { value: '{"tier":"gold"}' } })
    fireEvent.click(screen.getByText('submit'))
    await waitFor(() => { expect(onFinish).toHaveBeenCalled() })
    expect(onFinish.mock.calls[0][0]).toMatchObject({ extras: { tier: 'gold' }, name: 'ok' })
  })
})
