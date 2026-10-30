// @vitest-environment jsdom
/**
 * `notice` on the schema root: what the schema's source could not carry, said above the
 * fields — the blueprint formdef sets it when it falls back to the CRD, which loses field order and
 * every form key, so the form no longer degrades silently.
 */
import { cleanup, render, screen } from '@testing-library/react'
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

const widgetData = (schema: Record<string, unknown>): FormWidgetData => ({
  actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] },
  schema,
  submitActionId: 'submit',
})

const FIELDS = { properties: { name: { title: 'Name', type: 'string' } }, type: 'object' }

describe('Form — notice', () => {
  it('shows the notice above the fields', () => {
    render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData({ ...FIELDS, notice: 'Built from the CRD.' })} />)
    const notice = screen.getByText('Built from the CRD.')
    const field = screen.getByText('Name')
    expect(notice.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows nothing without one', () => {
    const { container } = render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData(FIELDS)} />)
    expect(container.querySelector('.ant-alert')).toBeNull()
  })
})
