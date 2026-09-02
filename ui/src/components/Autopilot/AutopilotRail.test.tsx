// @vitest-environment jsdom
/**
 * Autopilot rail — session-history UI (Vincenzo item P, split-view iteration):
 *   - the history toggle (provider-owned `historyOpen`/`toggleHistory`) shows a persistent
 *     column listing PAST (archived) threads (title + relative time), docked beside the
 *     transcript rather than a popover — it stays open across a thread switch;
 *   - an empty history shows the honest "no past conversations yet" note;
 *   - picking a row calls switchToThread(sessionId);
 *   - the restored-thread state renders the "viewing a past conversation" hint.
 * The rail reads everything through useAutopilot — stubbed here so the test drives the UI, not A2A.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// The DelegationRow reads config; the rail never renders it in these transcripts, but the hook must
// not throw. AutopilotTour (imported by the module) is stubbed to keep the mount focused.
vi.mock('../../context/ConfigContext', () => ({ useConfigContext: () => ({ config: { api: {} } }) }))
vi.mock('./AutopilotTour', () => ({ default: () => null }))

import { useAutopilot } from './AutopilotProvider'
import AutopilotRail from './AutopilotRail'
import type { ThreadSummary } from './sessionHistoryStore'
import type { AutopilotMessage } from './types'

vi.mock('./AutopilotProvider', () => ({ useAutopilot: vi.fn() }))

const mockedUseAutopilot = vi.mocked(useAutopilot)

const baseValue = {
  approvePending: vi.fn(),
  attachOasDocument: vi.fn(),
  clearOasAttachment: vi.fn(),
  closeTour: vi.fn(),
  collect: vi.fn(() => ({ focus: 'Home', route: '/', widgets: [] })),
  denyPending: vi.fn(),
  enabled: true,
  messages: [] as AutopilotMessage[],
  newThread: vi.fn(),
  oasAttachment: null,
  open: true,
  pendingApproval: null,
  reachable: true,
  restored: false,
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

const setValue = (overrides: Partial<typeof baseValue>) => {
  mockedUseAutopilot.mockReturnValue({ ...baseValue, ...overrides } as unknown as ReturnType<typeof useAutopilot>)
}

beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const SESSIONS: ThreadSummary[] = [
  { messageCount: 4, sessionId: 's-1', title: 'How do I scale my app?', updatedAt: Date.now() - 5 * 60_000 },
  { messageCount: 2, sessionId: 's-2', title: 'What is a composition?', updatedAt: Date.now() - 3 * 3_600_000 },
]

describe('history column (split view)', () => {
  // The column is now ALWAYS mounted (open drives a width-only CSS transition, in sync with
  // the rail's own width animation — see the AutopilotRail.tsx comment on HistoryColumn), so
  // "closed" is asserted via aria-hidden rather than DOM absence.
  it('opens the column and lists past threads (title + relative time)', () => {
    setValue({ sessions: vi.fn(() => SESSIONS) })
    const { getByTestId, getByText } = render(<AutopilotRail />)
    // Closed by default.
    expect(getByTestId('autopilot-history-panel').getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(getByTestId('autopilot-history-toggle'))
    expect(getByTestId('autopilot-history-panel').getAttribute('aria-hidden')).toBe('false')
    expect(getByText('How do I scale my app?')).toBeTruthy()
    expect(getByText('What is a composition?')).toBeTruthy()
    // Relative time + message count metadata is shown.
    expect(getByText(/5m ago · 4 msgs/)).toBeTruthy()
  })

  it('shows the honest empty note when there is no history', () => {
    setValue({ sessions: vi.fn(() => []) })
    const { getByTestId, getByText } = render(<AutopilotRail />)
    fireEvent.click(getByTestId('autopilot-history-toggle'))
    expect(getByText(/No past conversations yet/)).toBeTruthy()
  })

  it('switches to the selected thread on click and stays open (split view browses, not a menu)', () => {
    const switchToThread = vi.fn()
    setValue({ sessions: vi.fn(() => SESSIONS), switchToThread })
    const { getByTestId, getByText } = render(<AutopilotRail />)
    fireEvent.click(getByTestId('autopilot-history-toggle'))
    fireEvent.click(getByText('What is a composition?'))
    expect(switchToThread).toHaveBeenCalledWith('s-2')
    // Unlike the old popover, selecting a thread does not close the column.
    expect(getByTestId('autopilot-history-panel').getAttribute('aria-hidden')).toBe('false')
  })

  it('collapses the column when the toggle is clicked again', () => {
    setValue({ sessions: vi.fn(() => SESSIONS) })
    const { getByTestId } = render(<AutopilotRail />)
    fireEvent.click(getByTestId('autopilot-history-toggle'))
    expect(getByTestId('autopilot-history-panel').getAttribute('aria-hidden')).toBe('false')
    fireEvent.click(getByTestId('autopilot-history-toggle'))
    expect(getByTestId('autopilot-history-panel').getAttribute('aria-hidden')).toBe('true')
  })
})

describe('restored-thread hint', () => {
  it('shows the "viewing a past conversation" hint when restored', () => {
    setValue({ messages: [{ createdAt: 1, id: 'u1', role: 'user' as const, text: 'old question' }], restored: true })
    const { getByTestId } = render(<AutopilotRail />)
    expect(getByTestId('autopilot-restored-hint').textContent).toMatch(/Viewing a past conversation/)
  })

  it('hides the hint on a live thread', () => {
    setValue({ restored: false })
    const { queryByTestId } = render(<AutopilotRail />)
    expect(queryByTestId('autopilot-restored-hint')).toBeNull()
  })
})

describe('switching loads the selected transcript into the rail', () => {
  it('renders the restored transcript that the provider swaps in', () => {
    // First render: on thread B. The history panel offers thread A.
    setValue({ messages: [{ createdAt: 1, id: 'b1', role: 'user' as const, text: 'thread B question' }], sessions: vi.fn(() => SESSIONS) })
    const { getByText, queryByText, rerender } = render(<AutopilotRail />)
    expect(getByText('thread B question')).toBeTruthy()

    // The provider (mocked) swaps in thread A's transcript + marks it restored — the rail reflects it.
    setValue({ messages: [{ createdAt: 1, id: 'a1', role: 'user' as const, text: 'thread A question' }], restored: true, sessionId: 's-1' })
    rerender(<AutopilotRail />)
    expect(getByText('thread A question')).toBeTruthy()
    expect(queryByText('thread B question')).toBeNull()
  })
})
