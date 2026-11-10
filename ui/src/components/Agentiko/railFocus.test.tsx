// @vitest-environment jsdom
/**
 * A collapsed rail is out of the tab order, and collapsing hands focus to the toggle (audit X4 K2,
 * K3).
 *
 * The audit found the collapsed rail's 10 controls still in the tab order on every page (its aside
 * is 0 px wide but was neither inert nor hidden), and Escape leaving focus in the composer, now off
 * screen. These tests mount the header toggle, a page control and the rail together, with the open
 * state held for real, and drive them with user-event:
 *   - collapsed, the rail (live or locked) has 0 tab stops and is inert, and it has controls, so
 *     the count is not vacuous;
 *   - Escape in the composer, the Collapse button, and ⌘G from the composer each leave focus on
 *     the toggle;
 *   - ⌘G with focus on the page leaves focus on the page (the control arm: the hand-off is only
 *     for focus that was in the rail).
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { tabbableIn } from '../../utils/focus'

vi.mock('../../context/ConfigContext', () => ({ useConfigContext: () => ({ config: { api: {} } }) }))
vi.mock('./AgentikoTour', () => ({ default: () => null }))
vi.mock('./AgentikoProvider', () => ({ useAgentiko: vi.fn() }))

import { useAgentiko } from './AgentikoProvider'
import AgentikoRail from './AgentikoRail'
import AgentikoToggle from './AgentikoToggle'
import { useAgentikoShortcut } from './keyboardShortcut'
import type { ThreadSummary } from './sessionHistoryStore'
import type { AgentikoMessage } from './types'

const mockedUseAgentiko = vi.mocked(useAgentiko)

const baseValue = {
  approvePending: vi.fn(),
  attachOasDocument: vi.fn(),
  checking: false,
  clearOasAttachment: vi.fn(),
  closeTour: vi.fn(),
  collect: vi.fn(() => ({ focus: 'Home', route: '/', widgets: [] })),
  denyPending: vi.fn(),
  enabled: true,
  licensed: true,
  messages: [] as AgentikoMessage[],
  newThread: vi.fn(),
  oasAttachment: null,
  open: false,
  pendingApproval: null,
  reachable: true,
  restored: false,
  retryClaims: vi.fn(),
  send: vi.fn(),
  sessionId: 's-current',
  sessions: vi.fn((): ThreadSummary[] => []),
  setOpen: vi.fn(),
  stop: vi.fn(),
  streaming: false,
  switchToThread: vi.fn(),
  toggle: vi.fn(),
  tour: null,
  tourOpen: false,
}

/** The shell in miniature: the header toggle, a page control and the rail, sharing a real `open`
 * state and the real ⌘G handler, as AgentikoProvider wires them. */
const Shell = ({ initiallyOpen, licensed = true }: { initiallyOpen: boolean; licensed?: boolean }) => {
  const [open, setOpen] = useState(initiallyOpen)
  const toggle = useCallback(() => setOpen((prev) => !prev), [])
  useAgentikoShortcut(true, toggle)
  mockedUseAgentiko.mockReturnValue({ ...baseValue, licensed, open, setOpen, toggle })
  return (
    <>
      <AgentikoToggle />
      <main><button type='button'>Page action</button></main>
      <AgentikoRail />
    </>
  )
}

const rail = () => document.querySelector('aside')!
const toggleButton = () => screen.getByRole('button', { name: /Agentiko/ })

beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
    writable: true,
  })
})

afterEach(() => {
  cleanup()
})

describe('collapsed rail — out of the tab order (X4 K2)', () => {
  it('has no tab stops and is inert when collapsed', () => {
    render(<Shell initiallyOpen={false} />)

    // The controls are still mounted (the rail closes to width 0), so 0 stops means they are excluded.
    expect(rail().querySelectorAll('button, textarea').length).toBeGreaterThan(5)
    expect(tabbableIn(rail())).toHaveLength(0)
    expect(rail().hasAttribute('inert')).toBe(true)
  })

  it('the locked licence rail too', () => {
    render(<Shell initiallyOpen={false} licensed={false} />)

    expect(rail().querySelectorAll('a[href], button').length).toBeGreaterThan(0)
    expect(tabbableIn(rail())).toHaveLength(0)
    expect(rail().hasAttribute('inert')).toBe(true)
  })

  it('is back in the tab order when open (the control arm)', () => {
    render(<Shell initiallyOpen />)

    expect(rail().hasAttribute('inert')).toBe(false)
    expect(tabbableIn(rail()).length).toBeGreaterThan(5)
  })
})

describe('collapsing hands focus to the toggle (X4 K3)', () => {
  it('Escape in the composer', async () => {
    render(<Shell initiallyOpen />)
    const user = userEvent.setup()
    const composer = screen.getByPlaceholderText('Ask Agentiko to do something…')
    expect(document.activeElement).toBe(composer)

    await user.keyboard('{Escape}')

    expect(document.activeElement).toBe(toggleButton())
    expect(toggleButton().getAttribute('aria-pressed')).toBe('false')
  })

  it('the Collapse button, pressed from the keyboard', async () => {
    render(<Shell initiallyOpen />)
    const user = userEvent.setup()
    screen.getByRole('button', { name: 'Collapse rail' }).focus()

    await user.keyboard('{Enter}')

    expect(document.activeElement).toBe(toggleButton())
    expect(toggleButton().getAttribute('aria-pressed')).toBe('false')
  })

  it('the locked rail\'s Collapse button', async () => {
    render(<Shell initiallyOpen licensed={false} />)
    const user = userEvent.setup()
    screen.getByRole('button', { name: 'Collapse rail' }).focus()

    await user.keyboard('{Enter}')

    const lockedToggle = screen.getByRole('button', { name: /Agentiko — locked/ })
    expect(document.activeElement).toBe(lockedToggle)
    expect(lockedToggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('⌘G from the composer', async () => {
    render(<Shell initiallyOpen />)
    const user = userEvent.setup()

    await user.keyboard('{Meta>}g{/Meta}')

    expect(document.activeElement).toBe(toggleButton())
    expect(toggleButton().getAttribute('aria-pressed')).toBe('false')
  })

  it('⌘G with focus on the page leaves it there', async () => {
    render(<Shell initiallyOpen />)
    const user = userEvent.setup()
    const pageAction = screen.getByRole('button', { name: 'Page action' })
    act(() => { pageAction.focus() })

    await user.keyboard('{Meta>}g{/Meta}')

    expect(document.activeElement).toBe(pageAction)
    expect(toggleButton().getAttribute('aria-pressed')).toBe('false')
  })
})
