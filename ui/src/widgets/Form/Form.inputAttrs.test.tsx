// @vitest-environment jsdom
/**
 * `fieldInputs` `spellCheck` and `autoCapitalize` — a username the browser must not spell-check or
 * capitalise. Both apply to a text Input and a TextArea; an `autoCapitalize` outside the closed
 * list is ignored. Without them, neither attribute is set (Form.inputAttrsUnchanged).
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

const renderForm = (fieldInputs: FormWidgetData['fieldInputs']) => render(
  <Form
    resourcesRefs={{ items: [] }}
    uid='u'
    widgetData={{
      actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] },
      fieldInputs,
      schema: { properties: { about: { title: 'About', type: 'string' }, username: { title: 'Username', type: 'string' } }, type: 'object' },
      submitActionId: 'submit',
      textareas: [{ name: 'about' }],
    }}
  />,
).container

describe('fieldInputs spellCheck and autoCapitalize', () => {
  it('a username Input: spellcheck="false", autocapitalize="none"', () => {
    const container = renderForm([{ autoCapitalize: 'none', autoComplete: 'username', name: 'username', spellCheck: false }])
    const input = container.querySelector('input#username') as HTMLInputElement
    expect([input.getAttribute('spellcheck'), input.getAttribute('autocapitalize'), input.getAttribute('autocomplete')]).toEqual(['false', 'none', 'username'])
  })

  it('a TextArea takes both too', () => {
    const container = renderForm([{ autoCapitalize: 'sentences', name: 'about', spellCheck: true }])
    const area = container.querySelector('textarea') as HTMLTextAreaElement
    expect([area.getAttribute('spellcheck'), area.getAttribute('autocapitalize')]).toEqual(['true', 'sentences'])
  })

  it('an autoCapitalize outside the list is ignored; spellCheck beside it applies', () => {
    const container = renderForm([{ autoCapitalize: 'off' as never, name: 'username', spellCheck: false }])
    const input = container.querySelector('input#username') as HTMLInputElement
    expect([input.getAttribute('spellcheck'), input.hasAttribute('autocapitalize')]).toEqual(['false', false])
  })
})
