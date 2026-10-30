// @vitest-environment jsdom
/**
 * `displayDependency` in the real Form: a field shows only while another has a given value.
 * Hidden, it is not rendered — so not required, not submitted, not counted under "Advanced", not
 * saved in a draft — and its value comes back when it is shown again.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import Form, { type FormWidgetData } from './Form'

const handleAction = vi.fn((..._args: unknown[]) => Promise.resolve())
let agentDraft: Record<string, unknown> | null = null

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction, isActionLoading: false }),
}))
vi.mock('../../components/Autopilot/agentDraft', () => ({
  useAgentDraft: () => ({ draft: agentDraft, nonce: 1 }),
}))
vi.mock('../Drawer/DrawerContext', () => ({
  useDrawerContext: () => ({ insideDrawer: false, setDrawerData: vi.fn() }),
}))
vi.mock('../../components/WidgetRenderer', () => ({ default: () => null }))
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
beforeEach(() => {
  handleAction.mockClear()
  agentDraft = null
  localStorage.clear()
})
afterEach(() => { cleanup() })

/* eslint-disable sort-keys/sort-keys-fix */
const SCHEMA = {
  type: 'object',
  properties: {
    name: { title: 'Name', type: 'string' },
    serviceType: { enum: ['ClusterIP', 'NodePort'], title: 'Service type', type: 'string' },
    nodePort: { title: 'Node port', type: 'integer', displayDependency: { conditionType: 'value', dependsOn: { name: 'serviceType' }, value: 'NodePort' } },
    replicas: { title: 'Replicas', type: 'integer' },
  },
  required: ['name', 'serviceType', 'nodePort'],
}
/* eslint-enable sort-keys/sort-keys-fix */

const widgetData = (extra: Partial<FormWidgetData> = {}): FormWidgetData => ({
  actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] },
  draftActionId: 'draft',
  initialValues: { __owner: 'me__ns__vis', name: 'web', serviceType: 'ClusterIP' },
  stringSchema: JSON.stringify(SCHEMA),
  submitActionId: 'submit',
  ...extra,
})

const renderForm = (data: FormWidgetData = widgetData()) => render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={data} />)
const pickType = (type: string) => {
  const item = screen.getByText('Service type', { selector: '[class*="fieldName"]' }).closest('.ant-form-item') as HTMLElement
  fireEvent.mouseDown(item.querySelector('.ant-select') as HTMLElement)
  const entries = screen.getAllByText(type, { selector: '.ant-select-item-option-content' })
  fireEvent.click(entries[entries.length - 1])
}
const submit = () => { fireEvent.submit(document.querySelector('form') as HTMLFormElement) }
const nodePortShown = () => screen.queryByText('Node port', { selector: '[class*="fieldName"]' }) !== null

describe('Form — displayDependency', () => {
  it('hides the field while the rule is false, and its required rule with it', async () => {
    renderForm()
    expect(nodePortShown()).toBe(false)
    expect(screen.getByText('Advanced · 1 setting')).toBeTruthy()
    submit()
    await waitFor(() => { expect(handleAction).toHaveBeenCalled() })
    expect(handleAction.mock.calls[0][2]).toEqual({ name: 'web', serviceType: 'ClusterIP' })
  })

  it('shows it when the rule turns true: required, then submitted', async () => {
    renderForm()
    pickType('NodePort')
    await waitFor(() => { expect(nodePortShown()).toBe(true) })
    submit()
    expect(await screen.findByText('Node port is required')).toBeTruthy()
    expect(handleAction).not.toHaveBeenCalled()
    fireEvent.change(document.querySelector('input#nodePort') as HTMLInputElement, { target: { value: '30001' } })
    submit()
    await waitFor(() => { expect(handleAction).toHaveBeenCalled() })
    expect(handleAction.mock.calls[0][2]).toMatchObject({ nodePort: 30001, serviceType: 'NodePort' })
  })

  it('hidden again, it is not submitted — and its value returns when shown', async () => {
    renderForm()
    pickType('NodePort')
    await waitFor(() => { expect(nodePortShown()).toBe(true) })
    fireEvent.change(document.querySelector('input#nodePort') as HTMLInputElement, { target: { value: '30001' } })
    pickType('ClusterIP')
    await waitFor(() => { expect(nodePortShown()).toBe(false) })
    submit()
    await waitFor(() => { expect(handleAction).toHaveBeenCalled() })
    expect(handleAction.mock.calls[0][2]).not.toHaveProperty('nodePort')
    pickType('NodePort')
    await waitFor(() => { expect(document.querySelector<HTMLInputElement>('input#nodePort')?.value).toBe('30001') })
  })

  it('a saved draft leaves the hidden field out', async () => {
    renderForm(widgetData({ initialValues: { __owner: 'me__ns__vis', name: 'web', nodePort: 30001, serviceType: 'ClusterIP' } }))
    fireEvent.click(screen.getByRole('button', { name: /draft/i }))
    await waitFor(() => { expect(localStorage.getItem('K_draft__me__ns__vis')).toBeTruthy() })
    const saved = JSON.parse(localStorage.getItem('K_draft__me__ns__vis') ?? '{}') as Record<string, unknown>
    expect(saved).toMatchObject({ name: 'web', serviceType: 'ClusterIP' })
    expect(saved).not.toHaveProperty('nodePort')
  })
})
