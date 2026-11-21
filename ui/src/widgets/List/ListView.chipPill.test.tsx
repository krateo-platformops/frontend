// @vitest-environment jsdom
/**
 * M2 (approved motion set): a chip row with exactly one active chip draws the active fill as one
 * pill that slides to the next chip while the row stays mounted, and is only PLACED (no motion) the
 * first time, so a row that remounts after a navigating chip shows the new chip at once.
 */
import { cleanup, render } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('matchMedia', (query: string) => ({
  addEventListener: vi.fn(), addListener: vi.fn(), dispatchEvent: vi.fn(() => false), matches: false, media: query, onchange: null, removeEventListener: vi.fn(), removeListener: vi.fn(),
}))
vi.mock('../../hooks/useHandleActions', () => ({ useHandleAction: () => ({ handleAction: vi.fn(), isActionLoading: false }) }))

import { ListView } from './ListView'

const chips = (active: string) => ['24h', '7d', '30d'].map((label) => ({ active: label === active, label, route: `/alerts?range=${label}` }))
const view = (items: unknown[]) => (
  <MemoryRouter>
    <App>
      <ListView itemTemplate={{ navigateTo: '{route}', primaryText: '{label}', rowVariant: 'chip' }} items={items} rowKey='range' />
    </App>
  </MemoryRouter>
)
const pillOf = (container: HTMLElement) => container.querySelector<HTMLElement>('span[aria-hidden="true"][style]')

afterEach(() => { cleanup() })

describe('Listy chip row — the sliding pill', () => {
  it('one active chip: a pill sits behind it, placed without motion the first time, and the chip is see-through', () => {
    const { container } = render(view(chips('7d')))
    const pill = pillOf(container)
    expect(pill).not.toBeNull()
    expect(pill?.className).not.toMatch(/chipPillMoving/)
    const active = container.querySelector('[data-chip-active="true"]')
    expect(active?.textContent).toBe('7d')
    expect(active?.className).toMatch(/chipOnPill/)
    expect(active?.className).toMatch(/ant-btn-variant-text/)
  })

  it('choosing another chip while the row stays mounted makes the pill move', () => {
    const { container, rerender } = render(view(chips('7d')))
    rerender(view(chips('30d')))
    expect(pillOf(container)?.className).toMatch(/chipPillMoving/)
    expect(container.querySelector('[data-chip-active="true"]')?.textContent).toBe('30d')
  })

  it('a row that remounts places the pill again without motion', () => {
    const first = render(view(chips('7d')))
    first.unmount()
    const { container } = render(view(chips('30d')))
    expect(pillOf(container)?.className).not.toMatch(/chipPillMoving/)
  })

  it('a filter bar with several active chips keeps the plain primary chips, no pill', () => {
    const { container } = render(view([{ active: true, label: 'a', route: '/x' }, { active: true, label: 'b', route: '/y' }]))
    expect(pillOf(container)).toBeNull()
    expect(container.querySelectorAll('.ant-btn-variant-solid')).toHaveLength(2)
  })
})
