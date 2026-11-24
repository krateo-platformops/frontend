// @vitest-environment jsdom
/**
 * The composer's guide (spec.portal.guideCard): mounted from the portal's Card, in the chrome scope,
 * hidden and shown again per Builder, and absent when the Builder names none.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FiltersProvider from '../../components/FiltesProvider/FiltersProvider'
import { ConfigContext } from '../../context/ConfigContext'

// What the guide mounted, and in which scope: the double reads the scope as a widget would.
const mounted = vi.hoisted((): { endpoint: string; scope: string }[] => [])
vi.mock('../../components/WidgetRenderer', async () => {
  const { useWidgetScope } = await import('../../context/WidgetScopeContext')
  const WidgetRendererDouble = ({ widgetEndpoint }: { widgetEndpoint: string }) => {
    mounted.push({ endpoint: widgetEndpoint, scope: useWidgetScope() })
    return <div data-testid='guide-card'>{widgetEndpoint}</div>
  }
  return { default: WidgetRendererDouble }
})

import { BuilderGuide, guideEndpoint, guideHiddenKey } from './BuilderGuide'

const withConfig = (node: React.ReactNode) => (
  // Only what the guide reads: the frontend's namespace, for a guide that names none, under the
  // FiltersProvider the app mounts at its root.
  <ConfigContext.Provider value={{ config: { params: { FRONTEND_NAMESPACE: 'krateo-system' } } } as never}>
    <FiltersProvider>{node}</FiltersProvider>
  </ConfigContext.Provider>
)

beforeEach(() => {
  mounted.length = 0
  window.localStorage.clear()
})
afterEach(cleanup)

describe('BuilderGuide', () => {
  it('reads the Card the Builder names, in its namespace or the frontend\'s', () => {
    expect(guideEndpoint({ name: 'portal-builder-guide', namespace: 'builders-page' }, 'krateo-system'))
      .toBe('/call?resource=cards&apiVersion=widgets.templates.krateo.io/v1beta1&name=portal-builder-guide&namespace=builders-page')
    expect(guideEndpoint({ name: 'g' }, 'krateo-system')).toContain('&namespace=krateo-system')
    expect(guideEndpoint({ name: 'g' }, undefined)).toBeNull()
  })

  it('draws nothing, and fetches nothing, for a Builder with no guide', () => {
    const { container } = render(withConfig(<BuilderGuide builderName='portal-builder' />))
    expect(container.innerHTML).toBe('')
    expect(mounted).toEqual([])
  })

  it('mounts the guide Card in the chrome scope, so the composer\'s query never reaches it', () => {
    render(withConfig(<BuilderGuide builderName='portal-builder' guide={{ name: 'portal-builder-guide', namespace: 'builders-page' }} />))
    expect(screen.getByTestId('guide-card')).toBeTruthy()
    expect(mounted[0]).toEqual({
      endpoint: '/call?resource=cards&apiVersion=widgets.templates.krateo.io/v1beta1&name=portal-builder-guide&namespace=builders-page',
      scope: 'chrome',
    })
  })

  it('hides for this Builder, remembers it, and comes back', () => {
    const guide = { name: 'portal-builder-guide', namespace: 'builders-page' }
    render(withConfig(<BuilderGuide builderName='portal-builder' guide={guide} />))
    fireEvent.click(screen.getByRole('button', { name: 'Hide guide' }))
    expect(screen.queryByTestId('guide-card')).toBeNull()
    expect(window.localStorage.getItem(guideHiddenKey('portal-builder'))).toBe('true')
    cleanup()

    // Another visit: still hidden, for this Builder only.
    render(withConfig(<BuilderGuide builderName='portal-builder' guide={guide} />))
    expect(screen.queryByTestId('guide-card')).toBeNull()
    render(withConfig(<BuilderGuide builderName='blueprint-builder' guide={{ name: 'blueprint-builder-guide' }} />))
    expect(screen.getAllByTestId('guide-card')).toHaveLength(1)
    cleanup()

    render(withConfig(<BuilderGuide builderName='portal-builder' guide={guide} />))
    fireEvent.click(screen.getByRole('button', { name: 'Show how it gets built' }))
    expect(screen.getByTestId('guide-card')).toBeTruthy()
    expect(window.localStorage.getItem(guideHiddenKey('portal-builder'))).toBeNull()
  })

  it('draws nothing outside the app\'s providers, where no widget can render', () => {
    const { container } = render(<BuilderGuide builderName='portal-builder' guide={{ name: 'g', namespace: 'ns' }} />)
    expect(container.innerHTML).toBe('')
    expect(mounted).toEqual([])
  })

  it('shows the guide when the storage throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    render(withConfig(<BuilderGuide builderName='portal-builder' guide={{ name: 'g', namespace: 'ns' }} />))
    expect(screen.getByTestId('guide-card')).toBeTruthy()
    getItem.mockRestore()
  })
})
