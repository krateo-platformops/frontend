// @vitest-environment jsdom
/**
 * The Form's action bar. Outside a drawer it holds the form's buttons. Inside a drawer the buttons
 * move to the drawer's header, so the Form draws no action bar at all: an empty one shows as a
 * blank strip under the fields.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import Form, { type FormWidgetData } from './Form'

let insideDrawer = false

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(() => Promise.resolve()), isActionLoading: false }),
}))
vi.mock('../../components/Autopilot/agentDraft', () => ({
  useAgentDraft: () => ({ draft: null, nonce: 1 }),
}))
vi.mock('../Drawer/DrawerContext', () => ({
  useDrawerContext: () => ({ insideDrawer, setDrawerData: vi.fn() }),
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
afterEach(() => { cleanup() })

const widgetData: FormWidgetData = {
  actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] },
  schema: { properties: { feedback: { title: 'What is wrong with the analysis (optional)', type: 'string' } }, type: 'object' },
  submitActionId: 'submit',
}

const actionBar = (container: HTMLElement) => container.querySelector('[class*="extra"]')

describe('Form action bar', () => {
  it('holds the buttons outside a drawer', () => {
    insideDrawer = false
    const { container } = render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData} />)
    expect(actionBar(container)?.querySelector('button')).not.toBeNull()
  })

  it('is not drawn inside a drawer, whose header holds the buttons', () => {
    insideDrawer = true
    const { container } = render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData} />)
    expect(actionBar(container)).toBeNull()
    expect(container.querySelector('input#feedback')).not.toBeNull()
  })
})
