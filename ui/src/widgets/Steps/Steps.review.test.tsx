// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { setFormReviewing } from '../Form/reviewPhase'

import Steps from './Steps'

/**
 * The create wizard's header ("Step 1 · Blueprint / Step 2 · Configure / Step 3 · Review") is a
 * Steps widget with a static `current`, and the review is the Form's own in-place state. The
 * header said "Step 2 · Configure" while the page showed the review. `reviewCurrent` joins them.
 */
const items = [{ title: 'Blueprint' }, { title: 'Configure' }, { title: 'Review' }]
const activeTitle = (container: HTMLElement) =>
  container.querySelector('.ant-steps-item-process .ant-steps-item-title')?.textContent

describe('Steps — follows a Form review (reviewCurrent)', () => {
  // antd's responsive observer reads matchMedia, which jsdom does not implement.
  beforeAll(() => {
    const noop = () => undefined
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        addEventListener: noop,
        addListener: noop,
        dispatchEvent: () => false,
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: noop,
        removeListener: noop,
      }),
      writable: true,
    })
  })
  afterEach(() => {
    act(() => { setFormReviewing('f1', false) })
    cleanup()
  })

  it('shows the review step while a Form on the page reviews, and returns when it stops', () => {
    const { container } = render(<Steps resourcesRefs={{ items: [] }} uid='s1' widget={{} as never} widgetData={{ current: 1, items, reviewCurrent: 2 }} />)
    expect(activeTitle(container)).toBe('Configure')

    act(() => { setFormReviewing('f1', true) })
    expect(activeTitle(container)).toBe('Review')

    act(() => { setFormReviewing('f1', false) })
    expect(activeTitle(container)).toBe('Configure')
  })

  it('without reviewCurrent, a review changes nothing', () => {
    const { container } = render(<Steps resourcesRefs={{ items: [] }} uid='s2' widget={{} as never} widgetData={{ current: 1, items }} />)
    act(() => { setFormReviewing('f1', true) })
    expect(activeTitle(container)).toBe('Configure')
  })
})
