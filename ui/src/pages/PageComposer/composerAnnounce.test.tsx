// @vitest-environment jsdom
/**
 * WCAG 4.1.3 — status messages. The composer performed every structural edit in silence.
 *
 * A drag has its own feedback: the canvas redraws and you watch it. The TREE is the route for
 * anyone not using a pointer, and pressing "Move card-b up" produced no message, no focus change
 * and no announcement — the tree simply re-rendered. So the keyboard route existed in the sense
 * that the controls could be reached and not in the sense that anyone could use it.
 */
import { act, cleanup, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { emit, held, installAntdShims, mount, widgetCr } from './composerTestHarness'

afterEach(cleanup)
beforeAll(installAntdShims)

const announced = () => screen.getByTestId('composer-announce').textContent

const openDraft = () => {
  mount()
  emit({
    files: [
      { content: widgetCr('Flex', 'page-x', ['first', 'second']), path: 'templates/flex.page-x.yaml' },
    ],
    title: 'x',
  })
  held({ 'templates/flex.page-x.yaml': widgetCr('Flex', 'page-x', ['first', 'second']) })
}

describe('the composer says what happened', () => {
  it('has a live region BEFORE the first edit, not appearing with it', () => {
    // Assistive technology watches a region it has already seen; one that appears at the same
    // moment as its first message is commonly missed entirely.
    mount()
    const region = screen.getByTestId('composer-announce')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.getAttribute('role')).toBe('status')
  })

  it('announces a move made from the TREE — the route with no other feedback', () => {
    vi.useFakeTimers()
    openDraft()
    act(() => { screen.getByLabelText('Move second up').click() })
    act(() => { vi.runOnlyPendingTimers() })
    expect(announced()).toBe('Moved second up')
    vi.useRealTimers()
  })

  it('announces a REFUSAL too — silence that means "it worked" and silence that means "it did not" are the same silence', () => {
    vi.useFakeTimers()
    openDraft()
    // The first child cannot move up: there is nothing above it.
    act(() => { screen.getByLabelText('Move first up').click() })
    act(() => { vi.runOnlyPendingTimers() })
    expect(announced()).toMatch(/^Not done: /)
    vi.useRealTimers()
  })

  it('puts focus BACK on the control that was pressed', () => {
    /*
     * Measured before this: after a tree edit document.activeElement was BODY, and returning to the
     * same button took seventeen tabs in a three-object draft — so one drag-equivalent cost about a
     * hundred keystrokes. Restored by aria-label, because the node objects are rebuilt from the
     * draft's bytes on every render and there is no stable reference to hold.
     */
    vi.useFakeTimers()
    openDraft()
    const button = screen.getByLabelText('Move second up')
    act(() => {
      button.focus()
      button.click()
    })
    act(() => { vi.runOnlyPendingTimers() })
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Move second up')
    vi.useRealTimers()
  })
})
