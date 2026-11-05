// @vitest-environment jsdom
/**
 * frontend#182 — the composer must grow with its content, then scroll.
 *
 * jsdom does not lay text out, so `scrollHeight` is always 0 and the real growth cannot be observed
 * here. What CAN be pinned is the part that is easy to get wrong and silent when wrong: the height
 * is reset to `auto` BEFORE measuring, so the box shrinks as well as grows. Without that reset a
 * textarea's `scrollHeight` never reports smaller than its current height, and deleting text leaves
 * the composer stuck at its high-water mark.
 */
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MAX_COMPOSER_HEIGHT, useComposerAutoGrow } from './useComposerAutoGrow'

/** A textarea whose scrollHeight we control, recording every height assignment in order. */
const stubTextarea = (scrollHeight: number) => {
  const assignments: string[] = []
  const el = document.createElement('textarea')
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  const { style } = el
  Object.defineProperty(el, 'style', {
    configurable: true,
    get: () => new Proxy(style, {
      set: (target, prop, value) => {
        if (prop === 'height') { assignments.push(String(value)) }
        return Reflect.set(target, prop, value)
      },
    }),
  })
  return { assignments, el }
}

describe('useComposerAutoGrow', () => {
  it('resets to auto before measuring, so the composer can SHRINK again', () => {
    const { assignments, el } = stubTextarea(64)
    renderHook(({ value }) => useComposerAutoGrow({ current: el }, value), {
      initialProps: { value: 'one line' },
    })
    expect(assignments[0], 'measuring without resetting first can only ever grow').toBe('auto')
    expect(assignments[1]).toBe('64px')
  })

  it('caps growth at MAX_COMPOSER_HEIGHT so a long draft never crowds out the transcript', () => {
    const { assignments, el } = stubTextarea(MAX_COMPOSER_HEIGHT * 4)
    renderHook(() => useComposerAutoGrow({ current: el }, 'a very long draft'))
    expect(assignments.at(-1)).toBe(`${MAX_COMPOSER_HEIGHT}px`)
  })

  it('is inert when the ref is empty', () => {
    expect(() => renderHook(() => useComposerAutoGrow({ current: null }, 'x'))).not.toThrow()
  })
})
