// @vitest-environment jsdom
/**
 * R2 (WCAG 1.4.10, design/audits/x4-wcag21aa-2026-11.md §6): docked beside the page, the open
 * rail left the page 148 px at 768 px and 64 px at 390 px. By antd breakpoint (railLayout.ts):
 *
 *   ≥ 992 px   docked beside the page, as before (the control in every block below)
 *   768–991    a sheet over the page from the right, the page dimmed and inert, focus held in the
 *              sheet; Escape or its ✕ hands focus back to the header toggle
 *   < 768 px   the whole width, live or locked
 *
 * Widths come from a matchMedia that answers for the viewport (src/test/viewportWidth.ts).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setViewportWidth } from '../../test/viewportWidth'

import type * as VoiceControl from './voice/VoiceControl'

vi.mock('../../context/ConfigContext', () => ({ useConfigContext: () => ({ config: { api: {} } }) }))
vi.mock('./AgentikoTour', () => ({ default: () => null }))
vi.mock('./AgentikoProvider', () => ({ useAgentiko: vi.fn() }))
// The microphone renders only where dictation is available (secure context, a transcription
// endpoint, a recorder); stood in here so the test can see WHERE the composer puts it.
vi.mock('./voice/VoiceControl', async (importOriginal) => ({
  ...await importOriginal<typeof VoiceControl>(),
  VoiceButton: () => <button aria-label='Start dictation' type='button' />,
}))

const { useAgentiko } = await import('./AgentikoProvider')
const { AgentikoShell, default: AgentikoRail } = await import('./AgentikoRail')
const { default: AgentikoToggle } = await import('./AgentikoToggle')

const setOpen = vi.fn()

const value = (open: boolean, licensed = true): ReturnType<typeof useAgentiko> => ({
  approvePending: vi.fn(),
  attachOasDocument: vi.fn(),
  checking: false,
  clearOasAttachment: vi.fn(),
  closeTour: vi.fn(),
  collect: vi.fn(() => ({ focus: 'Home', route: '/', widgets: [] })),
  denyPending: vi.fn(),
  enabled: true,
  licensed,
  messages: [],
  newThread: vi.fn(),
  oasAttachment: null,
  open,
  pendingApproval: null,
  reachable: true,
  restored: false,
  retryClaims: vi.fn(),
  send: vi.fn(),
  sessionId: 's-current',
  sessions: vi.fn(() => []),
  setOpen,
  stop: vi.fn(),
  streaming: false,
  switchToThread: vi.fn(),
  toggle: vi.fn(),
  tour: null,
  tourOpen: false,
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const at = (width: number, open = true, licensed = true) => {
  setViewportWidth(width)
  vi.mocked(useAgentiko).mockReturnValue(value(open, licensed))
}

const shellTree = () => (
  <AgentikoShell>
    <header><AgentikoToggle /></header>
    <main><a href='/compositions'>a link on the page</a></main>
  </AgentikoShell>
)

const renderShellAt = (width: number, open = true) => {
  at(width, open)
  const view = render(shellTree())
  return {
    ...view,
    close: () => { at(width, false); view.rerender(shellTree()) },
    page: () => view.container.querySelector('main')!.parentElement!,
    rail: () => view.container.querySelector<HTMLElement>('aside')!,
  }
}

const toggle = () => screen.getByRole('button', { name: /Agentiko/, pressed: false })

describe('R2 — a phone (< 768 px): the open rail takes the whole width', () => {
  it('390 px: full width, with no resize grip and no full-width toggle', () => {
    at(390)
    const { container } = render(<AgentikoRail />)
    expect(container.querySelector('aside')!.style.width).toBe('100%')
    expect(screen.queryByTestId('agentiko-resize-handle')).toBeNull()
    expect(screen.queryByTestId('agentiko-fullwidth-toggle'), 'nothing to toggle: it is already full width').toBeNull()
    expect(document.documentElement.style.getPropertyValue('--agentiko-rail-width')).toBe('100%')
  })

  it('390 px, not licensed: the licence panel takes the full width too', () => {
    at(390, true, false)
    const { container } = render(<AgentikoRail />)
    expect(container.querySelector('aside')!.style.width).toBe('100%')
  })

  it('1440 px (the control): docked at its own width, resizable, with the toggle', () => {
    at(1440)
    const { container } = render(<AgentikoRail />)
    expect(container.querySelector('aside')!.style.width).toBe('384px')
    expect(screen.queryByTestId('agentiko-resize-handle')).not.toBeNull()
    expect(screen.queryByTestId('agentiko-fullwidth-toggle')).not.toBeNull()
  })
})

describe('R2 — a tablet (768–991 px): the open rail is a sheet over the page', () => {
  it('900 px: a sheet at the rail\'s own width, over a dimmed, inert page', () => {
    const { container, page, rail } = renderShellAt(900)
    expect(rail().className).toMatch(/sheet/)
    expect(rail().style.width).toBe('384px')
    expect(page().hasAttribute('inert'), 'the page is out of reach of the keyboard and assistive tech').toBe(true)
    expect(container.querySelector('[data-testid="agentiko-sheet-scrim"]'), 'the page is dimmed').not.toBeNull()
  })

  it('768 px is a tablet too (antd `md` is inclusive)', () => {
    const { page, rail } = renderShellAt(768)
    expect(rail().className).toMatch(/sheet/)
    expect(page().hasAttribute('inert')).toBe(true)
  })

  it('1440 px (the control): docked, the page live and undimmed', () => {
    const { container, page, rail } = renderShellAt(1440)
    expect(rail().className).not.toMatch(/sheet/)
    expect(page().hasAttribute('inert')).toBe(false)
    expect(container.querySelector('[data-testid="agentiko-sheet-scrim"]')).toBeNull()
  })

  it('900 px, rail closed (the control): the page is live', () => {
    const { page } = renderShellAt(900, false)
    expect(page().hasAttribute('inert')).toBe(false)
  })

  it('focus moves into the sheet on open, to the composer', () => {
    renderShellAt(900)
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Ask Agentiko to do something…'))
  })

  it('focus stays in the sheet: Tab from its last control wraps to its first', () => {
    const { rail } = renderShellAt(900)
    const focusable = rail().querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), a[href]')
    act(() => { focusable[focusable.length - 1].focus() })
    fireEvent.keyDown(rail(), { key: 'Tab' })
    expect(document.activeElement).toBe(focusable[0])
    expect(rail().contains(document.activeElement)).toBe(true)
  })

  it('the header carries a visible ✕ that closes it (and no "collapse")', () => {
    renderShellAt(900)
    fireEvent.click(screen.getByRole('button', { name: 'Close Agentiko' }))
    expect(setOpen).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('button', { name: 'Collapse rail' })).toBeNull()
  })

  it('Escape closes it and focus goes back to the Agentiko toggle', () => {
    const { close, rail } = renderShellAt(900)
    fireEvent.keyDown(rail(), { key: 'Escape' })
    expect(setOpen).toHaveBeenCalledWith(false)
    close()
    expect(document.activeElement).toBe(toggle())
  })

  it('the ✕ closes it and focus goes back to the Agentiko toggle', () => {
    const { close } = renderShellAt(900)
    const closeButton = screen.getByRole('button', { name: 'Close Agentiko' })
    act(() => { closeButton.focus() })
    fireEvent.click(closeButton)
    close()
    expect(document.activeElement).toBe(toggle())
  })

  it('the composer keeps the microphone beside Send', () => {
    renderShellAt(900)
    const mic = screen.getByRole('button', { name: 'Start dictation' })
    expect(mic.nextElementSibling).toBe(screen.getByRole('button', { name: 'Send' }))
  })
})
