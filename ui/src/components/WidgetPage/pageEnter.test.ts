// @vitest-environment jsdom
/** M3 (approved motion set): a page change fades the content area in; reduced motion skips it. */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { playPageEnter } from './WidgetPage'

const motion = (reduce: boolean) => { window.matchMedia = ((query: string) => ({ matches: reduce && query.includes('reduce'), media: query })) as unknown as typeof window.matchMedia }

afterEach(() => { vi.restoreAllMocks() })

describe('playPageEnter', () => {
  it('fades the content area in with a 4px rise', () => {
    motion(false)
    const area = document.createElement('div')
    const animate = vi.fn()
    area.animate = animate
    playPageEnter(area)
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate.mock.calls[0][0]).toEqual([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }])
  })

  it('does nothing under reduced motion', () => {
    motion(true)
    const area = document.createElement('div')
    const animate = vi.fn()
    area.animate = animate
    playPageEnter(area)
    expect(animate).not.toHaveBeenCalled()
  })

  it('does nothing without an element or without the Web Animations API', () => {
    motion(false)
    expect(() => { playPageEnter(null) }).not.toThrow()
    const area = document.createElement('div')
    Object.defineProperty(area, 'animate', { value: undefined })
    expect(() => { playPageEnter(area) }).not.toThrow()
  })
})
