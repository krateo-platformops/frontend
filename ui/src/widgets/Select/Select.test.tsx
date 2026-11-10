// @vitest-environment jsdom
/**
 * Regression guard for the alert-create-screen report: the project switcher's "Apply" button did
 * nothing (tester: "clicco su Apply, non succede nulla"). The panel used to rely on a native blur
 * to close the popup, but in antd 6 an in-popup mousedown re-opens the popup (rc-select BaseSelect
 * onRootMouseDown → triggerOpen(true)), so Apply never closed it. The popup open-state is now
 * controlled and Apply closes it via setOpen(false); Clear keeps it open.
 *
 * NOTE on scope: jsdom cannot faithfully drive rc-select's option-list POINTER selection (a
 * fireEvent.click on a role=option div does not run the real focus/pointer sequence, so onChange
 * never fires there even for a bare antd Select). These tests therefore assert the OPEN/CLOSE
 * behaviour that the controlled `open` state governs — the part of the fix that is testable here.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Select, { type SelectWidgetData } from './Select'

// jsdom lacks the browser APIs antd's Select (resize/virtual list, responsive) touches. The trigger
// uses `maxTagCount: 'responsive'`, and rc-overflow shows a value only once it has measured room
// for it: with an observer that never reports, the control renders no value at all, just "+0". So
// this observer reports each element once, and every element is 400px wide, which is room for any
// value here. jsdom lays nothing out, so the items themselves measure 0 and all of them fit.
vi.stubGlobal('ResizeObserver', class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  disconnect = vi.fn()
  observe = (target: Element) => {
    // rc-resize-observer registers its listener right AFTER calling observe(), so report on the
    // next microtask, as a browser would after layout.
    queueMicrotask(() => this.callback([{ target } as ResizeObserverEntry], this))
  }
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

const widgetData: SelectWidgetData = {
  allowClear: true,
  label: 'Projects · namespaces',
  mode: 'multiple',
  name: 'projects',
  options: [
    { label: 'alpha', value: 'alpha' },
    { label: 'beta', value: 'beta' },
    { label: 'gamma', value: 'gamma' },
  ],
  placeholder: 'All projects',
  queryParam: 'projects',
  size: 'small',
}

/** Lets the observer's report and rc-overflow's re-measure settle. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

const renderSwitcher = (entry = '/alerts/new') => render(
  <MemoryRouter initialEntries={[entry]}>
    <AntdApp>
      <Select
        resourcesRefs={{ items: [] }}
        uid='sw'
        widgetData={widgetData}
      />
    </AntdApp>
  </MemoryRouter>,
)

// Reads the live URL query so a test can assert whether a click APPLIED (changed ?projects=) or
// only staged (URL unchanged).
const LocationProbe = () => <div data-testid='loc'>{useLocation().search}</div>
const renderWithProbe = (entry: string) => render(
  <MemoryRouter initialEntries={[entry]}>
    <AntdApp>
      <Select resourcesRefs={{ items: [] }} uid='sw' widgetData={widgetData} />
      <LocationProbe />
    </AntdApp>
  </MemoryRouter>,
)
const search = () => screen.getByTestId('loc').textContent

// Open by mousedown on the control's "All projects" value. (jsdom's zero-height virtual list only
// renders the first couple of options, so assertions target `alpha`, which always renders.)
const openPopup = async () => {
  await settle()
  fireEvent.mouseDown(screen.getAllByText('All projects')[0])
}

describe('project switcher (multi/queryParam) — Apply closes the popup', () => {
  it('opens the switcher panel with Apply + option rows', async () => {
    renderSwitcher()
    await openPopup()
    expect(screen.getByText(/^Apply/)).toBeTruthy()
    expect(screen.getByRole('option', { name: 'alpha' })).toBeTruthy()
  })

  it('clicking Apply CLOSES the popup (was a no-op before the fix)', async () => {
    renderSwitcher()
    await openPopup()
    expect(screen.queryByRole('option', { name: 'alpha' })).not.toBeNull()

    const applyBtn = screen.getByText(/^Apply/).closest('button')!
    // The fix wires Apply's onMouseDown → setOpen(false); the option list must disappear.
    fireEvent.mouseDown(applyBtn)
    expect(screen.queryByRole('option', { name: 'alpha' })).toBeNull()
  })

  it('clicking Clear KEEPS the popup open (reset-to-all, keep picking)', async () => {
    renderSwitcher()
    await openPopup()
    expect(screen.queryByRole('option', { name: 'alpha' })).not.toBeNull()

    const clearBtn = screen.getByText('Clear').closest('button')!
    fireEvent.mouseDown(clearBtn)
    // Still open — the user can keep choosing.
    expect(screen.queryByRole('option', { name: 'alpha' })).not.toBeNull()
  })

  it('staged, not live: Clear does NOT apply on its own — only Apply commits to the URL', () => {
    // Start with a project already applied.
    const { container } = renderWithProbe('/alerts/new?projects=alpha')
    expect(search()).toContain('projects=alpha')
    // With a selection applied the control shows the tag (not "All projects"), so open via the
    // control container rather than that text.
    fireEvent.mouseDown(container.querySelector('.ant-select-content') ?? container.querySelector('.ant-select')!)

    // Clear stages "all projects" but must NOT touch the URL yet (the old bug applied immediately).
    fireEvent.mouseDown(screen.getByText('Clear').closest('button')!)
    expect(search()).toContain('projects=alpha')

    // Apply commits the staged selection — "all" clears the param.
    fireEvent.mouseDown(screen.getByText(/^Apply/).closest('button')!)
    expect(search()).not.toContain('projects=')
  })
})

/**
 * C1 (X4 audit): "All projects" is the switcher's VALUE when no project is picked. It used to be
 * antd's placeholder, so it was drawn in placeholder grey (1.74:1 in light mode) and stood for an
 * empty control, when an empty scope is a real choice: every project.
 */
