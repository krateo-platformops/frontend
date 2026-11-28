// @vitest-environment jsdom
/**
 * `widgetData.notice`: what the schema's source could not carry, said above the fields — the
 * blueprint formdef sets it when it falls back to the CRD, which loses the authoring order of the
 * fields, so the form no longer degrades silently.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import Form, { type FormWidgetData } from './Form'

let insideDrawer = false
const setDrawerData = vi.fn()
const handleAction = vi.fn((..._args: unknown[]) => Promise.resolve())
let agentDraft: Record<string, unknown> | null = null

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction, isActionLoading: false }),
}))
vi.mock('../../components/Agentiko/agentDraft', () => ({
  useAgentDraft: () => ({ draft: agentDraft, nonce: 1 }),
}))
vi.mock('../Drawer/DrawerContext', () => ({
  useDrawerContext: () => ({ insideDrawer, setDrawerData }),
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
  setDrawerData.mockClear()
  insideDrawer = false
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
    expect(screen.getByLabelText<HTMLInputElement>('Name').disabled).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(false)
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

// Inside a drawer the buttons render in the drawer header: the `extra` the Form hands the drawer
// must carry the same gate as the inline bar. Rendering it stands in for the header.
describe('Form — submitDisabled inside a drawer', () => {
  const lastExtra = (): React.ReactElement => (setDrawerData.mock.calls.at(-1)?.[0] as { extra: React.ReactElement }).extra
  // The header stand-in: the drawer renders the `extra` the Form handed it.
  const headerSubmit = (): HTMLButtonElement | null => {
    const { container, unmount } = render(<>{lastExtra()}</>)
    const button = container.querySelector<HTMLButtonElement>('button[type="submit"]')
    const disabled = button?.disabled
    unmount()
    return button && { disabled } as HTMLButtonElement
  }

  it('submitDisabled: true disables the header submit', () => {
    insideDrawer = true
    render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData({ submitDisabled: true })} />)
    expect(headerSubmit()?.disabled).toBe(true)
  })

  it('absent: the header submit is enabled', () => {
    insideDrawer = true
    render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData()} />)
    expect(headerSubmit()?.disabled).toBe(false)
  })

  it('submitDisabledWhenPristine: disabled while pristine, enabled once a field changes', async () => {
    insideDrawer = true
    render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData({ initialValues: { name: 'a' }, submitDisabledWhenPristine: true })} />)
    expect(headerSubmit()?.disabled).toBe(true)
    cleanup()
    insideDrawer = true
    render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData({ initialValues: { name: 'a' }, submitDisabledWhenPristine: true })} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } })
    await waitFor(() => { expect((lastExtra().props as { submitDisabled: boolean }).submitDisabled).toBe(false) })
    expect(headerSubmit()?.disabled).toBe(false)
  })
})
