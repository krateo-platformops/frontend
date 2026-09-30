// @vitest-environment jsdom
/**
 * The Form with a secret field — `format: password` or `writeOnly: true` on a TOP-LEVEL property —
 * whether the schema arrives as `schema` (object) or `stringSchema` (JSON string). Both keys are
 * honoured on both paths: the control is masked, nothing prefills it, a saved draft never holds
 * it, the review step masks it, and the submit hands its path to the action as a secret.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

const SCHEMA = {
  properties: {
    apiKey: { default: 'default-key', title: 'API key', type: 'string', writeOnly: true },
    password: { default: 'default-pw', format: 'password', title: 'Password', type: 'string' },
    username: { title: 'Username', type: 'string' },
  },
  required: ['username', 'password', 'apiKey'],
  type: 'object',
}

const widgetData = (variant: 'schema' | 'stringSchema', extra: Partial<FormWidgetData> = {}): FormWidgetData => ({
  actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] },
  draftActionId: 'draft',
  // everything a page could seed a secret from: initialValues (and the refetch path, which
  // re-seeds the same effective initial values), the saved-draft key, the schema default
  initialValues: { __owner: 'me__ns__form', apiKey: 'seeded-key', password: 'seeded-pw', username: 'seeded-user' },
  submitActionId: 'submit',
  ...(variant === 'schema' ? { schema: SCHEMA } : { stringSchema: JSON.stringify(SCHEMA) }),
  ...extra,
})

const renderForm = (data: FormWidgetData) =>
  render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={data} />)

const input = (container: HTMLElement, id: string) => container.querySelector(`input#${id}`) as HTMLInputElement

describe.each(['schema', 'stringSchema'] as const)('Form secret fields — via %s', (variant) => {
  it('renders format: password AND writeOnly: true as masked inputs', () => {
    const { container } = renderForm(widgetData(variant))
    expect(input(container, 'password').type).toBe('password')
    expect(input(container, 'apiKey').type).toBe('password')
    expect(input(container, 'username').type).toBe('text')
  })

  it('prefills neither from initialValues, the schema default, a saved draft nor an Autopilot draft', () => {
    localStorage.setItem('K_draft__me__ns__form', JSON.stringify({ apiKey: 'draft-key', password: 'draft-pw' }))
    agentDraft = { apiKey: 'agent-key', password: 'agent-pw', username: 'agent-user' }
    const { container } = renderForm(widgetData(variant))
    expect(input(container, 'password').value).toBe('')
    expect(input(container, 'apiKey').value).toBe('')
    // a non-secret field still prefills as before
    expect(input(container, 'username').value).toBe('agent-user')
  })

  it('never writes a secret into a saved draft', () => {
    const { container } = renderForm(widgetData(variant))
    fireEvent.change(input(container, 'password'), { target: { value: 'typed-pw' } })
    fireEvent.change(input(container, 'apiKey'), { target: { value: 'typed-key' } })
    fireEvent.click(screen.getByText('Save draft'))
    const saved = localStorage.getItem('K_draft__me__ns__form') ?? ''
    expect(saved).toContain('seeded-user')
    expect(saved).not.toContain('typed-pw')
    expect(saved).not.toContain('typed-key')
  })

  it('submits the typed values, naming both fields as secret to the action', async () => {
    const { container } = renderForm(widgetData(variant))
    fireEvent.change(input(container, 'password'), { target: { value: 'typed-pw' } })
    fireEvent.change(input(container, 'apiKey'), { target: { value: 'typed-key' } })
    fireEvent.click(screen.getByText('Submit'))
    await vi.waitFor(() => { expect(handleAction).toHaveBeenCalledTimes(1) })
    const [[, , values, , , , secretPaths]] = handleAction.mock.calls
    expect(values).toMatchObject({ apiKey: 'typed-key', password: 'typed-pw' })
    expect(secretPaths).toEqual([['apiKey'], ['password']])
  })

  it('the review step masks both', async () => {
    const { container } = renderForm(widgetData(variant, { reviewBeforeSubmit: true }))
    fireEvent.change(input(container, 'password'), { target: { value: 'typed-pw' } })
    fireEvent.change(input(container, 'apiKey'), { target: { value: 'typed-key' } })
    fireEvent.click(screen.getByText('Review →'))
    await vi.waitFor(() => { expect(screen.getAllByText('••••••')).toHaveLength(2) })
    const review = container.querySelector('.ant-descriptions')?.textContent ?? ''
    expect(review).not.toContain('typed-pw')
    expect(review).not.toContain('typed-key')
  })
})
