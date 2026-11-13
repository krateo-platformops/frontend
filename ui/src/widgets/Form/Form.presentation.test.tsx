// @vitest-environment jsdom
/**
 * The Form presentation options, each opt-in (Form.presentationUnchanged pins what they leave
 * alone): `buttonConfig.secondary.hidden`, `primary.block` / `primary.size`, `textareas`, labelled
 * `oneOf` options (and their enum mismatch), `validationMessages`, `requiredMark: hidden`, `title`.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAnonymousTransport } from '../../public/anonymousTransport'
import { WidgetTransportProvider } from '../../transport/widgetTransport'

import Form, { type FormWidgetData } from './Form'

const spies = vi.hoisted(() => ({ submitted: [] as unknown[] }))

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: (_action: unknown, _refs: unknown, values: unknown) => { spies.submitted.push(values); return Promise.resolve() }, isActionLoading: false }),
}))
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
beforeEach(() => { spies.submitted = [] })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ACTIONS = { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' as const }] }

/* eslint-disable sort-keys/sort-keys-fix -- the property order is the field order */
const COUNTRY = {
  type: 'string',
  title: 'Country',
  oneOf: [{ const: 'IT', title: 'Italy' }, { const: 'FR', title: 'France' }, { const: 'US', title: 'United States' }],
}
const SCHEMA = {
  type: 'object',
  required: ['name', 'country', 'description'],
  properties: {
    name: { type: 'string', title: 'Name' },
    country: COUNTRY,
    priority: { type: 'string', title: 'Priority', enum: ['low', 'high'], oneOf: [{ const: 'low', title: 'Low' }, { const: 'high', title: 'High' }] },
    description: { type: 'string', title: 'Description' },
    notes: { type: 'string', title: 'Notes' },
    tier: { type: 'string', title: 'Tier', enum: ['gold', 'silver'] },
    replicas: { type: 'integer', title: 'Replicas' },
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

const renderForm = (widgetData: FormWidgetData) => render(
  <WidgetTransportProvider value={createAnonymousTransport({ postAllowlist: ['/intake/'] })}>
    <Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData} />
  </WidgetTransportProvider>,
)

const itemOf = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('.ant-form-item')].find((each) => each.querySelector('label')?.textContent?.startsWith(label)) as HTMLElement

const actionBar = (container: HTMLElement) => container.querySelector('form')?.parentElement?.nextElementSibling as HTMLElement

describe('buttonConfig', () => {
  it('secondary.hidden drops Reset; the primary stays', () => {
    const { container } = renderForm(base({ buttonConfig: { secondary: { hidden: true } } }))
    expect(screen.queryByText('Reset')).toBeNull()
    expect(within(actionBar(container)).getAllByRole('button').map((button) => button.textContent)).toEqual(['Submit'])
  })

  it('secondary.hidden drops a navigating Cancel too', () => {
    renderForm(base({ buttonConfig: { secondary: { hidden: true, label: 'Cancel', navigateTo: '/back' } } }))
    expect(screen.queryByText('Cancel')).toBeNull()
  })

  it('primary.block spans the bar, large, with the other buttons stacked above it', () => {
    const { container } = renderForm(base({ buttonConfig: { primary: { block: true, label: 'Request access', size: 'large' } } }))
    const bar = actionBar(container).firstElementChild as HTMLElement
    const buttons = within(bar).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['Reset', 'Request access'])
    const [, primary] = buttons
    expect(primary.classList.contains('ant-btn-block')).toBe(true)
    expect(primary.classList.contains('ant-btn-lg')).toBe(true)
    expect(bar.querySelector('.ant-space')).toBeNull()
  })

  it('primary.size alone keeps the row layout', () => {
    const { container } = renderForm(base({ buttonConfig: { primary: { size: 'large' } } }))
    const primary = within(actionBar(container)).getByText('Submit').closest('button') as HTMLElement
    expect(primary.classList.contains('ant-btn-lg')).toBe(true)
    expect(primary.classList.contains('ant-btn-block')).toBe(false)
    expect(actionBar(container).querySelector('.ant-space')).not.toBeNull()
  })
})

describe('textareas', () => {
  it('draws a string field as a TextArea, with the CR rows or 3', () => {
    const { container } = renderForm(base({ textareas: [{ name: 'description', rows: 6 }, { name: 'notes' }] }))
    expect(itemOf(container, 'Description').querySelector('textarea')?.getAttribute('rows')).toBe('6')
    expect(itemOf(container, 'Notes').querySelector('textarea')?.getAttribute('rows')).toBe('3')
    expect(itemOf(container, 'Name').querySelector('textarea')).toBeNull()
  })

  it('ignores an entry naming a field with a list of values, or not a string', () => {
    const { container } = renderForm(base({ textareas: [{ name: 'tier' }, { name: 'country' }, { name: 'replicas' }, { name: 'nonexistent' }] }))
    expect(itemOf(container, 'Tier').querySelector('.ant-select')).not.toBeNull()
    expect(itemOf(container, 'Country').querySelector('.ant-select')).not.toBeNull()
    expect(itemOf(container, 'Replicas').querySelector('textarea')).toBeNull()
  })

  it('submits the typed text', async () => {
    const { container } = renderForm(base({ initialValues: { country: 'IT', name: 'x' }, textareas: [{ name: 'description' }] }))
    fireEvent.change(itemOf(container, 'Description').querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'line one\nline two' } })
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => { expect(spies.submitted).toHaveLength(1) })
    expect(spies.submitted[0]).toMatchObject({ description: 'line one\nline two' })
  })
})

