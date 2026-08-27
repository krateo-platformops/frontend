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
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Select, { type SelectWidgetData } from './Select'

// jsdom lacks the browser APIs antd's Select (resize/virtual list, responsive) touches.
vi.stubGlobal('ResizeObserver', class {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
})
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

// Open by mousedown on the control's placeholder. (jsdom's zero-height virtual list only renders
// the first couple of options, so assertions target `alpha`, which always renders.)
const openPopup = () => fireEvent.mouseDown(screen.getAllByText('All projects')[0])

describe('project switcher (multi/queryParam) — Apply closes the popup', () => {
  it('opens the switcher panel with Apply + option rows', () => {
    renderSwitcher()
    openPopup()
    expect(screen.getByText(/^Apply/)).toBeTruthy()
    expect(screen.getByRole('option', { name: 'alpha' })).toBeTruthy()
  })

  it('clicking Apply CLOSES the popup (was a no-op before the fix)', () => {
    renderSwitcher()
    openPopup()
    expect(screen.queryByRole('option', { name: 'alpha' })).not.toBeNull()

    const applyBtn = screen.getByText(/^Apply/).closest('button')!
    // The fix wires Apply's onMouseDown → setOpen(false); the option list must disappear.
    fireEvent.mouseDown(applyBtn)
    expect(screen.queryByRole('option', { name: 'alpha' })).toBeNull()
  })

  it('clicking Clear KEEPS the popup open (reset-to-all, keep picking)', () => {
    renderSwitcher()
    openPopup()
    expect(screen.queryByRole('option', { name: 'alpha' })).not.toBeNull()

    const clearBtn = screen.getByText('Clear').closest('button')!
    fireEvent.mouseDown(clearBtn)
    // Still open — the user can keep choosing.
    expect(screen.queryByRole('option', { name: 'alpha' })).not.toBeNull()
  })
})
