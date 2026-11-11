// @vitest-environment jsdom
/**
 * Regression guard for the alert-create-screen report: the project switcher's "Apply" button did
 * nothing (tester: "clicco su Apply, non succede nulla"). The panel used to rely on a native blur
 * to close the popup, but in antd 6 an in-popup mousedown re-opens the popup (rc-select BaseSelect
 * onRootMouseDown → triggerOpen(true)), so Apply never closed it. The popup open-state is now
 * controlled and Apply closes it via setOpen(false); Clear keeps it open. Both act on click (the
 * pointer's mousedown is prevented only to keep focus on the list), so the keyboard reaches them too.
 *
 * NOTE on scope: jsdom cannot faithfully drive rc-select's option-list POINTER selection (a
 * fireEvent.click on a role=option div does not run the real focus/pointer sequence, so onChange
 * never fires there even for a bare antd Select). These tests therefore assert the OPEN/CLOSE
 * behaviour that the controlled `open` state governs — the part of the fix that is testable here.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as AntdApp } from 'antd'
import { MemoryRouter, useLocation } from 'react-router'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import Select, { type SelectWidgetData } from './Select'
import styles from './Select.module.css'

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
    // The fix wires Apply → setOpen(false); the option list must disappear.
    await userEvent.click(applyBtn)
    expect(screen.queryByRole('option', { name: 'alpha' })).toBeNull()
  })

  it('clicking Clear KEEPS the popup open (reset-to-all, keep picking)', async () => {
    renderSwitcher()
    await openPopup()
    expect(screen.queryByRole('option', { name: 'alpha' })).not.toBeNull()

    const clearBtn = screen.getByText('Clear').closest('button')!
    await userEvent.click(clearBtn)
    // Still open — the user can keep choosing.
    expect(screen.queryByRole('option', { name: 'alpha' })).not.toBeNull()
  })

  it('staged, not live: Clear does NOT apply on its own — only Apply commits to the URL', async () => {
    // Start with a project already applied.
    const { container } = renderWithProbe('/alerts/new?projects=alpha')
    expect(search()).toContain('projects=alpha')
    // With a selection applied the control shows the tag (not "All projects"), so open via the
    // control container rather than that text.
    fireEvent.mouseDown(container.querySelector('.ant-select-content') ?? container.querySelector('.ant-select')!)

    // Clear stages "all projects" but must NOT touch the URL yet (the old bug applied immediately).
    await userEvent.click(screen.getByText('Clear').closest('button')!)
    expect(search()).toContain('projects=alpha')

    // Apply commits the staged selection — "all" clears the param.
    await userEvent.click(screen.getByText(/^Apply/).closest('button')!)
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

    await userEvent.click(screen.getByText(/^Apply/).closest('button')!)
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

/**
 * The header project picker must be reachable by keyboard and by screen readers. Select.module.css
 * used to hide antd's `.ant-select-input` with `display: none` (to stop a caret blinking in the
 * closed control), but that input IS the combobox: it takes focus, carries role=combobox, and turns
 * Enter / Space / ArrowDown into "open the list". With it hidden, Tab skipped the picker and the
 * accessibility tree had no combobox at all.
 *
 * Vitest does not apply CSS modules to jsdom, so a test that only renders the component cannot see
 * a stylesheet bug. These tests inject the REAL Select.module.css, its local class names rewritten
 * to the ones the component receives (`styles.*`), so the rule under test is the shipped one:
 * user-event's Tab skips an element whose computed `display` is `none`, and Testing Library's role
 * queries leave out elements hidden from the accessibility tree.
 */
