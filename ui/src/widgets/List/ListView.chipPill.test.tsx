// @vitest-environment jsdom
/**
 * M2 (approved motion set): a chip row with exactly one active chip draws the active fill as one
 * pill that slides to the next chip while the row stays mounted, and is only PLACED (no motion) the
 * first time, so a row that remounts after a navigating chip shows the new chip at once.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

  // CHIP-1 (UX audit, 2026-11-25): under the pointer the active chip drew antd's light primary tint
  // over the pill with the on-primary ink kept, about 1.2:1, so the filter just chosen vanished.
  it('the active chip stays see-through on hover and press, so the pill stays its fill', () => {
    const { container } = render(view(chips('7d')))
    const active = container.querySelector<HTMLElement>('[data-chip-active="true"]')
    // The stylesheet's selector names these antd classes: the active chip must carry every one.
    for (const name of ['ant-btn', 'ant-btn-color-primary', 'ant-btn-variant-text']) {
      expect(active?.classList.contains(name)).toBe(true)
    }
    // The variables it re-points are the ones antd paints the text variant's hover and press from.
    const antd = [...document.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n')
    expect(antd).toMatch(/background-color:\s*var\(--ant-btn-bg-color-hover\)/)
    expect(antd).toMatch(/background-color:\s*var\(--ant-btn-bg-color-active\)/)
    const sheet = readFileSync(join(__dirname, 'ListView.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = sheet.match(/:global\(\.ant-btn\.ant-btn-color-primary\.ant-btn-variant-text\)\.chipOnPill\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/--ant-btn-bg-color-hover:\s*transparent;/)
    expect(rule).toMatch(/--ant-btn-bg-color-active:\s*transparent;/)
  })
})
