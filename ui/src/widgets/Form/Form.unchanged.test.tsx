// @vitest-environment jsdom
/**
 * A Form CR that sets none of the presentation options must render exactly as it did before they
 * existed. These snapshots were RECORDED ON MAIN, before the checkbox, `requiredMark` and
 * `hasFeedback` options were added: the commit that adds them has to leave every one of them
 * byte for byte.
 *
 * The fixtures cover what those options touch: booleans (a Switch, required and optional, in and
 * out of an optional object), the required marks in every field header, the feedback icons on
 * required fields and their absence on optional fields with rules, the "Advanced" collapse, the
 * section rail, and a composable Form whose children are plain antd Form.Items. Each is pinned
 * pristine and after a failed submit, when validation has painted every status.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Form as AntdForm, Input } from 'antd'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import Form, { type FormWidgetData } from './Form'

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(() => Promise.resolve()), isActionLoading: false }),
}))
vi.mock('../../components/Agentiko/agentDraft', () => ({
  useAgentDraft: () => ({ draft: null, nonce: 1 }),
}))
vi.mock('../Drawer/DrawerContext', () => ({
  useDrawerContext: () => ({ insideDrawer: false, setDrawerData: vi.fn() }),
}))
// A composable Form's children are widgets of their own: two plain antd Form.Items stand in.
vi.mock('../../components/WidgetRenderer', () => ({
  default: ({ widgetEndpoint }: { widgetEndpoint: string }) => (widgetEndpoint.includes('child-required')
    ? <AntdForm.Item label='Child required' name='childRequired' rules={[{ message: 'Child required is required', required: true }]}><Input /></AntdForm.Item>
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
afterEach(() => {
  cleanup()
  localStorage.clear()
})

/* eslint-disable sort-keys/sort-keys-fix -- the property order is the field order the snapshot pins */
/** Every field kind the presentation options could reach, with required and optional of each. */
const FLAT = {
  properties: {
    name: { description: 'The name of the resource.', minLength: 3, title: 'Name', type: 'string' },
    email: { pattern: '^[^@]+@[^@]+$', title: 'Email', type: 'string' },
    phone: { description: 'With its country code.', pattern: '^\\+[0-9]+$', title: 'Phone', type: 'string' },
    nickname: { title: 'Nickname', type: 'string' },
    replicas: { maximum: 10, minimum: 1, title: 'Replicas', type: 'integer' },
    tier: { enum: ['gold', 'silver'], title: 'Tier', type: 'string' },
    accept: { title: 'Accept the terms', type: 'boolean' },
    notify: { description: 'Send updates.', title: 'Notify me', type: 'boolean' },
    tags: { items: { type: 'string' }, maxItems: 3, title: 'Tags', type: 'array' },
  },
  required: ['name', 'email', 'tier', 'accept'],
  type: 'object',
}

/** Two sections (a rail), an optional object with a required child and a boolean inside it. */
const SECTIONED = {
  properties: {
    name: { title: 'Name', type: 'string' },
    contact: {
      properties: {
        address: { title: 'Address', type: 'string' },
        verified: { title: 'Verified', type: 'boolean' },
        zip: { pattern: '^[0-9]{5}$', title: 'ZIP', type: 'string' },
      },
      required: ['address'],
      title: 'Contact',
      type: 'object',
    },
    settings: {
      properties: {
        debug: { title: 'Debug', type: 'boolean' },
        level: { title: 'Level', type: 'string' },
      },
      required: ['debug'],
      title: 'Settings',
      type: 'object',
    },
  },
  required: ['name', 'settings'],
  type: 'object',
}

/* eslint-enable sort-keys/sort-keys-fix */

/** Nothing required: the optional fields render open, no "Advanced". */
const ALL_OPTIONAL = {
  properties: {
    comment: { maxLength: 20, title: 'Comment', type: 'string' },
    subscribe: { title: 'Subscribe', type: 'boolean' },
  },
  type: 'object',
}

const base = (extra: Partial<FormWidgetData>): FormWidgetData => ({
  actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] },
  submitActionId: 'submit',
  ...extra,
})

const CASES: Array<[string, FormWidgetData]> = [
  ['flat schema form', base({ initialValues: { email: 'not-an-email', name: 'alpha', nickname: 'al', phone: '+3912', replicas: 0 }, schema: FLAT })],
  ['flat schema form, horizontal and small', base({ layout: 'horizontal', schema: FLAT, size: 'small' })],
  ['sectioned schema form', base({ initialValues: { contact: { zip: 'abc' } }, stringSchema: JSON.stringify(SECTIONED) })],
  ['all-optional schema form', base({ initialValues: { comment: 'a comment that is far too long' }, schema: ALL_OPTIONAL })],
  ['composable form', base({ items: [{ resourceRefId: 'child-required' }, { resourceRefId: 'child-optional' }] })],
]

const resourcesRefs = {
  items: [
    { allowed: true, id: 'child-required', path: '/call?child-required', verb: 'GET' },
    { allowed: true, id: 'child-optional', path: '/call?child-optional', verb: 'GET' },
  ],
}

/**
 * The markup with the ids React and rc-select generate replaced by their order of appearance, so
 * the snapshot pins the structure and not the order the tests happened to run in.
 */
const stable = (html: string): string => {
  const seen = new Map<string, string>()
  return html.replace(/«[^»]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_|rc_select_[0-9]+|rc-tabs-[0-9]+/g, (id) => {
    if (!seen.has(id)) { seen.set(id, `ID${seen.size}`) }
    return seen.get(id) as string
  })
}

describe('Form without the presentation options renders as on main', () => {
  it.each(CASES)('%s, pristine', (_name, widgetData) => {
    const { container } = render(<Form resourcesRefs={resourcesRefs as never} uid='u' widgetData={widgetData} />)
    expect(stable(container.innerHTML)).toMatchSnapshot()
  })

  it.each(CASES)('%s, after a failed submit', async (_name, widgetData) => {
    const { container } = render(<Form resourcesRefs={resourcesRefs as never} uid='u' widgetData={widgetData} />)
    fireEvent.click(screen.getByText('Submit'))
    // Settled: every field in error shows its message. antd debounces the message list, so on a
    // loaded machine it can trail the error class by seconds.
    await waitFor(() => {
      const failing = [...container.querySelectorAll('.ant-form-item-has-error')]
      expect(failing.length).toBeGreaterThan(0)
      expect(failing.every((item) => item.querySelector('.ant-form-item-explain-error'))).toBe(true)
    }, { timeout: 30_000 })
    await new Promise((resolve) => { setTimeout(resolve, 200) })
    expect(stable(container.innerHTML)).toMatchSnapshot()
  }, 60_000)
})
