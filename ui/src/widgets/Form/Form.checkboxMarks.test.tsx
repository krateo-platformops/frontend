// @vitest-environment jsdom
/**
 * Three opt-ins of a schema Form, each absent by default (Form.unchanged.test.tsx pins that):
 *
 * - `checkboxes`: a boolean drawn as an antd Checkbox labelled by its title, one phrase of which
 *   can be a link; a required one must be ticked, with the CR's message.
 * - `requiredMark: optional`: "(optional)" on every field that is not required, none on the rest.
 * - `hasFeedback: rules`: the feedback icons on an optional field that has a rule.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Form as AntdForm, Input } from 'antd'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { safeHref } from './checkboxField'
import Form, { type FormWidgetData } from './Form'

const handleAction = vi.fn((..._args: unknown[]) => Promise.resolve())

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction, isActionLoading: false }),
}))
vi.mock('../../components/Agentiko/agentDraft', () => ({
  useAgentDraft: () => ({ draft: null, nonce: 1 }),
}))
vi.mock('../Drawer/DrawerContext', () => ({
  useDrawerContext: () => ({ insideDrawer: false, setDrawerData: vi.fn() }),
}))
vi.mock('../../components/WidgetRenderer', () => ({
  default: ({ widgetEndpoint }: { widgetEndpoint: string }) => (widgetEndpoint.includes('child-required')
    ? <AntdForm.Item label='Child required' name='childRequired' rules={[{ required: true }]}><Input /></AntdForm.Item>
    : <AntdForm.Item label='Child optional' name='childOptional'><Input /></AntdForm.Item>),
}))
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
beforeEach(() => { handleAction.mockClear() })
afterEach(() => {
  cleanup()
  localStorage.clear()
})

/* eslint-disable sort-keys/sort-keys-fix -- the property order is the field order */
const SCHEMA = {
  properties: {
    firstName: { title: 'First name', type: 'string' },
    phone: { pattern: '^\\+[0-9 ]+$', title: 'Phone', type: 'string' },
    consent: { title: 'I agree to the processing of my details. See the privacy policy.', type: 'boolean' },
    news: { title: 'Send me occasional news.', type: 'boolean' },
  },
  required: ['firstName', 'consent'],
  type: 'object',
}
/* eslint-enable sort-keys/sort-keys-fix */

const CONSENT_MESSAGE = 'Please agree, or the request cannot be reviewed.'
const PRIVACY = 'https://example.com/privacy'

const CHECKBOXES: FormWidgetData['checkboxes'] = [
  { link: { href: PRIVACY, text: 'privacy policy' }, name: 'consent', requiredMessage: CONSENT_MESSAGE },
  { name: 'news' },
]

const widgetData = (extra: Partial<FormWidgetData> = {}, schema: Record<string, unknown> = SCHEMA): FormWidgetData => ({
  actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] },
  schema,
  submitActionId: 'submit',
  ...extra,
})

const renderForm = (data: FormWidgetData) => render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={data} />)

/** The Form.Item a field is rendered in, found by its control's id (the field's name). */
const itemOf = (container: HTMLElement, id: string) => container.querySelector(`#${id}`)?.closest('.ant-form-item') as HTMLElement

/** A field's antd Checkbox input — null where the field is still a Switch. */
const checkbox = (container: HTMLElement, id: string) => container.querySelector<HTMLInputElement>(`input#${id}[type=checkbox]`)

const submitted = async (): Promise<Record<string, unknown>> => {
  await waitFor(() => { expect(handleAction).toHaveBeenCalledTimes(1) }, { timeout: 10_000 })
  return handleAction.mock.calls[0][2] as Record<string, unknown>
}

