// @vitest-environment jsdom
/**
 * The input and notice options, each opt-in (Form.inputsUnchanged holds what a CR without them keeps):
 *
 * - `noticeVariant: text` — the notice as a muted line, gone when a Result replaces the form;
 * - `fieldInputs` — a field's placeholder, input type and autocomplete token;
 * - `hasFeedback: none` — no feedback icons on any field.
 *
 * A title inside a Card's `brand` frame: Form.brandHeading.test.tsx.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createAnonymousTransport } from '../../public/anonymousTransport'
import { WidgetTransportProvider } from '../../transport/widgetTransport'

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
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

/* eslint-disable sort-keys/sort-keys-fix -- the property order is the field order */
const STRING_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['email', 'country'],
  properties: {
    email: { type: 'string', title: 'Email' },
    country: { type: 'string', title: 'Country', enum: ['IT', 'FR'] },
    region: { type: 'string', title: 'Region', oneOf: [{ const: 'eu', title: 'Europe' }, { const: 'us', title: 'Americas' }] },
    phone: { type: 'string', title: 'Phone' },
    useCase: { type: 'string', title: 'Use case' },
    consent: { type: 'boolean', title: 'Consent' },
    password: { type: 'string', title: 'Password', format: 'password' },
  },
})
/* eslint-enable sort-keys/sort-keys-fix */

const POST = { path: '/intake/requests', responses: [{ result: { status: 'info' as const, title: 'Check your inbox' }, when: { status: [202] } }] }

const base = (extra: Partial<FormWidgetData> = {}): FormWidgetData => ({ requiredMark: 'optional', stringSchema: STRING_SCHEMA, submitPost: POST, ...extra })

const renderForm = (widgetData: FormWidgetData) => render(
  <WidgetTransportProvider value={createAnonymousTransport({ postAllowlist: ['/intake/'] })}>
    <Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData} />
  </WidgetTransportProvider>,
)

const itemOf = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('.ant-form-item')].find((each) => each.querySelector('label')?.textContent?.startsWith(label)) as HTMLElement

const inputOf = (container: HTMLElement, label: string) => itemOf(container, label).querySelector('input, textarea') as HTMLInputElement

/** Fill the required fields and submit, answered 202: the Result replaces the form. */
const submitToResult = async (container: HTMLElement) => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 202 }))))
  fireEvent.change(inputOf(container, 'Email'), { target: { value: 'jane@example.com' } })
  await act(async () => {
    fireEvent.click(screen.getByText('Submit'))
    await Promise.resolve()
  })
  expect(await screen.findByText('Check your inbox', {}, { timeout: 30_000 })).toBeTruthy()
}

