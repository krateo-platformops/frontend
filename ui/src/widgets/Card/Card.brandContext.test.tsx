// @vitest-environment jsdom
/**
 * A `brand` Card tells its content it is in a branded frame (BrandFrameContext), which is how a
 * Form's title in it draws the installation line under itself (Form.brandHeading.test.tsx). A plain
 * Card says it is not — including inside a branded one: the nearest card frames its content.
 */
import { cleanup, render } from '@testing-library/react'
import { App } from 'antd'
import { useContext } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BrandFrameContext } from '../../components/BrandFrame'

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: () => Promise.resolve(), isActionLoading: false }),
}))
// A card item that says whether it is inside a branded frame.
vi.mock('../../components/RefChild', () => {
  const BrandProbe = () => {
    const branded = useContext(BrandFrameContext)
    return <span data-testid='item'>{branded ? 'branded' : 'plain'}</span>
  }
  return { default: BrandProbe }
})

import Card from './Card'
import type { CardWidgetData } from './Card'

afterEach(() => { cleanup() })

const card = (data: Partial<CardWidgetData>) => (
  <Card resourcesRefs={{ items: [] }} uid='c1' widget={{} as never} widgetData={{ items: [{ resourceRefId: 'form' }], ...data }} />
)

const itemText = (node: React.ReactNode) => {
  render(<MemoryRouter><App>{node}</App></MemoryRouter>)
  return document.querySelector('[data-testid=item]')?.textContent
}

describe('BrandFrameContext from a Card', () => {
  it('a brand Card: branded', () => {
    expect(itemText(card({ brand: true }))).toBe('branded')
  })

  it('a plain Card: plain', () => {
    expect(itemText(card({}))).toBe('plain')
  })

  it('a plain Card inside a branded frame: plain', () => {
    expect(itemText(<BrandFrameContext.Provider value>{card({})}</BrandFrameContext.Provider>)).toBe('plain')
  })
})
