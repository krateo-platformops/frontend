// @vitest-environment jsdom
/**
 * What the input and notice options must leave alone. RECORDED ON MAIN, before `noticeVariant`,
 * `fieldInputs`, `hasFeedback: none` and the brand frame existed: the commit that adds them has to
 * keep every assertion and snapshot here, with Form.unchanged, Form.submitUnchanged and
 * Form.presentationUnchanged.
 *
 * - `notice` is an info Alert above the fields;
 * - a required field has antd's feedback icons, an optional one has none;
 * - a string field is a plain text Input with no placeholder and no autocomplete attribute;
 * - an enum field's Select says "Select…";
 * - the <form> leaves the browser's own constraint validation as it is (no `novalidate`);
 * - a `title` is followed directly by the form: nothing under the heading.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
afterEach(() => {
  cleanup()
  localStorage.clear()
})

const ACTIONS = { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' as const }] }

/* eslint-disable sort-keys/sort-keys-fix -- the property order is the field order */
const STRING_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['email', 'country', 'useCase'],
  properties: {
    email: { type: 'string', title: 'Email' },
    country: { type: 'string', title: 'Country', enum: ['IT', 'FR'] },
    useCase: { type: 'string', title: 'Use case' },
    phone: { type: 'string', title: 'Phone', pattern: '^\\+' },
  },
})
/* eslint-enable sort-keys/sort-keys-fix */

const base = (extra: Partial<FormWidgetData> = {}): FormWidgetData => ({ actions: ACTIONS, requiredMark: 'optional', stringSchema: STRING_SCHEMA, submitActionId: 'submit', ...extra })

const stable = (html: string): string => {
  const seen = new Map<string, string>()
  return html.replace(/«[^»]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_|rc_select_[0-9]+|rc-tabs-[0-9]+/g, (id) => {
    if (!seen.has(id)) { seen.set(id, `ID${seen.size}`) }
    return seen.get(id) as string
  })
}

const renderForm = (widgetData: FormWidgetData) => render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData} />)

const itemOf = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('.ant-form-item')].find((each) => each.querySelector('label')?.textContent?.startsWith(label)) as HTMLElement

describe('the inputs and notice a CR without the new options keeps', () => {
  it('a notice is an info Alert above the fields', () => {
    const { container } = renderForm(base({ notice: 'Choose carefully.' }))
    const alert = container.querySelector('.ant-alert') as HTMLElement
    expect(alert.classList.contains('ant-alert-info')).toBe(true)
    expect(alert.textContent).toBe('Choose carefully.')
    expect(alert.compareDocumentPosition(itemOf(container, 'Email')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(stable(alert.outerHTML)).toMatchSnapshot()
  })

  it('a required field has the feedback icons; an optional one has none', async () => {
    const { container } = renderForm(base())
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => {
      expect(itemOf(container, 'Email').querySelector('.ant-form-item-feedback-icon-error')).not.toBeNull()
    }, { timeout: 30_000 })
    expect(itemOf(container, 'Use case').querySelector('.ant-form-item-feedback-icon-error')).not.toBeNull()
    expect(itemOf(container, 'Phone').querySelector('.ant-form-item-feedback-icon')).toBeNull()
  }, 60_000)

  it('a string field is a plain text Input: no placeholder, no autocomplete', () => {
    const { container } = renderForm(base())
    for (const label of ['Email', 'Use case', 'Phone']) {
      const input = itemOf(container, label).querySelector('input') as HTMLInputElement
      expect(input.getAttribute('type')).toBe('text')
      expect(input.hasAttribute('placeholder')).toBe(false)
      expect(input.hasAttribute('autocomplete')).toBe(false)
    }
    expect(stable(itemOf(container, 'Email').querySelector('.ant-form-item-control-input')?.outerHTML ?? '')).toMatchSnapshot()
  })

  it('an enum field says "Select…"', () => {
    const { container } = renderForm(base())
    expect(itemOf(container, 'Country').querySelector('.ant-select-placeholder')?.textContent).toBe('Select…')
  })

  it('the form leaves the browser\'s constraint validation alone', () => {
    const { container } = renderForm(base())
    expect(container.querySelector('form')?.hasAttribute('novalidate')).toBe(false)
  })

  it('a title is followed directly by the form', () => {
    const { container } = renderForm(base({ notice: 'Choose carefully.', title: 'Request access' }))
    const heading = screen.getByRole('heading', { level: 3, name: 'Request access' })
    expect(heading.nextElementSibling?.querySelector('form')).not.toBeNull()
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })
})