describe('project switcher — "All projects" is the value, not a placeholder', () => {
  // The trigger's value region (antd 6): selected values render here, the placeholder does not.
  const valueRegion = (container: HTMLElement) => container.querySelector<HTMLElement>('.ant-select-content')!
  // Selected values' labels, as rc-overflow lays them out: the prefix slot (where the placeholder
  // goes), the rest counter, the input and a tag's ✕ remove button are not part of a value.
  const values = (container: HTMLElement) => [...valueRegion(container).querySelectorAll<HTMLElement>(
    '.ant-select-content-item:not(.ant-select-content-item-prefix):not(.ant-select-content-item-rest):not(.ant-select-content-item-suffix)',
  )].filter((item) => item.style.opacity !== '0').map((item) => {
    const label = item.cloneNode(true) as HTMLElement
    label.querySelectorAll('button').forEach((button) => button.remove())
    return label.textContent
  })

  it('with no scope in the URL the control holds "All projects" as its one selected value', async () => {
    const { container } = renderSwitcher()
    await settle()
    expect(container.querySelector('.ant-select-placeholder')).toBeNull()
    expect(values(container)).toEqual(['All projects'])
  })

  it('with a scope applied the value is the project, and "All projects" is gone from the control', async () => {
    const { container } = renderSwitcher('/alerts/new?projects=alpha')
    await settle()
    expect(values(container)).toEqual(['alpha'])
  })

  it('picking a project replaces "all", and only the project reaches the URL', async () => {
    const { container } = renderWithProbe('/alerts/new')
    await settle()
    const input = screen.getByRole('combobox')
    // Keyboard selection runs rc-select's real onChange (pointer selection does not in jsdom): the
    // first Enter opens the list, the second picks the active option, the first one. rc-select's
    // list reads `which`, so the second press carries the key code.
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, which: 13 })
    await settle()
    expect(values(container)).toEqual(['alpha'])

    fireEvent.mouseDown(screen.getByText(/^Apply/).closest('button')!)
    expect(search()).toBe('?projects=alpha')
  })

  it('Backspace on the "all" value leaves the scope at all, still shown as the value', async () => {
    const { container } = renderWithProbe('/alerts/new')
    await settle()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Backspace' })
    await settle()
    expect(values(container)).toEqual(['All projects'])
    expect(search()).toBe('')
  })
})
