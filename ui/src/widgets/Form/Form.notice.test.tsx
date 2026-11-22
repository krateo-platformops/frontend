// @vitest-environment jsdom
/**
 * `widgetData.notice`: what the schema's source could not carry, said above the fields — the
 * blueprint formdef sets it when it falls back to the CRD, which loses the authoring order of the
 * fields, so the form no longer degrades silently.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import Form, { type FormWidgetData } from './Form'

const handleAction = vi.fn((..._args: unknown[]) => Promise.resolve())
let agentDraft: Record<string, unknown> | null = null

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction, isActionLoading: false }),
}))
vi.mock('../../components/Agentiko/agentDraft', () => ({
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

const widgetData = (schema: Record<string, unknown>): FormWidgetData => ({
  actions: { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' }] },
  schema,
  submitActionId: 'submit',
})

const FIELDS = { properties: { name: { title: 'Name', type: 'string' } }, type: 'object' }

describe('Form — notice', () => {
  it('shows the notice above the fields', () => {
    render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={{ ...widgetData(FIELDS), notice: 'Built from the CRD.' }} />)
    const notice = screen.getByText('Built from the CRD.')
    const field = screen.getByText('Name')
    expect(notice.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows nothing without one', () => {
    const { container } = render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData(FIELDS)} />)
    expect(container.querySelector('.ant-alert')).toBeNull()
  })
})

// `widgetData.notices`: e.g. the blueprint form's note that its inputs were inferred from the chart's
// default values (core-provider #568), with the provider's condition message as the details.
const INFERRED = {
  description: [
    'Each field is checked only against the type of its default.',
    '3 fields accept any value: ingress.annotations, extraEnv, podLabels.',
  ],
  details: 'ValuesSchemaAuthored=False · InferredFromValues\nthe chart ships no values.schema.json',
  title: "This form is generated from the chart's default values",
}

describe('Form — notices', () => {
  it('shows each notice above the fields, after `notice`, with its paragraphs in order', () => {
    const { container } = render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={{ ...widgetData(FIELDS), notice: 'Built from the CRD.', notices: [INFERRED] }} />)
    const alerts = [...container.querySelectorAll('.ant-alert')]
    expect(alerts.map((alert) => alert.querySelector('.ant-alert-title')?.textContent)).toEqual(['Built from the CRD.', INFERRED.title])
    const paragraphs = [...alerts[1].querySelectorAll('.ant-alert-description .ant-typography')].map((paragraph) => paragraph.textContent)
    expect(paragraphs).toEqual(INFERRED.description)
    const field = screen.getByText('Name')
    expect(alerts[1].compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the details closed until Details is opened, then shows them verbatim', () => {
    const { container } = render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={{ ...widgetData(FIELDS), notices: [INFERRED] }} />)
    expect(container.querySelector('pre')).toBeNull()
    fireEvent.click(screen.getByText('Details'))
    expect(container.querySelector('pre')?.textContent).toBe(INFERRED.details)
  })

  it('draws a title-only notice without a description, and skips one with a blank title', () => {
    const { container } = render(<Form resourcesRefs={{ items: [] }} uid='u' widgetData={{ ...widgetData(FIELDS), notices: [{ title: 'Only a title' }, { title: '  ' }] }} />)
    const alerts = container.querySelectorAll('.ant-alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].querySelector('.ant-alert-description')).toBeNull()
    expect(screen.queryByText('Details')).toBeNull()
  })
})
