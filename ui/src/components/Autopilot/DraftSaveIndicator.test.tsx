// @vitest-environment jsdom
/**
 * The composer header's autosave status. Pinned: exactly three things are ever said — Saving…,
 * Saved · HH:MM (with the check), Not saved — <reason> — and nothing before the first save, with no
 * sandbox, or about a draft of the other kind. And the Close-draft confirm may promise the draft is
 * kept only when a record is being kept.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import DraftSaveIndicator, { saveIndicatorText, savedClock } from './DraftSaveIndicator'
import { draftKeptOnClose, draftSaveStatus } from './draftSaveStatus'

const AT = '2026-09-29T10:02:00Z'

afterEach(() => {
  cleanup()
  draftSaveStatus.reset()
})

describe('saveIndicatorText', () => {
  it('says each state, and only for its own kind', () => {
    expect(saveIndicatorText({ kind: 'blueprint', phase: 'saving' }, 'blueprint')).toBe('Saving…')
    expect(saveIndicatorText({ kind: 'blueprint', phase: 'saved', savedAt: AT }, 'blueprint')).toBe(`Saved · ${savedClock(AT)}`)
    expect(saveIndicatorText({ kind: 'blueprint', phase: 'error', reason: 'configmaps is forbidden' }, 'blueprint'))
      .toBe('Not saved — configmaps is forbidden')
    expect(saveIndicatorText({ kind: 'page', phase: 'saved', savedAt: AT }, 'blueprint')).toBeNull()
    expect(saveIndicatorText({ kind: 'blueprint', phase: 'idle' }, 'blueprint')).toBeNull()
    expect(saveIndicatorText({ phase: 'off' }, 'blueprint')).toBeNull()
  })

  it('the clock is HH:MM, zero-padded', () => {
    expect(savedClock(AT)).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('<DraftSaveIndicator>', () => {
  it('follows the status as it moves, and shows nothing when autosave is off', () => {
    const { container } = render(<DraftSaveIndicator kind='page' />)
    expect(container.textContent).toBe('')
    act(() => { draftSaveStatus.set({ kind: 'page', phase: 'saving' }) })
    expect(screen.getByRole('status').textContent).toBe('Saving…')
    act(() => { draftSaveStatus.set({ kind: 'page', phase: 'saved', savedAt: AT }) })
    expect(screen.getByRole('status').textContent).toBe(`Saved · ${savedClock(AT)}`)
    expect(screen.getByRole('status').querySelector('.anticon-check')).not.toBeNull()
    act(() => { draftSaveStatus.set({ kind: 'page', phase: 'error', reason: 'HTTP 500' }) })
    expect(screen.getByRole('status').textContent).toBe('Not saved — HTTP 500')
    act(() => { draftSaveStatus.set({ phase: 'off' }) })
    expect(container.textContent).toBe('')
  })
})

describe('draftKeptOnClose', () => {
  it('promises a kept draft only while its record is being kept', () => {
    expect(draftKeptOnClose({ kind: 'blueprint', phase: 'saved', savedAt: AT }, 'blueprint')).toBe(true)
    expect(draftKeptOnClose({ kind: 'blueprint', phase: 'idle' }, 'blueprint')).toBe(true)
    expect(draftKeptOnClose({ kind: 'blueprint', phase: 'error', reason: 'x' }, 'blueprint')).toBe(false)
    expect(draftKeptOnClose({ phase: 'off' }, 'blueprint')).toBe(false)
    expect(draftKeptOnClose({ kind: 'page', phase: 'saved' }, 'blueprint')).toBe(false)
  })
})
