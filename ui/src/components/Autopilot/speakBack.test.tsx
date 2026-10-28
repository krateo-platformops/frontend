// @vitest-environment jsdom
/**
 * SPEAK-BACK IN THE RAIL — the trigger end to end through the real composer, and the
 * chrome that makes the feature controllable.
 *
 * The three cases the owner's trigger names are asserted here against the actual textarea
 * and the actual Send button, because that is where the provenance is decided:
 *   · dictated only            → send({ modality: 'voice' })  → the answer is spoken
 *   · dictated, then typed     → send({ modality: 'text'  })  → silent
 *   · typed only               → send({ modality: 'text'  })  → silent
 *
 * `useAutopilot` is stubbed so the test drives the UI, not A2A. The speak-back store is the
 * real singleton with a FAKE synthesiser installed — jsdom has no `speechSynthesis`.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = vi.hoisted((): { api: Record<string, string> } => ({ api: {} }))

vi.mock('../../context/ConfigContext', () => ({ useConfigContext: () => ({ config: { api: mockConfig.api } }) }))
vi.mock('./AutopilotTour', () => ({ default: () => null }))

import { useAutopilot } from './AutopilotProvider'
import AutopilotRail from './AutopilotRail'
import { autopilotComposerDraftStore } from './composerDraftStore'
import type { ThreadSummary } from './sessionHistoryStore'
import type { AutopilotMessage } from './types'
import { autopilotSpeakBackStore } from './voice/speak/speakBackStore'
import type { SpeechDeps, SpeechUtteranceLike, SpeechVoiceLike } from './voice/speak/speechEngine'

vi.mock('./AutopilotProvider', () => ({ useAutopilot: vi.fn() }))

const mockedUseAutopilot = vi.mocked(useAutopilot)

const LOCAL_EN: SpeechVoiceLike = { lang: 'en-US', localService: true, name: 'Samantha' }

const fakeSynthesis = (voices: SpeechVoiceLike[]) => {
  const spoken: SpeechUtteranceLike[] = []
  const deps: SpeechDeps = {
    createUtterance: (text) => ({ onend: null, onerror: null, text }),
    synthesis: {
      cancel: () => undefined,
      getVoices: () => voices,
      speak: (utterance) => { spoken.push(utterance) },
    },
  }
  return { deps, refuse: () => spoken[spoken.length - 1]?.onerror?.({ error: 'not-allowed' }), spoken }
}

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
  mockedUseAutopilot.mockReturnValue({ ...baseValue, ...overrides })
}

beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
    writable: true,
  })
})

let fake = fakeSynthesis([LOCAL_EN])

beforeEach(() => {
  localStorage.clear()
  mockConfig.api = {}
  fake = fakeSynthesis([LOCAL_EN])
  autopilotComposerDraftStore.clear()
  autopilotSpeakBackStore.installSpeechDeps(fake.deps)
  autopilotSpeakBackStore.setConfigValue(undefined)
  autopilotSpeakBackStore.setEnabled(true)
  autopilotSpeakBackStore.dismissNotice()
  setValue({})
})

afterEach(() => {
  act(() => autopilotSpeakBackStore.cancel())
  cleanup()
  vi.clearAllMocks()
})

const answer = (overrides: Partial<{ id: string; modality: 'text' | 'voice'; text: string }> = {}) =>
  ({ id: 'a1', modality: 'voice' as const, text: 'Two replicas are Ready.', ...overrides })

describe('the trigger, through the real composer', () => {
  it('a typed question sends a TEXT turn — the answer is never spoken', () => {
    const send = vi.fn()
    setValue({ send })
    const { getByLabelText, getByPlaceholderText } = render(<AutopilotRail />)
    fireEvent.change(getByPlaceholderText('Ask Autopilot to do something…'), { target: { value: 'scale payments' } })
    fireEvent.click(getByLabelText('Send'))
    expect(send).toHaveBeenCalledWith('scale payments', { modality: 'text' })
    expect(autopilotSpeakBackStore.speakAnswer(answer({ modality: 'text' }))).toBe(false)
    expect(fake.spoken).toHaveLength(0)
  })

  it('a purely dictated question sends a VOICE turn — and the answer IS spoken', () => {
    const send = vi.fn()
    setValue({ send })
    const { getByLabelText } = render(<AutopilotRail />)
    act(() => autopilotComposerDraftStore.appendDictatedSegment('scale payments to three replicas'))
    fireEvent.click(getByLabelText('Send'))
    expect(send).toHaveBeenCalledWith('scale payments to three replicas', { modality: 'voice' })
    act(() => { autopilotSpeakBackStore.speakAnswer(answer()) })
    expect(fake.spoken.map((utterance) => utterance.text).join(' ')).toContain('Two replicas are Ready.')
  })

  it('dictated then TYPED sends a TEXT turn — one keystroke is enough to silence it', () => {
    const send = vi.fn()
    setValue({ send })
    const { getByLabelText, getByPlaceholderText } = render(<AutopilotRail />)
    act(() => autopilotComposerDraftStore.appendDictatedSegment('scale payments'))
    fireEvent.change(getByPlaceholderText('Ask Autopilot to do something…'), { target: { value: 'scale payments?' } })
    fireEvent.click(getByLabelText('Send'))
    expect(send).toHaveBeenCalledWith('scale payments?', { modality: 'text' })
  })

  it('the draft (and its provenance) survives a remount — the routerVersion bump', () => {
    const send = vi.fn()
    setValue({ send })
    const { unmount } = render(<AutopilotRail />)
    act(() => autopilotComposerDraftStore.appendDictatedSegment('half a dictated question'))
    unmount()
    const { getByLabelText, getByPlaceholderText } = render(<AutopilotRail />)
    expect((getByPlaceholderText('Ask Autopilot to do something…') as HTMLTextAreaElement).value).toBe('half a dictated question')
    fireEvent.click(getByLabelText('Send'))
    expect(send).toHaveBeenCalledWith('half a dictated question', { modality: 'voice' })
  })
})

describe('the preference control in the rail chrome (FR 76)', () => {
  it('renders in the header when speak-back is available, and toggles + persists', () => {
    const { getByTestId } = render(<AutopilotRail />)
    const toggle = getByTestId('autopilot-speakback-toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.getAttribute('aria-label')).toMatch(/Reading answers aloud is on/)
    fireEvent.click(toggle)
    expect(getByTestId('autopilot-speakback-toggle').getAttribute('aria-pressed')).toBe('false')
    expect(localStorage.getItem('krateo.autopilot.speakback.v1')).toBe('off')
  })

  it('turning it off keeps a voice turn silent', () => {
    const { getByTestId } = render(<AutopilotRail />)
    fireEvent.click(getByTestId('autopilot-speakback-toggle'))
    expect(autopilotSpeakBackStore.speakAnswer(answer())).toBe(false)
    expect(fake.spoken).toHaveLength(0)
  })

  it('is absent entirely — no control, no copy — when there is no local voice', () => {
    act(() => autopilotSpeakBackStore.installSpeechDeps(fakeSynthesis([]).deps))
    const { queryByTestId } = render(<AutopilotRail />)
    expect(queryByTestId('autopilot-speakback-toggle')).toBeNull()
  })

  it('is absent entirely when the operator kill-switch is set', () => {
    mockConfig.api = { AUTOPILOT_VOICE_SPEAK_BACK: 'off' }
    const { queryByTestId } = render(<AutopilotRail />)
    expect(queryByTestId('autopilot-speakback-toggle')).toBeNull()
  })
})

describe('stopping a spoken answer (FR 75)', () => {
  it('shows a Stop in the status row while speaking, and stops on click', () => {
    const { getByTestId, getByText, queryByTestId } = render(<AutopilotRail />)
    act(() => { autopilotSpeakBackStore.speakAnswer(answer()) })
    expect(getByTestId('autopilot-speaking')).toBeTruthy()
    fireEvent.click(getByText('Stop'))
    expect(queryByTestId('autopilot-speaking')).toBeNull()
  })

  it('stops the moment the user types in the composer', () => {
    const { getByPlaceholderText, getByTestId, queryByTestId } = render(<AutopilotRail />)
    act(() => { autopilotSpeakBackStore.speakAnswer(answer()) })
    expect(getByTestId('autopilot-speaking')).toBeTruthy()
    fireEvent.change(getByPlaceholderText('Ask Autopilot to do something…'), { target: { value: 'n' } })
    expect(queryByTestId('autopilot-speaking')).toBeNull()
  })

  it('stops on Escape in the composer, without touching the draft', () => {
    const { getByPlaceholderText, getByTestId, queryByTestId } = render(<AutopilotRail />)
    act(() => autopilotComposerDraftStore.appendDictatedSegment('a dictated draft'))
    act(() => { autopilotSpeakBackStore.speakAnswer(answer()) })
    expect(getByTestId('autopilot-speaking')).toBeTruthy()
    fireEvent.keyDown(getByPlaceholderText('Ask Autopilot to do something…'), { key: 'Escape' })
    expect(queryByTestId('autopilot-speaking')).toBeNull()
    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('a dictated draft')
  })

  it('stops on Escape from ANYWHERE, not only from inside the textarea', () => {
    // A dictated draft is sent by CLICKING Send, which leaves focus on the Send button; a
    // user re-reading the transcript has focus somewhere else again. In both cases the
    // composer's own key handler never sees the key, and FR 75 does not qualify Escape.
    const { getByTestId, queryByTestId } = render(<AutopilotRail />)
    act(() => { autopilotSpeakBackStore.speakAnswer(answer()) })
    expect(getByTestId('autopilot-speaking')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(queryByTestId('autopilot-speaking')).toBeNull()
  })

  it('binds that Escape only while audio is playing, so it swallows nobody else\'s', () => {
    render(<AutopilotRail />)
    const listeners = vi.spyOn(document, 'addEventListener')
    act(() => { autopilotSpeakBackStore.speakAnswer(answer()) })
    expect(listeners).toHaveBeenCalledWith('keydown', expect.any(Function))
    const removals = vi.spyOn(document, 'removeEventListener')
    act(() => { autopilotSpeakBackStore.cancel() })
    expect(removals).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('stops when the rail is collapsed', () => {
    const { queryByTestId, rerender } = render(<AutopilotRail />)
    act(() => { autopilotSpeakBackStore.speakAnswer(answer()) })
    expect(autopilotSpeakBackStore.getSnapshot().speaking).toBe(true)
    setValue({ open: false })
    rerender(<AutopilotRail />)
    expect(autopilotSpeakBackStore.getSnapshot().speaking).toBe(false)
    expect(queryByTestId('autopilot-speaking')).toBeNull()
  })
})

describe('the autoplay refusal and the first-use line', () => {
  it('offers a fresh gesture when the browser refuses to start audio', () => {
    const { getByTestId, getByText } = render(<AutopilotRail />)
    act(() => { autopilotSpeakBackStore.speakAnswer(answer()) })
    act(() => { fake.refuse() })
    expect(getByTestId('autopilot-speak-refused')).toBeTruthy()
    fireEvent.click(getByText('Play answer'))
    expect(getByTestId('autopilot-speaking')).toBeTruthy()
    expect(fake.spoken[fake.spoken.length - 1].text).toContain('Two replicas are Ready.')
  })

  it('moves focus to Stop, which replaced the button the user just pressed', () => {
    // Speech that starts on its own must never move focus — but this button unmounts ITSELF,
    // and the rail renders after the whole app shell, so leaving focus on <body> puts Stop at
    // the far end of the tab order (FR 77: Stop stays keyboard-reachable).
    const { getByText } = render(<AutopilotRail />)
    act(() => { autopilotSpeakBackStore.speakAnswer(answer()) })
    act(() => { fake.refuse() })
    fireEvent.click(getByText('Play answer'))
    expect(document.activeElement).toBe(getByText('Stop'))
  })

  it('withdraws the replay when the preference is switched off', () => {
    const { getByTestId, queryByTestId } = render(<AutopilotRail />)
    act(() => { autopilotSpeakBackStore.speakAnswer(answer()) })
    act(() => { fake.refuse() })
    expect(getByTestId('autopilot-speak-refused')).toBeTruthy()
    fireEvent.click(getByTestId('autopilot-speakback-toggle'))
    expect(queryByTestId('autopilot-speak-refused')).toBeNull()
    expect(fake.spoken).toHaveLength(1)
  })

  it('offers the off switch inline the first time an answer is spoken', () => {
    localStorage.clear()
    const { getByTestId, getByText } = render(<AutopilotRail />)
    act(() => { autopilotSpeakBackStore.speakAnswer(answer()) })
    expect(getByTestId('autopilot-speak-notice')).toBeTruthy()
    fireEvent.click(getByText('Turn off'))
    expect(autopilotSpeakBackStore.getSnapshot()).toMatchObject({ enabled: false, speaking: false })
  })
})

describe('the FR 31 live region', () => {
  it('is always mounted, even with nothing to say', () => {
    const { getByTestId } = render(<AutopilotRail />)
    const region = getByTestId('autopilot-live-region')
    expect(region.getAttribute('role')).toBe('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('')
  })

  it('says nothing while speech is playing, so the answer is not heard twice', () => {
    const { getByTestId } = render(<AutopilotRail />)
    act(() => { autopilotSpeakBackStore.announce('Added 6 words') })
    expect(getByTestId('autopilot-live-region').textContent).toBe('Added 6 words')
    act(() => { autopilotSpeakBackStore.speakAnswer(answer()) })
    expect(getByTestId('autopilot-live-region').textContent).toBe('')
    act(() => { autopilotSpeakBackStore.announce('Listening') })
    expect(getByTestId('autopilot-live-region').textContent).toBe('')
  })
})
