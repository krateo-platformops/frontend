// @vitest-environment jsdom
/**
 * Dropdown — the overflow menu (the composition detail header's "⋯", approved redesign).
 * The held items are the REAL Button widgets (WidgetRenderer), so this stubs the renderer to a marker
 * and checks what the menu itself owns: the trigger's name, opening, closing on a click, and nothing
 * at all when every item is gone.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('matchMedia', (query: string) => ({
  addEventListener: vi.fn(), addListener: vi.fn(), dispatchEvent: vi.fn(() => false), matches: false, media: query, onchange: null, removeEventListener: vi.fn(), removeListener: vi.fn(),
}))
// antd's popup measures itself; jsdom has no ResizeObserver.
vi.stubGlobal('ResizeObserver', class {
  disconnect() { return undefined }

  observe() { return undefined }

  unobserve() { return undefined }
})
vi.mock('../../components/WidgetRenderer', () => ({
  default: ({ widgetEndpoint }: { widgetEndpoint: string }) => <button data-endpoint={widgetEndpoint} type='button'>{new URLSearchParams(widgetEndpoint.split('?')[1]).get('name')}</button>,
}))

import Dropdown from './Dropdown'

const ref = (id: string) => ({ allowed: true, id, path: `/call?resource=buttons&apiVersion=widgets.templates.krateo.io/v1beta1&name=${id}&namespace=ns`, payload: {}, verb: 'GET' as const })
const menu = (ids: string[]) => (
  <App>
    <Dropdown
      resourcesRefs={{ items: ids.map(ref) }}
      uid='d'
      widget={{} as never}
      widgetData={{ allowedResources: ['buttons'], ariaLabel: 'More actions', items: ids.map((resourceRefId) => ({ resourceRefId })) }}
    />
  </App>
)

describe('Dropdown widget', () => {
  afterEach(() => { cleanup() })

  it('is a compact trigger named for a screen reader, closed at first', () => {
    render(menu(['button-pause', 'button-delete']))
    expect(screen.getByRole('button', { name: 'More actions' })).not.toBeNull()
    expect(screen.queryByText('button-pause')).toBeNull()
  })

  it('opens to the real held Button widgets, in order', () => {
    render(menu(['button-pause', 'button-delete']))
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const items = screen.getAllByRole('button').filter((button) => button.getAttribute('data-endpoint'))
    expect(items.map((button) => button.textContent)).toEqual(['button-pause', 'button-delete'])
  })

  it('closes when an item is clicked (the item keeps its own action and confirmation)', async () => {
    render(menu(['button-pause', 'button-delete']))
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const panel = screen.getByRole('menu')
    fireEvent.click(screen.getByText('button-delete'))
    await waitFor(() => { expect(panel.closest('.ant-dropdown')?.className).toMatch(/ant-dropdown-hidden/) })
    // Still mounted while hidden, so an action the item started is not cut off under it.
    expect(screen.getByText('button-delete', { selector: 'button' })).not.toBeNull()
  })

  it('renders nothing when it holds nothing (every item stripped, e.g. denied)', () => {
    const { container } = render(menu([]))
    expect(container.querySelector('button')).toBeNull()
  })
})
