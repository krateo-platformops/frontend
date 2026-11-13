// @vitest-environment jsdom
/**
 * A Form CR that submits through its `actions` (a snowplow `/call` write) must keep doing exactly
 * that, and a field with no help text must keep its markup. RECORDED ON MAIN, before `fieldChecks`,
 * `submitPost` and `fieldHelp` existed: the commit that adds them has to leave every assertion and
 * snapshot here as it is.
 *
 * - the submit dispatches the CR's action through handleAction, with the validated values;
 * - a submit naming no action, or a non-rest one, is a toast, never anything inline;
 * - while the action runs, the form is swapped for the spinner;
 * - a form using #716's options (checkboxes, requiredMark, hasFeedback, descriptions) renders as
 *   pinned, pristine and after a failed submit.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import Form, { type FormWidgetData } from './Form'

const state = vi.hoisted(() => ({
  handleAction: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
  loading: false,
  notifyError: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
}))

vi.mock('../../hooks/useHandleActions', async () => {
  const { vi: hoistedVi } = await import('vitest')
  state.handleAction = hoistedVi.fn(() => Promise.resolve())
  return { useHandleAction: () => ({ handleAction: state.handleAction, isActionLoading: state.loading }) }
})
vi.mock('antd/es/app/useApp', async () => {
  const { vi: hoistedVi } = await import('vitest')
  state.notifyError = hoistedVi.fn()
  return { default: () => ({ message: {}, modal: {}, notification: { error: state.notifyError, info: hoistedVi.fn(), success: hoistedVi.fn() } }) }
})
vi.mock('../../components/Agentiko/agentDraft', () => ({
  useAgentDraft: () => ({ draft: null, nonce: 1 }),
}))
vi.mock('../Drawer/DrawerContext', () => ({
  useDrawerContext: () => ({ insideDrawer: false, setDrawerData: vi.fn() }),
}))
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }))

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
  state.loading = false
  state.handleAction.mockClear()
  state.notifyError.mockClear()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

/* eslint-disable sort-keys/sort-keys-fix -- the property order is the field order the snapshot pins */
const SCHEMA = {
  properties: {
    name: { description: 'The name you sign in with.', title: 'Name', type: 'string' },
    phone: { description: 'With its country code.', pattern: '^\\+[0-9]+$', title: 'Phone', type: 'string' },
    consent: { description: 'Required to continue.', title: 'I agree to the privacy policy', type: 'boolean' },
    news: { title: 'Send me news', type: 'boolean' },
  },
  required: ['name', 'consent'],
  type: 'object',
}
/* eslint-enable sort-keys/sort-keys-fix */

const REST_ACTION = { headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' as const }

const base = (extra: Partial<FormWidgetData>): FormWidgetData => ({
  actions: { rest: [REST_ACTION] },
  schema: SCHEMA,
  submitActionId: 'submit',
  ...extra,
})

const stable = (html: string): string => {
  const seen = new Map<string, string>()
  return html.replace(/«[^»]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_|rc_select_[0-9]+|rc-tabs-[0-9]+/g, (id) => {
    if (!seen.has(id)) { seen.set(id, `ID${seen.size}`) }
    return seen.get(id) as string
  })
}

const PRESENTED = base({
  checkboxes: [{ link: { href: 'https://example.com/privacy', text: 'privacy policy' }, name: 'consent', requiredMessage: 'Please agree.' }, { name: 'news' }],
  hasFeedback: 'rules',
  requiredMark: 'optional',
})

describe('a Form that submits through its actions, as on main', () => {
  it('dispatches the CR action through handleAction with the validated values', async () => {
    render(<Form resourcesRefs={{ items: [] } as never} uid='u' widgetData={base({ initialValues: { consent: true, name: 'jane' } })} />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => { expect(state.handleAction).toHaveBeenCalledTimes(1) })
    const [action, , values, , , , , kind] = state.handleAction.mock.calls[0] as unknown[]
    expect(action).toEqual(REST_ACTION)
    expect(values).toEqual({ consent: true, name: 'jane', news: undefined, phone: undefined })
    expect(kind).toBe('form.submit')
    expect(state.notifyError).not.toHaveBeenCalled()
  })

  it('a submit naming no action is a toast', async () => {
    render(<Form resourcesRefs={{ items: [] } as never} uid='u' widgetData={base({ initialValues: { consent: true, name: 'jane' }, submitActionId: 'missing' })} />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => { expect(state.notifyError).toHaveBeenCalledTimes(1) })
    expect(state.notifyError.mock.calls[0][0]).toMatchObject({ message: 'Error while executing the action' })
    expect(state.handleAction).not.toHaveBeenCalled()
    expect(document.querySelector('.ant-alert')).toBeNull()
  })

  it('while the action runs, the form is swapped for the spinner', () => {
    state.loading = true
    const { container } = render(<Form resourcesRefs={{ items: [] } as never} uid='u' widgetData={base({})} />)
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('.ant-spin')).not.toBeNull()
  })

  it('a form with descriptions and #716 options, pristine', () => {
    const { container } = render(<Form resourcesRefs={{ items: [] } as never} uid='u' widgetData={PRESENTED} />)
    expect(stable(container.innerHTML)).toMatchSnapshot()
  })

  it('a form with descriptions and #716 options, after a failed submit', async () => {
    const { container } = render(<Form resourcesRefs={{ items: [] } as never} uid='u' widgetData={PRESENTED} />)
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => {
      const failing = [...container.querySelectorAll('.ant-form-item-has-error')]
      expect(failing.length).toBeGreaterThan(0)
      expect(failing.every((item) => item.querySelector('.ant-form-item-explain-error'))).toBe(true)
    }, { timeout: 30_000 })
    await new Promise((resolve) => { setTimeout(resolve, 200) })
    expect(stable(container.innerHTML)).toMatchSnapshot()
  }, 60_000)
})
