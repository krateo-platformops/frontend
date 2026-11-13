// @vitest-environment jsdom
/**
 * The Card's frame options, each opt-in (Card.frameUnchanged holds what a Card without them keeps):
 *
 * - `maxWidth` — the widest the card grows, filling its container up to that;
 * - `centered` — the card in the middle of its container;
 * - `brand` — the sign-in card's band, with the logo and its alt from the frontend's config (the
 *   bundled ones without), above any `cover` (the content is told it is in a branded frame:
 *   Card.brandContext.test.tsx, and the Form title it changes: Form.brandHeading.test.tsx).
 */
import { cleanup, render } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type Config, ConfigContext } from '../../context/ConfigContext'

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: () => Promise.resolve(), isActionLoading: false }),
}))
vi.mock('../../components/RefChild', () => ({ default: () => <span data-testid='item' /> }))

import Card from './Card'
import type { CardWidgetData } from './Card'

afterEach(() => { cleanup() })

const renderCard = (data: Partial<CardWidgetData>, login?: Config['login']) => {
  const widgetData = { items: [{ resourceRefId: 'form' }], ...data }
  const { container } = render(
    <ConfigContext.Provider value={{ config: { login } as Config, isLoading: false, refetch: vi.fn() as never }}>
      <MemoryRouter>
        <App>
          <Card resourcesRefs={{ items: [] }} uid='c1' widget={{} as never} widgetData={widgetData} />
        </App>
      </MemoryRouter>
    </ConfigContext.Provider>,
  )
  return container.querySelector('.ant-card') as HTMLElement
}

describe('maxWidth and centered', () => {
  it('maxWidth: fills its container up to that many pixels', () => {
    const card = renderCard({ maxWidth: 400 })
    // The cap travels as --card-max-width, read by the `capped` class (max-width, width 100%).
    expect(card.style.getPropertyValue('--card-max-width')).toBe('400px')
    expect([...card.classList].some((name) => /^_capped_/.test(name))).toBe(true)
  })

  it('centered: the card carries the centring class', () => {
    const card = renderCard({ centered: true, maxWidth: 400 })
    expect([...card.classList].some((name) => /^_centered_/.test(name))).toBe(true)
  })

  it('maxWidth keeps an anchorId\'s scroll margin', () => {
    const card = renderCard({ anchorId: 'here', maxWidth: 400 })
    expect(card.style.scrollMarginTop).toBe('80px')
    expect(card.style.getPropertyValue('--card-max-width')).toBe('400px')
  })
})

describe('brand', () => {
  it('the band with the bundled logo across the top, without a config login', () => {
    const card = renderCard({ brand: true, variant: 'outlined' })
    const cover = card.querySelector('.ant-card-cover') as HTMLElement
    expect(card.firstElementChild).toBe(cover)
    const logo = cover.querySelector('img') as HTMLImageElement
    expect(logo.alt).toBe('Krateo | PlatformOps')
    expect(logo.getAttribute('src')).toMatch(/logo_big\.svg$/)
  })

  it('the logo and its alt from config.login', () => {
    const card = renderCard({ brand: true }, { installationName: 'cmp.example.dev', logoAlt: 'Example', logoUrl: '/brand/logo.svg' })
    const logo = card.querySelector('.ant-card-cover img') as HTMLImageElement
    expect([logo.alt, logo.getAttribute('src')]).toEqual(['Example', '/brand/logo.svg'])
  })

  it('the sign-in card\'s frame: the branded class on the card and the brand body', () => {
    const card = renderCard({ brand: true })
    expect([...card.classList].some((name) => /^_branded_/.test(name))).toBe(true)
    expect([...(card.querySelector('.ant-card-body') as HTMLElement).classList].some((name) => /^_brandBody_/.test(name))).toBe(true)
  })
})
