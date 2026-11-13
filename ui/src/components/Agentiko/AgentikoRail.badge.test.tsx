// @vitest-environment jsdom
/**
 * The optional rail badge, `AGENTIKO_RAIL_BADGE`: an install-chosen label in the rail header
 * ("Staging", "Preview", "Training", "Scripted demo").
 *
 *   - Set to a non-empty string, the header shows it as a tag beside the title, and the
 *     live/streaming pill is hidden: a labelled rail does not also claim to be live.
 *   - Absent, empty or blank, the rail is exactly what it was before the key existed. The snapshot
 *     below was written by the rail as it stood BEFORE this key was added, so a change to the
 *     unbadged DOM fails here, not just a change between "absent" and "empty".
 *
 * The rail reads everything else through useAgentiko, stubbed as in AgentikoRail.test.tsx.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// The config.api the rail sees, set per render.
const { api } = vi.hoisted(() => {
  const holder: { current: Record<string, unknown> } = { current: {} }
  return { api: holder }
})

vi.mock('../../context/ConfigContext', () => ({ useConfigContext: () => ({ config: { api: api.current } }) }))
vi.mock('./AgentikoTour', () => ({ default: () => null }))
vi.mock('./AgentikoProvider', () => ({ useAgentiko: vi.fn() }))

import { useAgentiko } from './AgentikoProvider'
import AgentikoRail from './AgentikoRail'
import type { ThreadSummary } from './sessionHistoryStore'
import type { AgentikoMessage } from './types'

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
  open: true,
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

const renderRail = (config: Record<string, unknown>, overrides: Partial<typeof baseValue> = {}) => {
  api.current = config
  vi.mocked(useAgentiko).mockReturnValue({ ...baseValue, ...overrides })
  const view = render(<AgentikoRail />)
  const head = view.getByText('Agentiko', { selector: 'span' }).parentElement as HTMLElement
  // React's useId (the mark's gradient id) counts mounts across the file, so two otherwise
  // identical renders differ there and nowhere else. Normalised, so the comparison is of the DOM.
  return { head, html: view.container.innerHTML.replace(/_r_[\da-z]+_/g, '_r_ID_') }
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

describe('rail badge absent', () => {
  it('renders the rail exactly as it was before the key existed', () => {
    const { head, html } = renderRail({})
    expect(html).toMatchSnapshot()
    expect(head.textContent).toContain('live')
  })

  it.each([
    ['empty', ''],
    ['blank', '   '],
  ])('treats an %s value as absent, byte for byte', (_label, value) => {
    const absent = renderRail({}).html
    cleanup()
    expect(renderRail({ AGENTIKO_RAIL_BADGE: value }).html).toBe(absent)
  })

  it('keeps the pill, which says streaming during a turn', () => {
    const { head } = renderRail({}, { streaming: true })
    expect(head.textContent).toContain('streaming')
  })
})

describe('rail badge set', () => {
  it('shows the label as a tag beside the title', () => {
    const { head } = renderRail({ AGENTIKO_RAIL_BADGE: 'Scripted demo' })
    const tag = Array.from(head.querySelectorAll('.ant-tag')).find((el) => el.textContent === 'Scripted demo')
    expect(tag).toBeTruthy()
    // Directly after the title, so it reads as part of it.
    expect(tag?.previousElementSibling?.textContent).toBe('Agentiko')
    // A long label ellipsises in a narrow rail (visual/agentikoRailHeader.spec.ts); its title keeps the whole of it.
    expect(tag?.getAttribute('title')).toBe('Scripted demo')
  })

  it.each([
    ['idle', false, 'live'],
    ['streaming', true, 'streaming'],
  ])('hides the pill while %s', (_label, streaming, pillText) => {
    const { head } = renderRail({ AGENTIKO_RAIL_BADGE: 'Scripted demo' }, { streaming })
    expect(head.textContent).not.toContain(pillText)
  })

  it('reads the key through agentikoConfig, so the AUTOPILOT_ name works as its fallback', () => {
    const { head } = renderRail({ AUTOPILOT_RAIL_BADGE: 'Staging' })
    expect(head.querySelector('.ant-tag')?.textContent).toBe('Staging')
  })
})
