// @vitest-environment jsdom
/**
 * N7 (second review of #424): a COMPOSABLE Form (`items`) whose child Input widget has
 * `type: 'password'` treats that field as secret — exactly like a schema `format: password`.
 * On c538398 such a Form handed the action `secretPaths = []`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import Input from '../Input/Input'

import Form, { type FormWidgetData } from './Form'

const handleAction = vi.fn((..._args: unknown[]) => Promise.resolve())

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction, isActionLoading: false }),
}))
vi.mock('../../components/Autopilot/agentDraft', () => ({
  useAgentDraft: () => ({ draft: null, nonce: 1 }),
}))
vi.mock('../Drawer/DrawerContext', () => ({
  useDrawerContext: () => ({ insideDrawer: false, setDrawerData: vi.fn() }),
}))
vi.mock('react-router', () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams(), vi.fn()] }))
vi.mock('antd/es/app/useApp', () => ({ default: () => ({ message: {}, modal: {}, notification: { error: vi.fn(), success: vi.fn() } }) }))
// Each `items` entry renders the real Input widget: `user` a text field, `pw` a password.
vi.mock('../../components/WidgetRenderer', () => ({
  default: ({ widgetEndpoint }: { widgetEndpoint: string }) => (widgetEndpoint.includes('pw')
    ? <Input resourcesRefs={{ items: [] }} uid='pw' widgetData={{ defaultValue: 'default-pw', name: 'pw', type: 'password' } as never} />
    : <Input resourcesRefs={{ items: [] }} uid='user' widgetData={{ name: 'user' }} />),
}))

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
})
beforeEach(() => {
  handleAction.mockClear()
  localStorage.clear()
})
afterEach(() => { cleanup() })

const widgetData = (extra: Partial<FormWidgetData> = {}): FormWidgetData => ({
  actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] },
  draftActionId: 'draft',
  initialValues: { __owner: 'me__ns__items', pw: 'seeded-pw', user: 'seeded-user' },
  items: [{ resourceRefId: 'user' }, { resourceRefId: 'pw' }],
  submitActionId: 'submit',
  ...extra,
})

const resourcesRefs = {
  items: [
    { allowed: true, id: 'user', path: '/call?name=user', payload: {}, verb: 'GET' as const },
    { allowed: true, id: 'pw', path: '/call?name=pw', payload: {}, verb: 'GET' as const },
  ],
}

const input = (container: HTMLElement, id: string) => container.querySelector<HTMLInputElement>(`input#${id}`)

describe('composable Form — a password Input is a secret field', () => {
  it('is not prefilled, and the submit names it secret', async () => {
    const { container } = render(<Form resourcesRefs={resourcesRefs} uid='u' widgetData={widgetData()} />)
    await vi.waitFor(() => { expect(input(container, 'pw')).not.toBeNull() })
    await vi.waitFor(() => { expect(input(container, 'pw')?.value).toBe('') })
    expect(input(container, 'user')?.value).toBe('seeded-user')
    fireEvent.change(input(container, 'pw')!, { target: { value: 'typed-pw' } })
    fireEvent.click(screen.getByText('Submit'))
    await vi.waitFor(() => { expect(handleAction).toHaveBeenCalledTimes(1) })
    const [[, , values, , , , secretPaths]] = handleAction.mock.calls
    expect(values).toMatchObject({ pw: 'typed-pw' })
    expect(secretPaths).toEqual([['pw']])
  })

  it('is never saved to a draft, and the review masks it', async () => {
    const { container } = render(<Form resourcesRefs={resourcesRefs} uid='u' widgetData={widgetData({ reviewBeforeSubmit: true })} />)
    await vi.waitFor(() => { expect(input(container, 'pw')).not.toBeNull() })
    fireEvent.change(input(container, 'pw')!, { target: { value: 'typed-pw' } })
    fireEvent.click(screen.getByText('Save draft'))
    expect(localStorage.getItem('K_draft__me__ns__items') ?? '').not.toContain('typed-pw')
    fireEvent.click(screen.getByText('Review →'))
    await vi.waitFor(() => { expect(screen.getByText('••••••')).toBeTruthy() })
    expect(container.querySelector('.ant-descriptions')?.textContent ?? '').not.toContain('typed-pw')
  })
})