describe('noticeVariant: text', () => {
  it('draws the notice as a muted line above the fields, not an Alert', () => {
    const { container } = renderForm(base({ notice: 'Choose carefully.', noticeVariant: 'text' }))
    expect(container.querySelector('.ant-alert')).toBeNull()
    const line = screen.getByText('Choose carefully.')
    expect(line.classList.contains('ant-typography')).toBe(true)
    expect(line.classList.contains('ant-typography-secondary')).toBe(true)
    expect(line.compareDocumentPosition(itemOf(container, 'Email')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('`alert` is the Alert, as when absent; only `text` is the line', () => {
    const { container, unmount } = renderForm(base({ notice: 'Choose carefully.', noticeVariant: 'text' }))
    expect(container.querySelector('.ant-typography-secondary')?.textContent).toBe('Choose carefully.')
    unmount()
    const alert = renderForm(base({ notice: 'Choose carefully.', noticeVariant: 'alert' })).container
    expect(alert.querySelector('.ant-alert-info')?.textContent).toBe('Choose carefully.')
    expect(alert.querySelector('.ant-typography-secondary')).toBeNull()
  })

  it('goes with the form when a Result replaces it', async () => {
    const { container } = renderForm(base({ initialValues: { country: 'IT' }, notice: 'Choose carefully.', noticeVariant: 'text' }))
    expect(container.querySelector('.ant-typography-secondary')?.textContent).toBe('Choose carefully.')
    await submitToResult(container)
    expect(screen.queryByText('Choose carefully.')).toBeNull()
  }, 60_000)
})

describe('fieldInputs', () => {
  const inputs: FormWidgetData['fieldInputs'] = [
    { autoComplete: 'email', name: 'email', placeholder: 'jane@example.com', type: 'email' },
    { autoComplete: 'tel', name: 'phone', placeholder: '+39 …', type: 'tel' },
    { name: 'country', placeholder: 'Search for your country' },
    { name: 'region', placeholder: 'Pick a region' },
  ]

  it('a text Input takes its placeholder, type and autocomplete token', () => {
    const { container } = renderForm(base({ fieldInputs: inputs }))
    const email = inputOf(container, 'Email')
    expect([email.type, email.getAttribute('autocomplete'), email.placeholder]).toEqual(['email', 'email', 'jane@example.com'])
    const phone = inputOf(container, 'Phone')
    expect([phone.type, phone.getAttribute('autocomplete'), phone.placeholder]).toEqual(['tel', 'tel', '+39 …'])
  })

  it('an enum Select and a labelled-options Select take the placeholder in place of "Select…"', () => {
    const { container } = renderForm(base({ fieldInputs: inputs }))
    expect(itemOf(container, 'Country').querySelector('.ant-select-placeholder')?.textContent).toBe('Search for your country')
    expect(itemOf(container, 'Region').querySelector('.ant-select-placeholder')?.textContent).toBe('Pick a region')
  })

  it('a TextArea takes its placeholder and autocomplete token', () => {
    const { container } = renderForm(base({ fieldInputs: [{ autoComplete: 'off', name: 'useCase', placeholder: 'A sentence or two' }], textareas: [{ name: 'useCase' }] }))
    const area = itemOf(container, 'Use case').querySelector('textarea') as HTMLTextAreaElement
    expect([area.getAttribute('autocomplete'), area.placeholder]).toEqual(['off', 'A sentence or two'])
  })

  it('a token outside the list, an unknown type, a boolean and a secret field are ignored; a valid entry beside them applies', () => {
    const { container } = renderForm(base({
      fieldInputs: [
        { autoComplete: 'cc-number' as never, name: 'email', type: 'password' as never },
        { autoComplete: 'tel', name: 'phone' },
        { name: 'consent', placeholder: 'x' },
        { autoComplete: 'username', name: 'password', placeholder: 'x', type: 'text' },
      ],
    }))
    const email = inputOf(container, 'Email')
    expect(email.type).toBe('text')
    expect(email.hasAttribute('autocomplete')).toBe(false)
    expect(itemOf(container, 'Consent').querySelector('[placeholder]')).toBeNull()
    const password = inputOf(container, 'Password')
    expect([password.type, password.getAttribute('autocomplete'), password.hasAttribute('placeholder')]).toEqual(['password', 'new-password', false])
    expect(inputOf(container, 'Phone').getAttribute('autocomplete')).toBe('tel')
  })

  it('with a type, the form turns the browser\'s constraint validation off: the rules report under the field', async () => {
    const { container } = renderForm(base({ fieldInputs: inputs }))
    expect(container.querySelector('form')?.hasAttribute('novalidate')).toBe(true)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => {
      expect(itemOf(container, 'Email').querySelector('.ant-form-item-explain-error')?.textContent).toBe('Email is required')
    }, { timeout: 30_000 })
  }, 60_000)

  it('without a type, the placeholder applies and the form keeps the browser\'s constraint validation', () => {
    const { container } = renderForm(base({ fieldInputs: [{ name: 'email', placeholder: 'jane@example.com' }] }))
    expect(inputOf(container, 'Email').placeholder).toBe('jane@example.com')
    expect(container.querySelector('form')?.hasAttribute('novalidate')).toBe(false)
  })
})

describe('hasFeedback: none', () => {
  it('no feedback icon on a required field; its message still shows', async () => {
    const { container } = renderForm(base({ hasFeedback: 'none' }))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => {
      expect(itemOf(container, 'Email').querySelector('.ant-form-item-explain-error')?.textContent).toBe('Email is required')
    }, { timeout: 30_000 })
    expect(container.querySelector('.ant-form-item-feedback-icon')).toBeNull()
    expect(container.querySelector('.ant-form-item-has-feedback')).toBeNull()
  }, 60_000)

  it('none on a fieldChecks field either: the answer shows as its message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: 'available' }), { status: 200 }))))
    const { container } = renderForm(base({
      fieldChecks: [{
        answers: [{ message: '{value} is available.', validateStatus: 'success', when: { bodyField: 'status', equals: ['available'], status: [200] } }],
        name: 'email',
        path: '/intake/checks',
      }],
      hasFeedback: 'none',
    }))
    const email = inputOf(container, 'Email')
    fireEvent.change(email, { target: { value: 'jane@example.com' } })
    await act(async () => {
      fireEvent.focusOut(email)
      await Promise.resolve()
    })
    expect(await screen.findByText('jane@example.com is available.', {}, { timeout: 30_000 })).toBeTruthy()
    expect(itemOf(container, 'Email').querySelector('.ant-form-item-feedback-icon')).toBeNull()
  }, 60_000)
})
