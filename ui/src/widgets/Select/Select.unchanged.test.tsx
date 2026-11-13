// @vitest-environment jsdom
/**
 * The Select DOM an existing CR gets, pinned. RECORDED ON `main` before `options[].count`, `prefix`
 * and `panelFooter` existed, so adding them is proven to change nothing for a CR that sets none of
 * them: the project switcher (its closed trigger AND its open panel, with the "N ns" master row and
 * the "scope persists across pages" footer), a single URL-bound Select, and a Form control.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App as AntdApp, Form } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Select, { type SelectWidgetData } from './Select'

// The same jsdom stand-ins Select.test.tsx uses, for the same reasons (rc-overflow measures).
vi.stubGlobal('ResizeObserver', class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  disconnect = vi.fn()
  observe = (target: Element) => { queueMicrotask(() => this.callback([{ target } as ResizeObserverEntry], this)) }
  unobserve = vi.fn()
})
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 400 })
vi.stubGlobal('matchMedia', (query: string) => ({
  addEventListener: vi.fn(),
  addListener: vi.fn(),
  dispatchEvent: vi.fn(() => false),
  matches: false,
  media: query,
  onchange: null,
  removeEventListener: vi.fn(),
  removeListener: vi.fn(),
}))

afterEach(cleanup)

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

/** portal `select.project-select.yaml`, the only multi URL-bound Select in use. */
const projectSelect: SelectWidgetData = {
  label: 'Projects · namespaces',
  mode: 'multiple',
  name: 'projects',
  options: [
    { label: 'alpha', value: 'alpha' },
    { label: 'beta', value: 'beta' },
  ],
  placeholder: 'All projects',
  queryParam: 'projects',
  size: 'small',
}

const renderSelect = (widgetData: SelectWidgetData, entry = '/') => render(
  <MemoryRouter initialEntries={[entry]}>
    <AntdApp>
      <Form>
        <Select resourcesRefs={{ items: [] }} uid='pin' widgetData={widgetData} />
      </Form>
    </AntdApp>
  </MemoryRouter>,
)

describe('Select renders as it did before the facet options', () => {
  it('project switcher, closed', async () => {
    const { container } = renderSelect(projectSelect)
    await settle()
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('project switcher, open panel', async () => {
    renderSelect(projectSelect, '/?projects=alpha')
    await settle()
    fireEvent.mouseDown(document.querySelector('.ant-select-content') ?? document.querySelector('.ant-select')!)
    await settle()
    const popup = document.querySelector('.ant-select-dropdown')
    expect(popup).not.toBeNull()
    expect(screen.getByText('Clear')).toBeTruthy()
    expect(popup!.innerHTML).toMatchSnapshot()
  })

  it('single URL-bound Select', async () => {
    const { container } = renderSelect({ name: 'kind', options: [{ label: 'Alert', value: 'Alert' }], placeholder: 'Kind', queryParam: 'kind' }, '/?kind=Alert')
    await settle()
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('Form control', async () => {
    const { container } = renderSelect({ label: 'Environment', name: 'environment', options: [{ label: 'Development', value: 'dev' }], placeholder: 'Choose' })
    await settle()
    expect(container.innerHTML).toMatchSnapshot()
  })
})
