// @vitest-environment jsdom
/**
 * What the presentation options must leave alone. RECORDED ON MAIN, before `buttonConfig`'s
 * `secondary.hidden` / `primary.block` / `primary.size`, `textareas`, labelled `oneOf` options,
 * `validationMessages`, `requiredMark: hidden` and `title` existed: the commit that adds them has to
 * keep every assertion and snapshot here, with Form.unchanged and Form.submitUnchanged.
 *
 * - the action bar: Reset + Submit, Save draft on the left, a navigating Cancel;
 * - the default "X is required" message, top level and inside an optional object;
 * - an `enum` field: a Select of the raw values;
 * - a `oneOf` that is not a list of consts (a union of object shapes): rendered as before;
 * - a long string field: a plain Input;
 * - no heading above the fields.
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
const SCHEMA = {
  type: 'object',
  required: ['name', 'tier'],
  properties: {
    name: { type: 'string', title: 'Name' },
    tier: { type: 'string', title: 'Tier', enum: ['gold', 'silver'] },
    description: { type: 'string', title: 'Description', maxLength: 2000 },
    target: {
      title: 'Target',
      oneOf: [
        { type: 'object', title: 'Local', properties: { path: { type: 'string' } } },
        { type: 'object', title: 'Remote', properties: { url: { type: 'string' } } },
      ],
    },
    contact: {
      type: 'object',
      title: 'Contact',
      required: ['email'],
      properties: { email: { type: 'string', title: 'Email' }, phone: { type: 'string', title: 'Phone' } },
    },
  },
}
/* eslint-enable sort-keys/sort-keys-fix */

const base = (extra: Partial<FormWidgetData> = {}): FormWidgetData => ({ actions: ACTIONS, schema: SCHEMA, submitActionId: 'submit', ...extra })

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

describe('the presentation a CR without the new options keeps', () => {
  it.each([
    ['Reset + Submit', base()],
    ['Save draft on the left', base({ buttonConfig: { draft: { label: 'Save draft' } }, draftActionId: 'draft', initialValues: { __owner: 'me__ns__x' } })],
    ['a navigating Cancel and a labelled primary', base({ buttonConfig: { primary: { label: 'Create' }, secondary: { label: 'Cancel', navigateTo: '/back' } } })],
  ])('the action bar: %s', (_name, widgetData) => {
    const { container } = renderForm(widgetData)
    expect(stable((container.querySelector('form')?.parentElement?.nextElementSibling as HTMLElement).outerHTML)).toMatchSnapshot()
  })

  it('no heading above the fields', () => {
    const { container } = renderForm(base())
    const root = container.firstElementChild as HTMLElement
    expect(root.firstElementChild?.querySelector('form')).not.toBeNull()
    expect(container.querySelector('h1, h2, h3, h4, h5, .ant-typography')).toBeNull()
  })

  it('an enum field is a Select of its raw values; a long string is an Input; a non-const oneOf as before', () => {
    const { container } = renderForm(base({ initialValues: { tier: 'gold' } }))
    expect(itemOf(container, 'Tier').querySelector('.ant-select-content, .ant-select-selection-item')?.textContent).toBe('gold')
    expect(itemOf(container, 'Description').querySelector('textarea')).toBeNull()
    expect(itemOf(container, 'Description').querySelector('input')).not.toBeNull()
    expect(stable(itemOf(container, 'Target').outerHTML)).toMatchSnapshot()
  })

  it('the default required messages, top level and in an optional object', async () => {
    const { container } = renderForm(base({ initialValues: { contact: { phone: '+39' } } }))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => {
      expect(itemOf(container, 'Name').querySelector('.ant-form-item-explain-error')?.textContent).toBe('Name is required')
      expect(itemOf(container, 'Tier').querySelector('.ant-form-item-explain-error')?.textContent).toBe('Tier is required')
      expect(itemOf(container, 'Email').querySelector('.ant-form-item-explain-error')?.textContent).toBe('Email is required')
    }, { timeout: 30_000 })
  }, 60_000)
})
