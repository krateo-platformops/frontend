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
import { library } from '@fortawesome/fontawesome-svg-core'
import { faCheck, faXmark } from '@fortawesome/free-solid-svg-icons'
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

library.add(faCheck, faXmark)

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

describe('Listy rowVariant: statistic, with an icon and no frames', () => {
  afterEach(() => { cleanup() })
  const states = [{ icon: 'fa-check', label: 'OK', tone: 'bad', value: 92 }, { icon: 'fa-xmark', label: 'Critical', value: 0 }]
  const withIcon: ItemTemplate = { color: { map: { bad: 'red' }, value: '{tone}' }, icon: '{icon}', primaryText: '{label}', rowVariant: 'statistic', secondaryText: '{value}' }

  it('the icon stands by the title, hidden from a reader, in the tile’s colour when it has one', () => {
    renderStrip(withIcon, states)
    const icons = [...document.querySelectorAll('.ant-statistic-title svg')] as SVGElement[]
    expect(icons.map((icon) => icon.getAttribute('aria-hidden'))).toEqual(['true', 'true'])
    expect(icons[0].style.color).not.toBe('')
    expect(icons[1].style.color).toBe('')
    expect(screen.getByText('OK').textContent).toBe('OK')
  })

  it('borderless draws no frame and no tinted edge; outlined, the default, is as before', () => {
    renderStrip({ ...withIcon, tileVariant: 'borderless' }, states)
    expect(document.querySelectorAll('.ant-card-borderless, .ant-card:not(.ant-card-bordered)').length).toBeGreaterThan(0)
    expect(tile('OK').style.borderColor).toBe('')
    cleanup()
    renderStrip(withIcon, states)
    expect(tile('OK').style.borderColor).not.toBe('')
  })
})

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

  // `highlight` is the RESTAction's verdict. The tile must not work one out from its number or colour.
  describe('highlight', () => {
    const marked = [
      { color: 'red', label: 'Coloured, not highlighted', mark: false, value: '7' },
      { color: 'red', label: 'Highlighted zero', mark: true, value: '0' },
      { color: '', label: 'Highlighted, no colour', mark: true, value: '3' },
      { color: 'red', label: 'Not said', value: '9' },
    ]
    const byData: ItemTemplate = { color: { value: '{color}' }, highlight: '{mark}', primaryText: '{label}', rowVariant: 'statistic', secondaryText: '{value}' }
    const border = (label: string) => tile(label).style.borderColor

    it('draws the border exactly where it is true, whatever the value and the colour', () => {
      renderStrip(byData, marked)
      expect(marked.map(({ label }) => border(label) !== '')).toEqual([false, true, true, false])
      expect(value('Coloured, not highlighted').style.color).not.toBe('')
    })

    it('in the tile\'s colour, or the text colour when it has none', () => {
      renderStrip(byData, marked)
      expect(border('Highlighted zero')).toContain(getColorCode('red'))
      expect(border('Highlighted, no colour')).toContain('var(--text-color)')
    })

    it('a borderless tile has none', () => {
      renderStrip({ ...byData, tileVariant: 'borderless' }, marked)
      expect(marked.map(({ label }) => border(label))).toEqual(['', '', '', ''])
    })

    it('absent from the template: the border follows the colour, as before', () => {
      renderStrip({ ...byData, highlight: undefined }, marked)
      expect(marked.map(({ label }) => border(label) !== '')).toEqual([true, true, false, true])
    })
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
