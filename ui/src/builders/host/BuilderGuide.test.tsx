// @vitest-environment jsdom
/**
 * The builder's guide (spec.guide): drawn from the Builder alone, hidden and shown again per Builder,
 * and absent when the Builder has none. Rendered with no provider at all: it reads nothing.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BuilderGuideSpec } from '../builderSpec'

import { BuilderGuide, guideHiddenKey } from './BuilderGuide'

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

const guide: BuilderGuideSpec = {
  steps: [
    { description: 'Name the page.', icon: 'fa-file-circle-plus', title: 'Start a draft' },
    { description: 'It opens a change request.', title: 'Publish' },
  ],
  title: 'How a page gets built',
}
const card = () => screen.queryByRole('region', { name: 'How it gets built' })

beforeEach(() => { window.localStorage.clear() })
afterEach(cleanup)

describe('BuilderGuide', () => {
  it('draws the title and the numbered steps, in order', () => {
    render(<BuilderGuide builderName='portal-builder' guide={guide} />)
    expect(within(card()!).getByText('How a page gets built')).toBeTruthy()
    const text = card()!.textContent ?? ''
    const order = ['Step 1', 'Start a draft', 'Name the page.', 'Step 2', 'Publish', 'It opens a change request.'].map((part) => text.indexOf(part))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((left, right) => left - right)).toEqual(order)
  })

  it('draws nothing for a Builder with no guide', () => {
    const { container } = render(<BuilderGuide builderName='portal-builder' />)
    expect(container.innerHTML).toBe('')
  })

  it('hides for this Builder, remembers it, and comes back', () => {
    render(<BuilderGuide builderName='portal-builder' guide={guide} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide guide' }))
    expect(card()).toBeNull()
    expect(window.localStorage.getItem(guideHiddenKey('portal-builder'))).toBe('true')
    cleanup()

    // Another visit: still hidden, for this Builder only.
    render(<BuilderGuide builderName='portal-builder' guide={guide} />)
    expect(card()).toBeNull()
    render(<BuilderGuide builderName='blueprint-builder' guide={guide} />)
    expect(card()).not.toBeNull()
    cleanup()

    render(<BuilderGuide builderName='portal-builder' guide={guide} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show how it gets built' }))
    expect(card()).not.toBeNull()
    expect(window.localStorage.getItem(guideHiddenKey('portal-builder'))).toBeNull()
  })

  it('shows the guide when the storage throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    render(<BuilderGuide builderName='portal-builder' guide={guide} />)
    expect(card()).not.toBeNull()
    getItem.mockRestore()
  })
})