describe('checkboxes', () => {
  it('draws a listed boolean as a Checkbox labelled by its title, and leaves the others Switches', () => {
    const { container } = renderForm(widgetData({ checkboxes: [{ name: 'news' }] }))
    const news = itemOf(container, 'news')
    expect(news.querySelector('.ant-checkbox-wrapper')?.textContent).toBe('Send me occasional news.')
    expect(news.querySelector('.ant-switch')).toBeNull()
    expect(itemOf(container, 'consent').querySelector('.ant-switch')).not.toBeNull()
  })

  it('submits true when ticked', async () => {
    const { container } = renderForm(widgetData({ checkboxes: CHECKBOXES, initialValues: { firstName: 'Jane' } }))
    expect(checkbox(container, 'consent')).not.toBeNull()
    expect(checkbox(container, 'news')).not.toBeNull()
    fireEvent.click(checkbox(container, 'consent') as HTMLElement)
    fireEvent.click(checkbox(container, 'news') as HTMLElement)
    fireEvent.click(screen.getByText('Submit'))
    expect(await submitted()).toMatchObject({ consent: true, news: true })
  })

  it('submits false when ticked and unticked', async () => {
    const { container } = renderForm(widgetData({ checkboxes: CHECKBOXES, initialValues: { firstName: 'Jane' } }))
    expect(checkbox(container, 'consent')).not.toBeNull()
    expect(checkbox(container, 'news')).not.toBeNull()
    fireEvent.click(checkbox(container, 'consent') as HTMLElement)
    fireEvent.click(checkbox(container, 'news') as HTMLElement)
    fireEvent.click(checkbox(container, 'news') as HTMLElement)
    fireEvent.click(screen.getByText('Submit'))
    expect(await submitted()).toMatchObject({ consent: true, news: false })
  })

  it('a required checkbox left unticked shows the CR\'s message and does not submit', async () => {
    const { container } = renderForm(widgetData({ checkboxes: CHECKBOXES, initialValues: { firstName: 'Jane' } }))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => { expect(itemOf(container, 'consent').textContent).toContain(CONSENT_MESSAGE) }, { timeout: 10_000 })
    expect(handleAction).not.toHaveBeenCalled()
  })

  it('a required checkbox ticked then unticked is still refused (false is not consent)', async () => {
    const { container } = renderForm(widgetData({ checkboxes: CHECKBOXES, initialValues: { firstName: 'Jane' } }))
    fireEvent.click(container.querySelector('#consent') as HTMLElement)
    fireEvent.click(container.querySelector('#consent') as HTMLElement)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => { expect(itemOf(container, 'consent').textContent).toContain(CONSENT_MESSAGE) }, { timeout: 10_000 })
    expect(handleAction).not.toHaveBeenCalled()
  })

  it('without a requiredMessage a required checkbox says to tick it', async () => {
    const { container } = renderForm(widgetData({ checkboxes: [{ name: 'consent' }], initialValues: { firstName: 'Jane' } }))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => { expect(itemOf(container, 'consent').textContent).toContain('Tick this box to continue.') }, { timeout: 10_000 })
  })

  it('an entry naming a field that is not a boolean is ignored', () => {
    const { container } = renderForm(widgetData({ checkboxes: [{ name: 'firstName' }] }))
    expect(itemOf(container, 'firstName').querySelector('input.ant-input')).not.toBeNull()
    expect(container.querySelector('.ant-checkbox-wrapper')).toBeNull()
  })
})

