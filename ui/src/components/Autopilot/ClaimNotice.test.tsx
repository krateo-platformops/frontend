// @vitest-environment jsdom
/**
 * The claim notice in the rail. The provider stamps `claims` on an assistant message (claimCheck.ts);
 * the rail must render the notice UNDER the reply, leave the reply's text exactly as the model wrote
 * it, show nothing for a message without claims, and offer Retry only for a claim nothing backed.
 * The rail reads everything through useAutopilot — stubbed, as in AutopilotRail.test.tsx.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../context/ConfigContext', () => ({ useConfigContext: () => ({ config: { api: {} } }) }))
vi.mock('./AutopilotTour', () => ({ default: () => null }))

import { useAutopilot } from './AutopilotProvider'
import AutopilotRail from './AutopilotRail'
import { checkClaims } from './claimCheck'
import type { AutopilotMessage } from './types'

vi.mock('./AutopilotProvider', () => ({ useAutopilot: vi.fn() }))

const mockedUseAutopilot = vi.mocked(useAutopilot)

const POD_SIZING = 'I have authored and previewed the pod-sizing-23 page in the live sandbox drawer.'

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
  retryClaims: vi.fn(),
  send: vi.fn(),
  sessionId: 's-current',
  sessions: vi.fn(() => []),
  setOpen: vi.fn(),
  stop: vi.fn(),
  streaming: false,
  switchToThread: vi.fn(),
  toggle: vi.fn(),
  tour: null,
  tourOpen: false,
}

const renderWith = (messages: AutopilotMessage[], overrides: Partial<typeof baseValue> = {}) => {
  const value = { ...baseValue, messages, ...overrides }
  mockedUseAutopilot.mockReturnValue(value)
  render(<AutopilotRail />)
  return value
}

const reply = (text: string, extra: Partial<AutopilotMessage> = {}): AutopilotMessage => ({ createdAt: 1, id: 'a1', role: 'assistant', text, ...extra })

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

describe('claim notice in the rail', () => {
  it('the pod-sizing-23 reply: the text stays verbatim and the notice says no preview was produced', () => {
    renderWith([reply(POD_SIZING, { claims: checkClaims(POD_SIZING, []) })])
    expect(screen.getByText(POD_SIZING)).toBeTruthy()
    const notice = screen.getByTestId('autopilot-claim-check')
    expect(notice.textContent).toContain('Autopilot said it previewed this, but no preview was produced.')
    // Under the reply, not instead of it.
    const bubble = notice.parentElement!
    expect(bubble.textContent.indexOf(POD_SIZING)).toBeLessThan(bubble.textContent.indexOf('Autopilot said it'))
  })

  it('Retry re-asks for that message', () => {
    const value = renderWith([reply(POD_SIZING, { claims: checkClaims(POD_SIZING, []) })])
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(value.retryClaims).toHaveBeenCalledWith('a1')
  })

  it('Retry is disabled while a turn is streaming, and gone once pressed', () => {
    renderWith([reply(POD_SIZING, { claims: checkClaims(POD_SIZING, []) })], { streaming: true })
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveProperty('disabled', true)
    cleanup()
    renderWith([reply(POD_SIZING, { claimRetried: true, claims: checkClaims(POD_SIZING, []) })])
    expect(screen.getByTestId('autopilot-claim-check')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('a REFUSED preview: the notice says it did not succeed, with no Retry', () => {
    const claims = checkClaims(POD_SIZING, [{ outcome: 'refused', verb: 'previewPage' }])
    renderWith([reply(POD_SIZING, { actions: [{ label: 'preview blocked — 2 validation errors', readOnly: true, verb: 'previewPage' }], claims })])
    expect(screen.getByTestId('autopilot-claim-check').textContent).toContain('Autopilot said it previewed this, but the preview did not succeed.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('a publish the person declined says so', () => {
    const text = "I've published the page."
    renderWith([reply(text, { claims: checkClaims(text, [{ outcome: 'declined', verb: 'publishPage' }]) })])
    expect(screen.getByTestId('autopilot-claim-check').textContent).toContain('the publish was not confirmed, so nothing was published')
  })

  it('shows nothing for a reply that offers rather than claims', () => {
    const text = 'I can preview the pod-sizing-23 page for you — shall I?'
    renderWith([reply(text, { claims: checkClaims(text, []) })])
    expect(screen.getByText(text)).toBeTruthy()
    expect(screen.queryByTestId('autopilot-claim-check')).toBeNull()
  })

  it('shows nothing for a message the check never flagged', () => {
    renderWith([reply(POD_SIZING)])
    expect(screen.queryByTestId('autopilot-claim-check')).toBeNull()
  })
})
