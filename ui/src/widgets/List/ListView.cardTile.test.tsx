// @vitest-environment jsdom
/**
 * A card's icon tile spans its two title lines (portal review: the centred 32px tile met neither
 * the name nor the tags). Which cards get the two-line layout is decided here; where the edges land
 * is measured in Chromium by visual/listCardTile.spec.ts, because jsdom does no layout.
 *
 * Only a `tile` icon beside a name AND a tag/version line changes. A one-line card, and an Avatar
 * or a dot icon, render exactly as before.
 */
import { cleanup, render } from '@testing-library/react'
import { App } from 'antd'
import type * as ReactRouter from 'react-router'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => vi.fn(),
}))
vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(), isActionLoading: false }),
}))

import type { ItemTemplate } from './itemTemplate'
import { ListView } from './ListView'

const items = [{ desc: 'Ready=True', icon: 'fa-cubes', kind: 'AcmeFeedback', name: 'acme-feedback-controller', state: 'Paused' }]

const twoLineCards = (itemTemplate: ItemTemplate): number => {
  const { container } = render(
    <MemoryRouter>
      <App>
        <ListView itemTemplate={itemTemplate} items={items} rowKey='name' />
      </App>
    </MemoryRouter>,
  )
  return container.querySelectorAll('[class*="cardTopTwoLine"]').length
}

const card = { description: '{desc}', icon: '{icon}', primaryText: '{name}', rowVariant: 'card' } as const

describe('a card icon tile spans the two title lines', () => {
  afterEach(() => { cleanup() })

  it('a tile beside a name and a tag line', () => {
    expect(twoLineCards({ ...card, iconVariant: 'tile', secondaryText: '{state}' })).toBe(1)
  })

  it('a tile beside a name and a version line', () => {
    expect(twoLineCards({ ...card, iconVariant: 'tile', subPrimaryText: '{kind}' })).toBe(1)
  })

  it('not a one-line card: the tile stays centred beside the name', () => {
    expect(twoLineCards({ ...card, iconVariant: 'tile' })).toBe(0)
  })

  it('not an Avatar icon', () => {
    expect(twoLineCards({ ...card, secondaryText: '{state}' })).toBe(0)
  })

  it('not a dot icon', () => {
    expect(twoLineCards({ ...card, iconVariant: 'dot', secondaryText: '{state}' })).toBe(0)
  })

  it('not a tile with no icon to show', () => {
    expect(twoLineCards({ ...card, icon: undefined, iconVariant: 'tile', secondaryText: '{state}' })).toBe(0)
  })
})