describe('project switcher — reachable by keyboard and screen readers', () => {
  let sheet: HTMLStyleElement | undefined

  beforeAll(() => {
    const source = readFileSync(resolve(__dirname, 'Select.module.css'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    // `:global(x)` is antd's own class: keep it verbatim. Every other `.name` is a local class, which
    // the module maps to `styles.name`. Local names here are camelCase, so a hyphenated class (antd's)
    // or a decimal like `0.08em` never matches.
    const globals: string[] = []
    const css = source
      .replace(/:global\(([^)]*)\)/g, (_match, inner: string) => `@@${globals.push(inner) - 1}@@`)
      .replace(/\.([A-Za-z]\w*)(?![\w-])/g, (_match, name: string) => `.${(styles as Record<string, string>)[name]}`)
      .replace(/@@(\d+)@@/g, (_match, index: string) => globals[Number(index)])
    sheet = document.createElement('style')
    sheet.textContent = css
    document.head.append(sheet)
  })

  afterAll(() => { sheet?.remove() })

  const name = widgetData.label!

  const renderInPage = () => render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AntdApp>
        <button type='button'>before the picker</button>
        <Select resourcesRefs={{ items: [] }} uid='sw' widgetData={widgetData} />
      </AntdApp>
    </MemoryRouter>,
  )

  it('is exposed as a combobox named by the panel heading', async () => {
    renderInPage()
    await settle()
    expect(screen.getByRole('combobox', { name })).toBeTruthy()
  })

  it('Tab reaches it from the control before it', async () => {
    const user = userEvent.setup()
    const { container } = renderInPage()
    await settle()
    screen.getByRole('button', { name: 'before the picker' }).focus()
    await user.tab()
    // antd's input element itself, not a role query, so this fails on focus alone.
    expect(document.activeElement).toBe(container.querySelector('.ant-select-input'))
  })

  // ArrowDown opens it too, but rc-select reads that key from the legacy `which`, which user-event
  // leaves at 0 in jsdom; the Playwright check in the offline harness covers ArrowDown in Chromium.
  it.each(['{Enter}', ' '])('the keyboard opens it (%j)', async (key) => {
    const user = userEvent.setup()
    renderInPage()
    await settle()
    screen.getByRole('button', { name: 'before the picker' }).focus()
    await user.tab()
    await user.keyboard(key)
    await settle()
    expect(screen.getByRole('combobox', { name }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('option', { name: 'alpha' })).toBeTruthy()
  })
})

/**
 * The keyboard must be able to COMMIT a staged selection, not only stage it. Clear and Apply used to
 * act on mousedown only, and while the list was open rc-select took Tab as "toggle the active
 * option" and prevented it, so focus never left the list: Escape (discard) was the only way out.
 * Now the open panel is a Tab ring in on-screen order: "All projects" row → list → Clear → Apply,
 * wrapping at the ends. Clear and Apply are ordinary buttons (Enter / Space), and Escape from
 * anywhere in the panel still discards.
 */
describe('project switcher — Clear and Apply from the keyboard', () => {
  const name = widgetData.label!

  const renderInPage = (entry = '/dashboard') => render(
    <MemoryRouter initialEntries={[entry]}>
      <AntdApp>
        <button type='button'>before the picker</button>
        <Select resourcesRefs={{ items: [] }} uid='sw' widgetData={widgetData} />
        <button type='button'>after the picker</button>
        <LocationProbe />
      </AntdApp>
    </MemoryRouter>,
  )

  const combobox = () => screen.getByRole('combobox', { name })
  const button = (label: RegExp | string) => screen.getByRole('button', { name: label })
  const expanded = () => combobox().getAttribute('aria-expanded')

  /**
   * Stages the list's active option, as Enter does in a browser. rc-select's list reads the key from
   * the legacy `which`, which user-event leaves at 0 in jsdom (for every key), so this one press is
   * a fireEvent carrying the code. Everything else here is user-event: the code under test reads
   * `key`. The Playwright check in the offline harness stages with a real Enter in Chromium.
   */
  const stageActive = async () => {
    fireEvent.keyDown(combobox(), { key: 'Enter', keyCode: 13, which: 13 })
    fireEvent.keyUp(combobox(), { key: 'Enter', keyCode: 13, which: 13 })
    await settle()
  }
  /** Escape on the list: rc-select's own handler, which reads `which` too (see stageActive). */
  const escapeFromList = async () => {
    fireEvent.keyDown(combobox(), { key: 'Escape', keyCode: 27, which: 27 })
    await settle()
  }

  /**
   * Focus the picker's combobox, open it with Enter, and (optionally) stage the first option, alpha.
   * (Tab onto the picker is covered above. With a scope applied, a project tag's ✕ button sits
   * before the combobox, so focusing it directly keeps every case on the same element.)
   */
  const openFromKeyboard = async (user: ReturnType<typeof userEvent.setup>, { stage }: { stage: boolean }) => {
    await settle()
    combobox().focus()
    await user.keyboard('{Enter}')
    await settle()
    expect(expanded()).toBe('true')
    if (stage) {
      await stageActive()
      expect(button('Apply · 1')).toBeTruthy()
    }
  }

  it('Tab from the open list reaches Clear and then Apply; Shift+Tab walks back to the list', async () => {
    const user = userEvent.setup()
    renderInPage()
    await openFromKeyboard(user, { stage: true })

    await user.tab()
    expect(document.activeElement).toBe(button('Clear'))
    await user.tab()
    expect(document.activeElement).toBe(button('Apply · 1'))
    // Leaving the list for the buttons neither closes the panel nor touches the staged selection.
    expect(expanded()).toBe('true')

    await user.tab({ shift: true })
    expect(document.activeElement).toBe(button('Clear'))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(combobox())
    // Shift+Tab from the list goes up to the "All projects" row, and Tab comes back down.
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(button(/All projects/))
    await user.tab()
    expect(document.activeElement).toBe(combobox())
    expect(button('Apply · 1')).toBeTruthy()
  })

  it('the ring wraps: Tab from Apply goes to the "All projects" row, Shift+Tab from it back to Apply', async () => {
    const user = userEvent.setup()
    renderInPage()
    await openFromKeyboard(user, { stage: false })
    button('Apply').focus()
    await user.tab()
    expect(document.activeElement).toBe(button(/All projects/))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(button('Apply'))
  })

  it.each(['{Enter}', ' '])('%j on Apply commits the staged project to the URL, closes, and focus returns to the picker', async (key) => {
    const user = userEvent.setup()
    renderInPage()
    await openFromKeyboard(user, { stage: true })
    expect(screen.getByTestId('loc').textContent).toBe('')

    await user.tab()
    await user.tab()
    await user.keyboard(key)
    await settle()

    expect(screen.getByTestId('loc').textContent).toBe('?projects=alpha')
    expect(expanded()).toBe('false')
    expect(document.activeElement).toBe(combobox())
  })

  it('Enter on Clear stages "all" and keeps the panel open; Apply then clears the scope', async () => {
    const user = userEvent.setup()
    renderInPage('/dashboard?projects=alpha')
    await openFromKeyboard(user, { stage: false })
    expect(button('Apply · 1')).toBeTruthy()

    await user.tab()
    await user.keyboard('{Enter}')
    await settle()
    // Staged only: the URL keeps the applied scope until Apply.
    expect(button('Apply')).toBeTruthy()
    expect(expanded()).toBe('true')
    expect(document.activeElement).toBe(button('Clear'))
    expect(screen.getByTestId('loc').textContent).toBe('?projects=alpha')

    await user.tab()
    await user.keyboard('{Enter}')
    await settle()
    expect(screen.getByTestId('loc').textContent).toBe('')
  })

  it('Escape still discards the staged selection, from the list and from the buttons', async () => {
    const user = userEvent.setup()
    renderInPage()
    await openFromKeyboard(user, { stage: true })
    await escapeFromList()
    expect(expanded()).toBe('false')
    expect(screen.getByTestId('loc').textContent).toBe('')

    await user.keyboard('{Enter}')
    await settle()
    // Reopened: the discarded stage is gone. Stage again, Tab to Apply, and Escape from there.
    expect(button('Apply')).toBeTruthy()
    await stageActive()
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(button('Apply · 1'))
    await user.keyboard('{Escape}')
    await settle()
    expect(expanded()).toBe('false')
    expect(document.activeElement).toBe(combobox())
    expect(screen.getByTestId('loc').textContent).toBe('')
  })

  it('closed, Tab is not caught: it moves on past the picker', async () => {
    const user = userEvent.setup()
    renderInPage()
    await settle()
    button('before the picker').focus()
    await user.tab()
    expect(document.activeElement).toBe(combobox())
    await user.tab()
    expect(document.activeElement).toBe(button('after the picker'))
  })
})