describe('labelled oneOf options', () => {
  it('shows the titles and submits the consts', async () => {
    const { container } = renderForm(base({ initialValues: { country: 'IT', description: 'd', name: 'x', priority: 'high' } }))
    expect(itemOf(container, 'Country').querySelector('.ant-select-content, .ant-select-selection-item')?.textContent).toBe('Italy')
    // with an enum beside it, oneOf supplies the labels
    expect(itemOf(container, 'Priority').querySelector('.ant-select-content, .ant-select-selection-item')?.textContent).toBe('High')
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => { expect(spies.submitted).toHaveLength(1) })
    expect(spies.submitted[0]).toMatchObject({ country: 'IT', priority: 'high' })
  })

  it('the dropdown lists the titles', async () => {
    const { container } = renderForm(base())
    fireEvent.mouseDown(itemOf(container, 'Country').querySelector('.ant-select') as HTMLElement)
    await waitFor(() => { expect(document.querySelectorAll('.ant-select-item-option').length).toBe(3) })
    expect([...document.querySelectorAll('.ant-select-item-option')].map((option) => option.textContent)).toEqual(['Italy', 'France', 'United States'])
  })

  it('the review step shows the title beside the value', async () => {
    renderForm(base({ initialValues: { country: 'FR', description: 'd', name: 'x' }, reviewBeforeSubmit: true }))
    fireEvent.click(screen.getByText('Review →'))
    expect(await screen.findByText('France (FR)')).toBeTruthy()
  })

  it.each([
    ['a value only in enum', ['low', 'high', 'urgent'], 'priority', '(low, high, urgent)'],
    ['a value only in oneOf', ['low'], 'priority', '(low)'],
  ])('enum and oneOf that differ (%s): the error state names the field and both lists', (_name, enumValues, field, listed) => {
    const schema = { ...SCHEMA, properties: { ...SCHEMA.properties, priority: { ...SCHEMA.properties.priority, enum: enumValues } } }
    const { container } = renderForm(base({ schema }))
    expect(container.querySelector('form')).toBeNull()
    const message = container.querySelector('.ant-result-error')?.textContent ?? ''
    expect(message).toContain(`\`${field}\``)
    expect(message).toContain(listed)
    expect(message).toContain('(low, high)')
  })

  it('a mismatch inside a nested object is named by its dotted path', () => {
    const schema = { ...SCHEMA, properties: { ...SCHEMA.properties, contact: { ...SCHEMA.properties.contact, properties: { ...SCHEMA.properties.contact.properties, kind: { enum: ['a'], oneOf: [{ const: 'b', title: 'B' }], type: 'string' } } } } }
    const { container } = renderForm(base({ schema }))
    expect(container.querySelector('.ant-result-error')?.textContent).toContain('`contact.kind`')
  })
})

describe('validationMessages', () => {
  it('replaces "<Label> is required", at the top level and in an optional object; others keep theirs', async () => {
    const { container } = renderForm(base({
      initialValues: { contact: { phone: '+39' } },
      validationMessages: [{ name: 'name', requiredMessage: 'Enter your name.' }, { name: 'contact.email', requiredMessage: 'Enter an email address.' }],
    }))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => {
      expect(itemOf(container, 'Name').querySelector('.ant-form-item-explain-error')?.textContent).toBe('Enter your name.')
      expect(itemOf(container, 'Email').querySelector('.ant-form-item-explain-error')?.textContent).toBe('Enter an email address.')
      expect(itemOf(container, 'Description').querySelector('.ant-form-item-explain-error')?.textContent).toBe('Description is required')
    }, { timeout: 30_000 })
  }, 60_000)
})

describe('requiredMark: hidden', () => {
  it('no field carries a mark, required or not', () => {
    const { container } = renderForm(base({ requiredMark: 'hidden' }))
    const labels = [...container.querySelectorAll('label')].map((label) => label.textContent ?? '')
    expect(labels.some((text) => text.includes('*'))).toBe(false)
    expect(labels.some((text) => text.includes('(optional)'))).toBe(false)
    expect(container.querySelector('.ant-form-item-required:not(.ant-form-item-required-mark-hidden)')).toBeNull()
  })
})

describe('title', () => {
  it('a heading above the fields', () => {
    const { container } = renderForm(base({ title: 'Request access' }))
    const heading = container.querySelector('h3') as HTMLElement
    expect(heading.textContent).toBe('Request access')
    expect(heading.compareDocumentPosition(container.querySelector('form') as HTMLElement)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('goes with the form when a Result replaces it', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 202 }))))
    const { container } = renderForm({
      initialValues: { name: 'x' },
      schema: { properties: { name: { title: 'Name', type: 'string' } }, type: 'object' },
      submitPost: { path: '/intake/requests', responses: [{ result: { status: 'info', title: 'Check your inbox' }, when: { status: [202] } }] },
      title: 'Request access',
    })
    expect(container.querySelector('h3')?.textContent).toBe('Request access')
    await act(async () => {
      fireEvent.click(screen.getByText('Submit'))
      await Promise.resolve()
    })
    expect(await screen.findByText('Check your inbox')).toBeTruthy()
    expect(container.querySelector('h3')).toBeNull()
    expect(screen.queryByText('Request access')).toBeNull()
  })
})
