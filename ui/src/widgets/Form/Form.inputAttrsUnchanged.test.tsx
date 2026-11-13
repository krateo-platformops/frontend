// @vitest-environment jsdom
/**
 * The attributes a `fieldInputs` entry leaves alone. RECORDED ON THIS BRANCH (fieldInputs is new in
 * it) before `spellCheck` and `autoCapitalize` were added: an entry without them sets neither on a
 * text Input or a TextArea, so the browser's defaults stay. Must hold after.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import Form, { type FormWidgetData } from './Form'

vi.mock('../../hooks/useHandleActions', () => ({ useHandleAction: () => ({ handleAction: () => Promise.resolve(), isActionLoading: false }) }))
vi.mock('antd/es/app/useApp', () => ({ default: () => ({ message: {}, modal: {}, notification: { error: () => undefined, success: () => undefined } }) }))
vi.mock('../../components/Agentiko/agentDraft', () => ({ useAgentDraft: () => ({ draft: null, nonce: 1 }) }))
vi.mock('../Drawer/DrawerContext', () => ({ useDrawerContext: () => ({ insideDrawer: false, setDrawerData: () => undefined }) }))
vi.mock('react-router', () => ({ useNavigate: () => () => undefined }))

beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
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
  fieldInputs: [{ autoComplete: 'username', name: 'username', placeholder: 'jane-doe' }, { name: 'about', placeholder: 'A sentence' }],
  schema: { properties: { about: { title: 'About', type: 'string' }, username: { title: 'Username', type: 'string' } }, type: 'object' },
  submitActionId: 'submit',
  textareas: [{ name: 'about' }],
}

describe('a fieldInputs entry without spellCheck or autoCapitalize', () => {
  it('sets neither on a text Input or a TextArea', () => {
    const { container } = render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData} />)
    const input = container.querySelector('input#username') as HTMLInputElement
    const area = container.querySelector('textarea') as HTMLTextAreaElement
    for (const control of [input, area]) {
      expect(control.hasAttribute('spellcheck')).toBe(false)
      expect(control.hasAttribute('autocapitalize')).toBe(false)
    }
    expect(input.placeholder).toBe('jane-doe')
  })
})