describe('checkboxes — the link in a label', () => {
  it('is a real link, opened in a new tab, around the phrase it names', () => {
    const { container } = renderForm(widgetData({ checkboxes: CHECKBOXES }))
    const label = itemOf(container, 'consent').querySelector('.ant-checkbox-wrapper') as HTMLElement
    const link = label.querySelector('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(PRIVACY)
    expect(link.textContent).toBe('privacy policy')
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noopener noreferrer')
    expect(label.textContent).toBe('I agree to the processing of my details. See the privacy policy. *')
  })

  it('follows the label when its phrase is not in it', () => {
    const { container } = renderForm(widgetData({ checkboxes: [{ link: { href: PRIVACY, text: 'terms' }, name: 'news' }] }))
    const label = itemOf(container, 'news').querySelector('.ant-checkbox-wrapper') as HTMLElement
    expect(label.textContent).toBe('Send me occasional news. terms')
    expect(label.querySelector('a')?.getAttribute('href')).toBe(PRIVACY)
  })

  it('is not injectable: markup in the label or the phrase stays text', () => {
    const schema = {
      properties: { consent: { title: 'I agree <img src=x onerror="alert(1)"> to the <b>terms</b>', type: 'boolean' } },
      type: 'object',
    }
    const { container } = renderForm(widgetData({ checkboxes: [{ link: { href: PRIVACY, text: '<b>terms</b>' }, name: 'consent' }] }, schema))
    const label = itemOf(container, 'consent').querySelector('.ant-checkbox-wrapper') as HTMLElement
    expect(label.querySelector('img')).toBeNull()
    expect(label.querySelector('b')).toBeNull()
    expect(label.textContent).toBe('I agree <img src=x onerror="alert(1)"> to the <b>terms</b>')
    expect(label.querySelector('a')?.textContent).toBe('<b>terms</b>')
  })

  // eslint-disable-next-line no-script-url -- the hostile hrefs the label must refuse to draw
  it.each(['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>', '//evil.example.com', 'vbscript:x'])('draws no link to %s, and keeps the phrase as text', (href) => {
    const { container } = renderForm(widgetData({ checkboxes: [{ link: { href, text: 'privacy policy' }, name: 'consent' }] }))
    const label = itemOf(container, 'consent').querySelector('.ant-checkbox-wrapper') as HTMLElement
    expect(label.querySelector('a')).toBeNull()
    expect(label.textContent).toContain('See the privacy policy.')
  })

  it('accepts http(s), mailto and a path on the portal', () => {
    expect(safeHref('https://example.com/privacy')).toBe('https://example.com/privacy')
    expect(safeHref('http://example.com')).toBe('http://example.com/')
    expect(safeHref('mailto:privacy@example.com')).toBe('mailto:privacy@example.com')
    expect(safeHref('/legal/privacy')).toBe('/legal/privacy')
    expect(safeHref('/\\evil.example.com')).toBeUndefined()
  })
})

describe('requiredMark: optional', () => {
  const mark = (item: HTMLElement) => (item.textContent ?? '').includes('(optional)')

  it('shows "(optional)" on exactly the fields that are not required, and no asterisk', () => {
    const { container } = renderForm(widgetData({ checkboxes: CHECKBOXES, requiredMark: 'optional' }))
    expect(mark(itemOf(container, 'firstName'))).toBe(false)
    expect(mark(itemOf(container, 'consent'))).toBe(false)
    expect(mark(itemOf(container, 'phone'))).toBe(true)
    expect(mark(itemOf(container, 'news'))).toBe(true)
    expect(screen.getAllByText('(optional)')).toHaveLength(2)
    expect(container.textContent).not.toContain(' *')
  })

  it('puts the mark beside the name, not after the description', () => {
    const schema = { properties: { phone: { description: 'With its country code.', title: 'Phone', type: 'string' } }, type: 'object' }
    const { container } = renderForm(widgetData({ requiredMark: 'optional' }, schema))
    const label = itemOf(container, 'phone').querySelector('label') as HTMLElement
    expect(label.textContent).toBe('Phone(optional)With its country code.')
  })

  it('renders the optional fields in place, in schema order, with no "Advanced" collapse', () => {
    const { container } = renderForm(widgetData({ checkboxes: CHECKBOXES, requiredMark: 'optional' }))
    expect(container.querySelector('.ant-collapse')).toBeNull()
    const order = [...container.querySelectorAll('.ant-form-item input')].map((input) => input.id)
    expect(order).toEqual(['firstName', 'phone', 'consent', 'news'])
  })

  it('without it, required fields keep the asterisk and the optional ones the collapse', () => {
    const { container } = renderForm(widgetData({ checkboxes: CHECKBOXES }))
    expect(container.textContent).not.toContain('(optional)')
    expect(container.querySelector('.ant-collapse')?.textContent).toContain('Advanced · 2 settings')
  })

  it('marks a composable Form\'s children through antd\'s own requiredMark', () => {
    const { container } = render(
      <Form
        resourcesRefs={{ items: [{ allowed: true, id: 'child-required', path: '/call?child-required', verb: 'GET' }, { allowed: true, id: 'child-optional', path: '/call?child-optional', verb: 'GET' }] } as never}
        uid='u'
        widgetData={widgetData({ items: [{ resourceRefId: 'child-required' }, { resourceRefId: 'child-optional' }], requiredMark: 'optional', schema: undefined })}
      />,
    )
    expect(itemOf(container, 'childOptional').querySelector('.ant-form-item-optional')?.textContent).toBe('(optional)')
    expect(itemOf(container, 'childRequired').querySelector('.ant-form-item-optional')).toBeNull()
  })
})

describe('hasFeedback: rules', () => {
  const icon = (item: HTMLElement) => item.querySelector('.ant-form-item-feedback-icon')?.className ?? ''

  it('shows the error icon on an optional field whose rule fails', async () => {
    const { container } = renderForm(widgetData({ hasFeedback: 'rules', requiredMark: 'optional' }))
    fireEvent.change(container.querySelector('#phone') as HTMLElement, { target: { value: '0039 333' } })
    await waitFor(() => { expect(icon(itemOf(container, 'phone'))).toContain('feedback-icon-error') }, { timeout: 10_000 })
  })

  it('and the success icon once it passes', async () => {
    const { container } = renderForm(widgetData({ hasFeedback: 'rules', requiredMark: 'optional' }))
    fireEvent.change(container.querySelector('#phone') as HTMLElement, { target: { value: '+39 333 123' } })
    await waitFor(() => { expect(icon(itemOf(container, 'phone'))).toContain('feedback-icon-success') }, { timeout: 10_000 })
  })

  it('an empty optional field gets no success icon after a submit, though its rule passed', async () => {
    const { container } = renderForm(widgetData({ hasFeedback: 'rules', requiredMark: 'optional' }))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => { expect(itemOf(container, 'firstName').querySelector('.ant-form-item-explain-error')).not.toBeNull() }, { timeout: 10_000 })
    expect(itemOf(container, 'phone').className).toContain('ant-form-item-has-feedback')
    expect(icon(itemOf(container, 'phone'))).toBe('')
  })

  it('an optional field with no rule has no feedback', () => {
    const schema = { properties: { nickname: { title: 'Nickname', type: 'string' } }, type: 'object' }
    const { container } = renderForm(widgetData({ hasFeedback: 'rules' }, schema))
    expect(itemOf(container, 'nickname').className).not.toContain('ant-form-item-has-feedback')
  })

  it('without it, an optional field with a rule has no feedback, as before', async () => {
    const { container } = renderForm(widgetData({ requiredMark: 'optional' }))
    expect(itemOf(container, 'phone').className).not.toContain('ant-form-item-has-feedback')
    fireEvent.change(container.querySelector('#phone') as HTMLElement, { target: { value: '0039 333' } })
    await waitFor(() => { expect(itemOf(container, 'phone').className).toContain('ant-form-item-has-error') }, { timeout: 10_000 })
    expect(itemOf(container, 'phone').querySelector('.ant-form-item-feedback-icon')).toBeNull()
  })
})
