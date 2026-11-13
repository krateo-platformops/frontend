// @vitest-environment jsdom
/**
 * How a Card places its children. RECORDED ON MAIN, before `afterCard`: the Card is the widget's
 * root element, and every `items` entry renders inside the card's body, in `items` order — also on
 * a framed (brand, centred, capped) card. The commit adding the slot must keep this for any card
 * without `afterCard`.
 */
import { cleanup, render } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: () => Promise.resolve(), isActionLoading: false }),
}))
vi.mock('../../components/RefChild', () => {
  const Child = ({ resourceRefId }: { resourceRefId: string }) => <span data-child={resourceRefId} />
  return { default: Child }
})

import Card from './Card'

afterEach(() => { cleanup() })

const renderCard = (data: Record<string, unknown>) => render(
  <MemoryRouter>
    <App>
      <Card resourcesRefs={{ items: [] }} uid='c1' widget={{} as never} widgetData={{ items: [{ resourceRefId: 'form' }, { resourceRefId: 'signin' }], ...data }} />
    </App>
  </MemoryRouter>,
).container

describe('a Card places its children, as today', () => {
  it.each([
    ['a plain card', {}],
    ['a framed card', { brand: true, centered: true, maxWidth: 400, variant: 'outlined' }],
  ])('%s: the card is the root, and every item is in its body, in order', (_name, data) => {
    const container = renderCard(data)
    const root = container.querySelector('.ant-app')?.firstElementChild ?? container.firstElementChild
    expect(root?.classList.contains('ant-card')).toBe(true)
    const body = container.querySelector('.ant-card-body') as HTMLElement
    expect([...body.querySelectorAll('[data-child]')].map((each) => each.getAttribute('data-child'))).toEqual(['form', 'signin'])
    expect(container.querySelectorAll('[data-child]')).toHaveLength(2)
  })
})
