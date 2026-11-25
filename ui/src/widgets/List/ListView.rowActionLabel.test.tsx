// @vitest-environment jsdom
/**
 * A card row action's `label` and `icon` from the row's data (`{path}`, as the itemTemplate's own
 * slots resolve).
 *
 * The Marketplace grid offers "Install" on every card, also on a chart that is installed already,
 * whose detail page offers "Configure". One template has to name the verb each row needs, so a card
 * action's label resolves `{actionLabel}` against the row. Three things are pinned here: a templated
 * label and icon resolve per row; a static label is shown exactly as written (every existing card
 * grid); and a label that resolves empty leaves that row without the button rather than drawing an
 * empty, nameless one. A click still fires the action once with the row as its payload.
 */
/* eslint-disable no-template-curly-in-string -- the action paths intentionally use the literal ${field} redirect DSL. */
import { library } from '@fortawesome/fontawesome-svg-core'
import { faDownload, faSliders } from '@fortawesome/free-solid-svg-icons'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { App } from 'antd'
import type * as ReactRouter from 'react-router'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WidgetActions } from '../../types/Widget'

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

library.add(faDownload, faSliders)

const navigateSpy = vi.fn()
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => navigateSpy,
}))

const handleActionSpy = vi.fn()
vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: handleActionSpy, isActionLoading: false }),
}))

import type { ItemTemplate } from './itemTemplate'
import { ListView } from './ListView'

const actions = {
  navigate: [
    { id: 'primary', path: '/${actionPath}', type: 'navigate' },
    { id: 'details', path: '/marketplace/${name}', type: 'navigate' },
  ],
} as unknown as WidgetActions

const items = [
  { actionIcon: 'fa-download', actionLabel: 'Install', actionPath: 'marketplace/kafka/install', name: 'kafka' },
  { actionIcon: 'fa-sliders', actionLabel: 'Configure', actionPath: 'blueprints/krateo-system/redis', name: 'redis' },
  { actionIcon: '', actionLabel: '', actionPath: '', name: 'nothing' },
]

const renderCards = (rowActions: ItemTemplate['rowActions']) => render(
  <MemoryRouter>
    <App>
      <ListView
        actions={actions}
        itemTemplate={{ navigateTo: '/marketplace/{name}', primaryText: '{name}', rowActions, rowVariant: 'card' }}
        items={items}
        rowKey='row-action-label-test'
      />
    </App>
  </MemoryRouter>,
)

const cardButtons = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.ant-card')].map(
  (card) => [...card.querySelectorAll<HTMLButtonElement>('button')].map((button) => button.textContent?.trim() ?? ''),
)

describe('ListView — a card row action named from the row', () => {
  afterEach(() => {
    cleanup()
    navigateSpy.mockClear()
    handleActionSpy.mockClear()
  })

  it('resolves a {path} label per row, and leaves a row whose label resolves empty without that button', () => {
    const { container } = renderCards([
      { actionId: 'primary', icon: '{actionIcon}', label: '{actionLabel}' },
      { actionId: 'details', label: 'Details' },
    ])
    expect(cardButtons(container)).toEqual([['Install', 'Details'], ['Configure', 'Details'], ['Details']])
  })

  it('resolves the icon per row', () => {
    const { container } = renderCards([{ actionId: 'primary', icon: '{actionIcon}', label: '{actionLabel}' }])
    const icons = [...container.querySelectorAll('.ant-card')].map(
      (card) => card.querySelector('button svg')?.getAttribute('data-icon') ?? null,
    )
    expect(icons).toEqual(['download', 'sliders', null])
  })

  it('shows a static label as written on every row', () => {
    const { container } = renderCards([{ actionId: 'primary', icon: 'fa-download', label: 'Install' }])
    expect(cardButtons(container)).toEqual([['Install'], ['Install'], ['Install']])
  })

  it('fires the action once, with the row as its payload, and does not navigate the card', () => {
    const { container } = renderCards([{ actionId: 'primary', label: '{actionLabel}' }])
    const configure = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === 'Configure')
    expect(configure).toBeDefined()
    fireEvent.click(configure as HTMLButtonElement)
    expect(handleActionSpy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(handleActionSpy.mock.calls[0])).toContain('"actionPath":"blueprints/krateo-system/redis"')
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})
