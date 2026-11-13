// @vitest-environment jsdom
/**
 * `rowVariant: statistic`, a root page's stats strip as ONE Listy fed by one dataSource: an antd
 * Card per item holding an antd Statistic (title, value) and a secondary caption.
 *
 * COLOUR IS EXCEPTION-ONLY. A strip where every tile is coloured says nothing; the template tints a
 * tile only when its number is bad, and the healthy majority keeps the neutral ink. So the colour is
 * applied only when `itemTemplate.color` RESOLVES, never as the `gray` fallback the other variants
 * draw.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { App } from 'antd'
import type * as ReactRouter from 'react-router'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getColorCode } from '../../theme/palette'

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

const navigate = vi.fn()
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => navigate,
}))
vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(), isActionLoading: false }),
}))

import type { ItemTemplate } from './itemTemplate'
import { ListView } from './ListView'
import styles from './ListView.module.css'

const strip = [
  { caption: 'from 9 alerts', label: 'Open incidents', tone: 'bad', value: 47 },
  { caption: 'oldest 3 days', label: 'Opened in the last 7 days', value: 12 },
  { label: 'Waiting for a decision', value: '' },
]

const template: ItemTemplate = {
  color: { map: { bad: 'red' }, value: '{tone}' },
  primaryText: '{label}',
  rowVariant: 'statistic',
  secondaryText: '{value}',
  subPrimaryText: '{caption}',
}

const renderStrip = (itemTemplate: ItemTemplate = template, items: unknown[] = strip) => render(
  <MemoryRouter>
    <App>
      <ListView itemTemplate={itemTemplate} items={items} rowKey='strip' />
    </App>
  </MemoryRouter>,
)

const tile = (title: string) => screen.getByText(title).closest('.ant-card') as HTMLElement
const value = (title: string) => tile(title).querySelector<HTMLElement>('.ant-statistic-content')!

describe('Listy rowVariant: statistic', () => {
  afterEach(() => {
    cleanup()
    navigate.mockReset()
  })

  it('draws one antd Card + Statistic per item: title, value and caption', () => {
    renderStrip()
    expect(document.querySelectorAll('.ant-card .ant-statistic')).toHaveLength(3)
    expect(within(tile('Open incidents')).getByText('47')).toBeTruthy()
    expect(within(tile('Open incidents')).getByText('from 9 alerts')).toBeTruthy()
  })

  it('tints a tile only when its colour resolves; the others stay neutral', () => {
    renderStrip()
    expect(value('Open incidents').style.color).not.toBe('')
    expect(value('Opened in the last 7 days').style.color).toBe('')
    expect(tile('Opened in the last 7 days').style.borderColor).toBe('')
  })

  it('the tint is the palette colour the template named', () => {
    renderStrip()
    const probe = document.createElement('span')
    probe.style.color = getColorCode('red')
    expect(value('Open incidents').style.color).toBe(probe.style.color)
  })

  it('no `color` at all: every tile neutral (not the gray fallback)', () => {
    renderStrip({ ...template, color: undefined })
    for (const { label } of strip) {
      expect(value(label).style.color).toBe('')
    }
  })

  it('a value that resolves empty is a muted em-dash, never a blank read as zero', () => {
    renderStrip()
    expect(value('Waiting for a decision').textContent).toBe('—')
  })

  it('without `grid`, the tiles lay out as a reflowing strip', () => {
    const { container } = renderStrip()
    expect(container.querySelector('.ant-list')?.classList.contains(styles.statList)).toBe(true)
  })

  it('with `navigateTo`, a tile is a keyboard-reachable link', () => {
    renderStrip({ ...template, navigateTo: '/incidents?status=Open' })
    const card = tile('Open incidents')
    expect(card.getAttribute('role')).toBe('button')
    expect(card.tabIndex).toBe(0)
    card.click()
    expect(navigate).toHaveBeenCalledWith('/incidents?status=Open')
  })
})
