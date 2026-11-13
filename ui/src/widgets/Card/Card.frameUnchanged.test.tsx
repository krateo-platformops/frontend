// @vitest-environment jsdom
/**
 * What a Card without the frame options draws. RECORDED ON MAIN, before `maxWidth`, `centered` and
 * `brand` existed: the commit that adds them has to keep every snapshot and assertion here.
 *
 * - the root `.ant-card` carries no inline width and no margin: it fills its container;
 * - nothing above the header or the body: no cover, no band, no logo;
 * - a titled card and an untitled outlined card (the shape a page's form card has) as they were.
 */
import { cleanup, render } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: () => Promise.resolve(), isActionLoading: false }),
}))

import Card from './Card'
import type { CardWidgetData } from './Card'

afterEach(() => { cleanup() })

const renderCard = (data: Partial<CardWidgetData>) => {
  const widgetData = { items: [], ...data }
  const { container } = render(
    <MemoryRouter>
      <App>
        <Card resourcesRefs={{ items: [] }} uid='c1' widget={{} as never} widgetData={widgetData} />
      </App>
    </MemoryRouter>,
  )
  return container.querySelector('.ant-card') as HTMLElement
}

describe('a Card without the frame options', () => {
  it.each([
    ['titled', { title: 'Tile' }],
    ['untitled and outlined', { variant: 'outlined' }],
    ['small and borderless, titled', { size: 'small', title: 'Small', variant: 'borderless' }],
  ] as Array<[string, Partial<CardWidgetData>]>)('%s: as before', (_name, data) => {
    const card = renderCard(data)
    expect(card.outerHTML).toMatchSnapshot()
  })

  it('fills its container: no inline width, max-width or margin on the card', () => {
    const card = renderCard({ variant: 'outlined' })
    expect(card.getAttribute('style')).toBeNull()
  })

  it('draws nothing above its body: no cover, no image', () => {
    const card = renderCard({ variant: 'outlined' })
    expect(card.querySelector('.ant-card-cover')).toBeNull()
    expect(card.querySelector('img')).toBeNull()
    expect(card.firstElementChild?.classList.contains('ant-card-body')).toBe(true)
  })
})
