// @vitest-environment jsdom
/**
 * The namespace switcher (approved mockup, 2026-11-24): namespaces listed under headings ("Tenants", "Other
 * namespaces"), a tenant shown by its own name with its namespace beside it, and one line in the closed control.
 * One select lists every group alike: picking a tenant scopes to its namespace, as picking the namespace does.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SelectWidgetData } from './Select'
import Select from './Select'

// jsdom lays nothing out: every box is 400px wide, so one picked value fits (see Select.test.tsx).
vi.stubGlobal('ResizeObserver', class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  disconnect = vi.fn()
  observe = (target: Element) => { queueMicrotask(() => this.callback([{ target } as ResizeObserverEntry], this)) }
  unobserve = vi.fn()
})
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 400 })

const DATA = {
  allowClear: true,
  label: 'Namespaces',
  mode: 'multiple',
  name: 'projects',
  options: [
    { group: 'Other namespaces', label: 'cert-manager', value: 'cert-manager' },
    { group: 'Tenants', hint: 'tenant-acme', label: 'acme', value: 'tenant-acme' },
    { group: 'Other namespaces', label: 'demo-system', value: 'demo-system' },
  ],
  panelFooter: 'kept from page to page',
  placeholder: 'All namespaces',
  queryParam: 'projects',
  summary: '{count} namespaces',
} as unknown as SelectWidgetData

const Address = () => <output>{useLocation().search}</output>
const show = (search = '', over: Partial<SelectWidgetData> = {}) => render(
  <MemoryRouter initialEntries={[`/dashboard${search}`]}>
    <Select resourcesRefs={{ items: [] }} uid='s' widget={{} as never} widgetData={{ ...DATA, ...over }} />
    <Address />
  </MemoryRouter>,
)
const open = () => { fireEvent.mouseDown(document.querySelector('.ant-select')!) }
const drawn = () => [...document.querySelectorAll('.ant-select-item')].map((row) => row.textContent)
const closed = () => document.querySelector('.ant-select-content')?.textContent ?? ''

afterEach(() => { cleanup() })

describe('a switcher with groups', () => {
  it('lists each group under its heading, in the order the groups first appear', () => {
    show()
    open()
    expect(drawn()).toEqual(['Other namespaces', 'cert-manager', 'demo-system', 'Tenants', 'acmetenant-acme'])
  })

  it('says a tenant with its namespace, to the eye and to a reader', () => {
    show()
    open()
    // rc-select draws role=option for the active row and its neighbours only: step to the last one.
    const list = screen.getByRole('combobox')
    fireEvent.keyDown(list, { key: 'ArrowUp', keyCode: 38, which: 38 })
    expect([...document.querySelectorAll('[role=option]')].map((option) => option.getAttribute('aria-label'))).toContain('acme, tenant-acme')
  })

  it('picking a tenant scopes to its namespace', () => {
    show()
    open()
    fireEvent.click([...document.querySelectorAll('.ant-select-item-option')].find((row) => row.textContent?.startsWith('acme'))!)
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }))
    expect(screen.getByRole('status').textContent).toBe('?projects=tenant-acme')
  })

  it('all is how many there are, and the panel says what the CR says', () => {
    show()
    open()
    expect(screen.getByRole('button', { name: /All namespaces/ }).textContent).toContain('3')
    expect(document.body.textContent).toContain('kept from page to page')
    expect(document.body.textContent).not.toMatch(/project/i)
  })
})

describe('the closed control', () => {
  it.each([['', 'All namespaces'], ['?projects=demo-system', 'demo-system'], ['?projects=tenant-acme', 'acme'], ['?projects=demo-system,tenant-acme', '2 namespaces']])('%s reads "%s"', async (search, text) => {
    show(search)
    await vi.waitFor(() => {
      // (`+0` is rc-overflow's measured, invisible rest.)
      expect(closed().replace('+0', '')).toBe(text)
    })
  })

  it('without a summary each picked value stays a removable tag', async () => {
    show('?projects=demo-system', { summary: undefined })
    expect(await screen.findByRole('button', { name: 'Remove demo-system' })).toBeTruthy()
  })
})
