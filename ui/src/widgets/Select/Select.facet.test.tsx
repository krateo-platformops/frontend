// @vitest-environment jsdom
/**
 * The Select as a FACET of a page filter bar: `options[].count`, `prefix` and `panelFooter`.
 *
 * The URL-bound multi-select was built as the project switcher, and its panel said so: the master
 * row counted "N ns" and the footnote promised "scope persists across pages via ?projects=". A
 * facet (Kind, Repo, State) needs its own figures and none of that wording. These keys generalise
 * the panel; Select.unchanged.test.tsx pins that a CR setting none of them renders as before.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { App as AntdApp, Form } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Select, { type SelectWidgetData } from './Select'

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

const kindFacet: SelectWidgetData = {
  label: 'Kind',
  mode: 'multiple',
  name: 'kind',
  options: [
    { count: 47, label: 'Alert', value: 'Alert' },
    { count: 12, label: 'Prompt', value: 'Prompt' },
  ],
  placeholder: 'All kinds',
  queryParam: 'kind',
}

const renderSelect = (widgetData: SelectWidgetData, entry = '/reviews') => render(
  <MemoryRouter initialEntries={[entry]}>
    <AntdApp>
      <Form>
        <Select resourcesRefs={{ items: [] }} uid='facet' widgetData={widgetData} />
      </Form>
    </AntdApp>
  </MemoryRouter>,
)

const openPanel = async () => {
  await settle()
  fireEvent.mouseDown(document.querySelector('.ant-select-content') ?? document.querySelector('.ant-select')!)
  await settle()
  return document.querySelector<HTMLElement>('.ant-select-dropdown')!
}

/** The visible option rows' text (the hidden a11y list repeats each value, so it is left out). */
const optionText = (panel: HTMLElement) => [...panel.querySelectorAll('.ant-select-item-option')].map((option) => option.textContent)

describe('options[].count', () => {
  it('draws each count beside its option in the multi panel', async () => {
    renderSelect(kindFacet)
    const panel = await openPanel()
    expect(optionText(panel)).toEqual(['Alert47', 'Prompt12'])
  })

  it('puts the count in the option\'s accessible name', async () => {
    renderSelect(kindFacet)
    await openPanel()
    expect(screen.getAllByRole('option', { name: 'Alert, 47' }).length).toBeGreaterThan(0)
  })

  it('makes the master row the sum of the counts, not "N ns"', async () => {
    renderSelect(kindFacet)
    const panel = await openPanel()
    const master = within(panel).getByRole('button', { name: /All kinds/ })
    expect(master.textContent).toContain('59')
    expect(master.textContent).not.toContain('ns')
  })

  it('draws the count in a single URL-bound Select too', async () => {
    renderSelect({ ...kindFacet, mode: undefined })
    const panel = await openPanel()
    expect(optionText(panel)).toEqual(['Alert47', 'Prompt12'])
  })
})

describe('panelFooter', () => {
  it('replaces the project switcher\'s footnote', async () => {
    renderSelect({ ...kindFacet, panelFooter: 'Counts apply the other filters' })
    const panel = await openPanel()
    expect(within(panel).getByText('Counts apply the other filters')).toBeTruthy()
    expect(panel.textContent).not.toContain('scope persists')
  })

  it('draws no footnote when empty', async () => {
    renderSelect({ ...kindFacet, panelFooter: '' })
    const panel = await openPanel()
    expect(panel.textContent).not.toContain('scope persists')
    expect(panel.textContent?.endsWith('Apply')).toBe(true)
  })

  it('absent, keeps the switcher\'s own footnote', async () => {
    renderSelect(kindFacet)
    const panel = await openPanel()
    expect(panel.textContent).toContain('scope persists across pages via ?kind=')
  })
})

describe('prefix', () => {
  it('draws the facet name inside the multi-select trigger', async () => {
    const { container } = renderSelect({ ...kindFacet, prefix: 'Kind' })
    await settle()
    expect(container.querySelector('.ant-select-prefix')?.textContent).toBe('Kind')
  })

  it('draws it inside a single URL-bound Select too', async () => {
    const { container } = renderSelect({ ...kindFacet, mode: undefined, prefix: 'Kind' })
    await settle()
    expect(container.querySelector('.ant-select-prefix')?.textContent).toBe('Kind')
  })
})
