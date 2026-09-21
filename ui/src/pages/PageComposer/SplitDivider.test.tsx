// @vitest-environment jsdom
/**
 * The resizer between the canvas and the preview.
 *
 * The behaviour worth pinning is not "it drags" — it is that the handle is OPERABLE WITHOUT A
 * POINTER and cannot be driven to a state where one pane has vanished. A divider that only answers
 * to a pointer is the same WCAG 2.5.7 failure the canvas already had to fix once, and a divider
 * that can be slammed to 0 leaves someone staring at a pane they cannot get back.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clampSplit, MAX_SPLIT, MIN_SPLIT, SplitDivider, splitFromPointer } from './SplitDivider'

afterEach(cleanup)

describe('clampSplit', () => {
  it('keeps both panes present at the extremes', () => {
    expect(clampSplit(-40)).toBe(MIN_SPLIT)
    expect(clampSplit(140)).toBe(MAX_SPLIT)
  })

  it('rounds, because the value is written into a percentage', () => {
    expect(clampSplit(61.4)).toBe(61)
  })
})

describe('splitFromPointer', () => {
  it('reads the pointer as a share of the column it is dragging inside', () => {
    expect(splitFromPointer(300, { height: 400, top: 100 })).toBe(50)
    expect(splitFromPointer(200, { height: 400, top: 100 })).toBe(25)
  })

  it('does not divide by a zero-height column — it answers the floor instead of NaN', () => {
    // A column measured before layout has height 0, and NaN written into a CSS percentage kills the
    // whole declaration, collapsing the pane rather than leaving it where it was.
    expect(splitFromPointer(300, { height: 0, top: 0 })).toBe(MIN_SPLIT)
  })
})

describe('SplitDivider', () => {
  const setup = (value = 60) => {
    const onChange = vi.fn()
    render(<SplitDivider onChange={onChange} value={value} />)
    return { handle: screen.getByTestId('composer-split'), onChange }
  }

  it('is a focusable separator that announces its value', () => {
    const { handle } = setup(60)
    expect(handle.getAttribute('role')).toBe('separator')
    expect(handle.getAttribute('tabindex')).toBe('0')
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal')
    expect(handle.getAttribute('aria-valuenow')).toBe('60')
    expect(handle.getAttribute('aria-label')).toBeTruthy()
  })

  it('nudges with the arrow keys, in both directions', () => {
    const { handle, onChange } = setup(60)
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith(64)
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith(56)
  })

  it('slams to the BOUNDS with Home/End — never past them', () => {
    const { handle, onChange } = setup(60)
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith(MIN_SPLIT)
    fireEvent.keyDown(handle, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith(MAX_SPLIT)
  })

  it('clamps a nudge that would push a pane out of existence', () => {
    const { handle, onChange } = setup(MAX_SPLIT)
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith(MAX_SPLIT)
  })

  it('ignores keys it does not own, so typing elsewhere is not swallowed', () => {
    const { handle, onChange } = setup()
    fireEvent.keyDown(handle, { key: 'a' })
    fireEvent.keyDown(handle, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })
})
