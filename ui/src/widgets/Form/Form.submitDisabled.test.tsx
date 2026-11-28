// @vitest-environment jsdom
/**
 * `widgetData.notice`: what the schema's source could not carry, said above the fields — the
 * blueprint formdef sets it when it falls back to the CRD, which loses the authoring order of the
 * fields, so the form no longer degrades silently.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import Form, { type FormWidgetData } from './Form'

const handleAction = vi.fn((..._args: unknown[]) => Promise.resolve())
let agentDraft: Record<string, unknown> | null = null

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction, isActionLoading: false }),
}))
vi.mock('../../components/Agentiko/agentDraft', () => ({
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

const widgetData = (extra: Partial<FormWidgetData> = {}): FormWidgetData => ({
  actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] },
  buttonConfig: { secondary: { label: 'Cancel' } },
  schema: { properties: { name: { title: 'Name', type: 'string' } }, type: 'object' },
  submitActionId: 'submit',
  ...extra,
})

const submitButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Submit' })

/**
 * `widgetData.submitDisabled`: the primary button only; `disabled` already covers the fields, and
 * the form's notice says why the form cannot be submitted.
 */
describe('Form — submitDisabled', () => {
  it('true: the submit button is disabled, clicking does nothing, fields and Cancel stay usable', () => {
    render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData({ notice: 'No namespace.', submitDisabled: true })} />)
    expect(submitButton().disabled).toBe(true)
    fireEvent.click(submitButton())
    expect(handleAction).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Name')).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Cancel' })).disabled).toBe(false)
  })

  it('absent or false: the submit button is enabled and submits', async () => {
    for (const extra of [{}, { submitDisabled: false }]) {
      const { unmount } = render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData(extra)} />)
      expect(submitButton().disabled).toBe(false)
      unmount()
    }
    render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData()} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } })
    fireEvent.click(submitButton())
    await waitFor(() => { expect(handleAction).toHaveBeenCalled() })
  })
})
