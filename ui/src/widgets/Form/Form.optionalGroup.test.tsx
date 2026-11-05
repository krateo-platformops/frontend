// @vitest-environment jsdom
/**
 * A required field of an OPTIONAL object. JSON Schema's `required` binds only where the object
 * exists, so a person who leaves the object alone owes it nothing. The Alert form shows the cost of
 * getting this wrong: `metricRef.name` was demanded of every log alert, and filling it in made the
 * alert invalid, because the CRD forbids `metricRef` beside a non-empty `where`.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { pruneEmptyObjects } from '../../utils/pruneEmptyObjects'

import Form, { type FormWidgetData } from './Form'

const handleAction = vi.fn((..._args: unknown[]) => Promise.resolve())

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction, isActionLoading: false }),
}))
vi.mock('../../components/Autopilot/agentDraft', () => ({
  useAgentDraft: () => ({ draft: null, nonce: 1 }),
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
beforeEach(() => { handleAction.mockClear() })
afterEach(cleanup)

const renderForm = (schema: Record<string, unknown>, initialValues?: Record<string, unknown>) => {
  const { container } = render(
    <Form
      resourcesRefs={{ items: [] }}
      uid='form'
      widgetData={{
        actions: { rest: [{ id: 'submit', resourceRefId: 'r', type: 'rest' }] },
        buttonConfig: { primary: { label: 'Save' } },
        initialValues,
        schema,
        submitActionId: 'submit',
      } as unknown as FormWidgetData}
    />,
  )
  return container
}

const submit = () => { fireEvent.click(screen.getByRole('button', { name: /Save/ })) }
const submitted = () => handleAction.mock.calls[0]?.[2] as Record<string, unknown> | undefined

// The real shape of an Alert's spec: `metricRef` is optional and its `name` is required.
const alert = {
  properties: {
    interval: { type: 'string' },
    metricRef: { properties: { name: { minLength: 1, type: 'string' } }, required: ['name'], type: 'object' },
    where: { type: 'string' },
  },
  required: ['interval'],
  type: 'object',
}

const group = {
  properties: {
    interval: { type: 'string' },
    source: {
      properties: { name: { type: 'string' }, region: { type: 'string' } },
      required: ['name'],
      type: 'object',
    },
  },
  required: ['interval'],
  type: 'object',
}

describe('a required field of an optional object', () => {
  it('owes nothing while the object is left alone', async () => {
    renderForm(alert, { interval: '5m' })
    submit()
    await waitFor(() => { expect(handleAction).toHaveBeenCalledTimes(1) })
    expect(screen.queryByText('name is required')).toBeNull()
  })

  it('is required once anything else in the object is filled', async () => {
    renderForm(group, { interval: '5m', source: { region: 'eu' } })
    submit()
    await screen.findByText('name is required')
    expect(handleAction).not.toHaveBeenCalled()
  })

  it('stays satisfied when it is filled', async () => {
    renderForm(group, { interval: '5m', source: { name: 'a', region: 'eu' } })
    submit()
    await waitFor(() => { expect(handleAction).toHaveBeenCalledTimes(1) })
    expect(submitted()?.source).toEqual({ name: 'a', region: 'eu' })
  })

  it('stays unconditional under a REQUIRED object', async () => {
    renderForm({ ...alert, required: ['interval', 'metricRef'] }, { interval: '5m' })
    submit()
    await screen.findByText('name is required')
    expect(handleAction).not.toHaveBeenCalled()
  })

  it('binds through a required object nested in an optional one', async () => {
    const nested = {
      properties: {
        interval: { type: 'string' },
        outer: {
          properties: {
            inner: { properties: { name: { type: 'string' } }, required: ['name'], type: 'object' },
            note: { type: 'string' },
          },
          required: ['inner'],
          type: 'object',
        },
      },
      required: ['interval'],
      type: 'object',
    }
    renderForm(nested, { interval: '5m' })
    submit()
    await waitFor(() => { expect(handleAction).toHaveBeenCalledTimes(1) })
    cleanup()
    handleAction.mockClear()
    renderForm(nested, { interval: '5m', outer: { note: 'x' } })
    submit()
    await screen.findByText('name is required')
    expect(handleAction).not.toHaveBeenCalled()
  })

  it('gives a required object-list the same rule', async () => {
    const withList = {
      properties: {
        interval: { type: 'string' },
        source: {
          properties: {
            hosts: { items: { properties: { host: { type: 'string' } }, type: 'object' }, title: 'Hosts', type: 'array' },
            region: { type: 'string' },
          },
          required: ['hosts'],
          type: 'object',
        },
      },
      required: ['interval'],
      type: 'object',
    }
    renderForm(withList, { interval: '5m' })
    submit()
    await waitFor(() => { expect(handleAction).toHaveBeenCalledTimes(1) })
    cleanup()
    handleAction.mockClear()
    renderForm(withList, { interval: '5m', source: { region: 'eu' } })
    submit()
    await waitFor(() => { expect(document.body.textContent).toMatch(/Hosts/) })
    await waitFor(() => { expect(document.querySelector('.ant-form-item-explain-error')).not.toBeNull() })
    expect(handleAction).not.toHaveBeenCalled()
  })
})

describe('a failed submit shows where it failed', () => {
  it('opens the section holding the error', async () => {
    const container = renderForm(group, { interval: '5m', source: { region: 'eu' } })
    const sourceSection = () => screen.getByText('name is required').closest<HTMLElement>('[style]')
    submit()
    await screen.findByText('name is required')
    await waitFor(() => { expect(sourceSection()?.style.display).not.toBe('none') })
    expect(container.querySelector('nav button[class*="secActive"]')?.textContent).toBe('source')
  })

  it('opens Advanced when the error is inside it', async () => {
    const nested = {
      properties: {
        name: { type: 'string' },
        // A group of its own with a required field and an optional one, so "Advanced" is rendered.
        only: {
          properties: { key: { type: 'string' }, limit: { maximum: 5, type: 'integer' } },
          required: ['key'],
          type: 'object',
        },
      },
      required: ['only'],
      type: 'object',
    }
    const container = renderForm(nested, { name: 'a', only: { key: 'k', limit: 9 } })
    submit()
    await screen.findByText('limit must be at most 5')
    await waitFor(() => {
      expect(container.querySelector('.ant-collapse-item-active')).not.toBeNull()
    })
  })
})

describe('what reaches the API server', () => {
  it('an untouched object is not sent as {}', () => {
    // antd's onFinish hands back the registered key with an undefined value. `{}` would make
    // `has(self.metricRef)` true, which the Alert CRD refuses beside a non-empty `where`.
    const body = JSON.stringify(pruneEmptyObjects({ interval: '5m', metricRef: { name: undefined } }))
    expect(JSON.parse(body)).toEqual({ interval: '5m' })
  })

  it('keeps null, zero, false and an empty string', () => {
    expect(pruneEmptyObjects({ a: null, b: 0, c: false, d: '' })).toEqual({ a: null, b: 0, c: false, d: '' })
  })
})
