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
 * `useAgentiko` is stubbed so the test drives the UI, not A2A. The speak-back store is the
 * real singleton with a FAKE synthesiser installed — jsdom has no `speechSynthesis`.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = vi.hoisted((): { api: Record<string, string> } => ({ api: {} }))

vi.mock('../../context/ConfigContext', () => ({ useConfigContext: () => ({ config: { api: mockConfig.api } }) }))
vi.mock('./AgentikoTour', () => ({ default: () => null }))

import { useAgentiko } from './AgentikoProvider'
import AgentikoRail from './AgentikoRail'
import { agentikoComposerDraftStore } from './composerDraftStore'
import type { ThreadSummary } from './sessionHistoryStore'
import type { AgentikoMessage } from './types'
import { agentikoSpeakBackStore } from './voice/speak/speakBackStore'
import type { SpeechDeps, SpeechUtteranceLike, SpeechVoiceLike } from './voice/speak/speechEngine'

vi.mock('./AgentikoProvider', () => ({ useAgentiko: vi.fn() }))

const mockedUseAgentiko = vi.mocked(useAgentiko)

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
  checking: false,
  clearOasAttachment: vi.fn(),
  closeTour: vi.fn(),
  collect: vi.fn(() => ({ focus: 'Home', route: '/', widgets: [] })),
  denyPending: vi.fn(),
  enabled: true,
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

const setValue = (overrides: Partial<typeof baseValue>) => {
  mockedUseAgentiko.mockReturnValue({ ...baseValue, ...overrides })
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
  agentikoComposerDraftStore.clear()
  agentikoSpeakBackStore.installSpeechDeps(fake.deps)
  agentikoSpeakBackStore.setConfigValue(undefined)
  agentikoSpeakBackStore.setEnabled(true)
  agentikoSpeakBackStore.dismissNotice()
  setValue({})
})

afterEach(() => {
  act(() => agentikoSpeakBackStore.cancel())
  cleanup()
  vi.clearAllMocks()
})

const answer = (overrides: Partial<{ id: string; modality: 'text' | 'voice'; text: string }> = {}) =>
  ({ id: 'a1', modality: 'voice' as const, text: 'Two replicas are Ready.', ...overrides })

describe('the trigger, through the real composer', () => {
  it('a typed question sends a TEXT turn — the answer is never spoken', () => {
    const send = vi.fn()
    setValue({ send })
    const { getByLabelText, getByPlaceholderText } = render(<AgentikoRail />)
    fireEvent.change(getByPlaceholderText('Ask Agentiko to do something…'), { target: { value: 'scale payments' } })
    fireEvent.click(getByLabelText('Send'))
    expect(send).toHaveBeenCalledWith('scale payments', { modality: 'text' })
    expect(agentikoSpeakBackStore.speakAnswer(answer({ modality: 'text' }))).toBe(false)
    expect(fake.spoken).toHaveLength(0)
  })

  it('a purely dictated question sends a VOICE turn — and the answer IS spoken', () => {
    const send = vi.fn()
    setValue({ send })
    const { getByLabelText } = render(<AgentikoRail />)
    act(() => agentikoComposerDraftStore.appendDictatedSegment('scale payments to three replicas'))
    fireEvent.click(getByLabelText('Send'))
    expect(send).toHaveBeenCalledWith('scale payments to three replicas', { modality: 'voice' })
    act(() => { agentikoSpeakBackStore.speakAnswer(answer()) })
    expect(fake.spoken.map((utterance) => utterance.text).join(' ')).toContain('Two replicas are Ready.')
  })

  it('dictated then TYPED sends a TEXT turn — one keystroke is enough to silence it', () => {
    const send = vi.fn()
    setValue({ send })
    const { getByLabelText, getByPlaceholderText } = render(<AgentikoRail />)
    act(() => agentikoComposerDraftStore.appendDictatedSegment('scale payments'))
    fireEvent.change(getByPlaceholderText('Ask Agentiko to do something…'), { target: { value: 'scale payments?' } })
    fireEvent.click(getByLabelText('Send'))
    expect(send).toHaveBeenCalledWith('scale payments?', { modality: 'text' })
  })

  it('the draft (and its provenance) survives a remount — the routerVersion bump', () => {
    const send = vi.fn()
    setValue({ send })
    const { unmount } = render(<AgentikoRail />)
    act(() => agentikoComposerDraftStore.appendDictatedSegment('half a dictated question'))
    unmount()
    const { getByLabelText, getByPlaceholderText } = render(<AgentikoRail />)
    expect((getByPlaceholderText('Ask Agentiko to do something…') as HTMLTextAreaElement).value).toBe('half a dictated question')
    fireEvent.click(getByLabelText('Send'))
    expect(send).toHaveBeenCalledWith('half a dictated question', { modality: 'voice' })
  })
})

describe('the preference control in the rail chrome (FR 76)', () => {
  it('renders in the header when speak-back is available, and toggles + persists', () => {
    const { getByTestId } = render(<AgentikoRail />)
    const toggle = getByTestId('agentiko-speakback-toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.getAttribute('aria-label')).toMatch(/Reading answers aloud is on/)
    fireEvent.click(toggle)
    expect(getByTestId('agentiko-speakback-toggle').getAttribute('aria-pressed')).toBe('false')
    // Literal on purpose: the point of this line is that the preference lands under the key
    // a returning browser will look under, which an assertion through the constant cannot say.
    expect(localStorage.getItem('krateo.agentiko.speakback.v1')).toBe('off')
  })

  it('turning it off keeps a voice turn silent', () => {
    const { getByTestId } = render(<AgentikoRail />)
    fireEvent.click(getByTestId('agentiko-speakback-toggle'))
    expect(agentikoSpeakBackStore.speakAnswer(answer())).toBe(false)
    expect(fake.spoken).toHaveLength(0)
  })

  it('is absent entirely — no control, no copy — when there is no local voice', () => {
    act(() => agentikoSpeakBackStore.installSpeechDeps(fakeSynthesis([]).deps))
    const { queryByTestId } = render(<AgentikoRail />)
    expect(queryByTestId('agentiko-speakback-toggle')).toBeNull()
  })

  it('is absent entirely when the operator kill-switch is set', () => {
    mockConfig.api = { AUTOPILOT_VOICE_SPEAK_BACK: 'off' }
    const { queryByTestId } = render(<AgentikoRail />)
    expect(queryByTestId('agentiko-speakback-toggle')).toBeNull()
  })
})

describe('stopping a spoken answer (FR 75)', () => {
  it('shows a Stop in the status row while speaking, and stops on click', () => {
    const { getByTestId, getByText, queryByTestId } = render(<AgentikoRail />)
    act(() => { agentikoSpeakBackStore.speakAnswer(answer()) })
    expect(getByTestId('agentiko-speaking')).toBeTruthy()
    fireEvent.click(getByText('Stop'))
    expect(queryByTestId('agentiko-speaking')).toBeNull()
  })

  it('stops the moment the user types in the composer', () => {
    const { getByPlaceholderText, getByTestId, queryByTestId } = render(<AgentikoRail />)
    act(() => { agentikoSpeakBackStore.speakAnswer(answer()) })
    expect(getByTestId('agentiko-speaking')).toBeTruthy()
    fireEvent.change(getByPlaceholderText('Ask Agentiko to do something…'), { target: { value: 'n' } })
    expect(queryByTestId('agentiko-speaking')).toBeNull()
  })

  it('stops on Escape in the composer, without touching the draft', () => {
    const { getByPlaceholderText, getByTestId, queryByTestId } = render(<AgentikoRail />)
    act(() => agentikoComposerDraftStore.appendDictatedSegment('a dictated draft'))
    act(() => { agentikoSpeakBackStore.speakAnswer(answer()) })
    expect(getByTestId('agentiko-speaking')).toBeTruthy()
    fireEvent.keyDown(getByPlaceholderText('Ask Agentiko to do something…'), { key: 'Escape' })
    expect(queryByTestId('agentiko-speaking')).toBeNull()
    expect(agentikoComposerDraftStore.getSnapshot().text).toBe('a dictated draft')
  })

  it('stops on Escape from ANYWHERE, not only from inside the textarea', () => {
    // A dictated draft is sent by CLICKING Send, which leaves focus on the Send button; a
    // user re-reading the transcript has focus somewhere else again. In both cases the
    // composer's own key handler never sees the key, and FR 75 does not qualify Escape.
    const { getByTestId, queryByTestId } = render(<AgentikoRail />)
    act(() => { agentikoSpeakBackStore.speakAnswer(answer()) })
    expect(getByTestId('agentiko-speaking')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(queryByTestId('agentiko-speaking')).toBeNull()
  })

  it('binds that Escape only while audio is playing, so it swallows nobody else\'s', () => {
    render(<AgentikoRail />)
    const listeners = vi.spyOn(document, 'addEventListener')
    act(() => { agentikoSpeakBackStore.speakAnswer(answer()) })
    expect(listeners).toHaveBeenCalledWith('keydown', expect.any(Function))
    const removals = vi.spyOn(document, 'removeEventListener')
    act(() => { agentikoSpeakBackStore.cancel() })
    expect(removals).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('stops when the rail is collapsed', () => {
    const { queryByTestId, rerender } = render(<AgentikoRail />)
    act(() => { agentikoSpeakBackStore.speakAnswer(answer()) })
    expect(agentikoSpeakBackStore.getSnapshot().speaking).toBe(true)
    setValue({ open: false })
    rerender(<AgentikoRail />)
    expect(agentikoSpeakBackStore.getSnapshot().speaking).toBe(false)
    expect(queryByTestId('agentiko-speaking')).toBeNull()
  })
})

describe('the autoplay refusal and the first-use line', () => {
  it('offers a fresh gesture when the browser refuses to start audio', () => {
    const { getByTestId, getByText } = render(<AgentikoRail />)
    act(() => { agentikoSpeakBackStore.speakAnswer(answer()) })
    act(() => { fake.refuse() })
    expect(getByTestId('agentiko-speak-refused')).toBeTruthy()
    fireEvent.click(getByText('Play answer'))
    expect(getByTestId('agentiko-speaking')).toBeTruthy()
    expect(fake.spoken[fake.spoken.length - 1].text).toContain('Two replicas are Ready.')
  })

  it('moves focus to Stop, which replaced the button the user just pressed', () => {
    // Speech that starts on its own must never move focus — but this button unmounts ITSELF,
    // and the rail renders after the whole app shell, so leaving focus on <body> puts Stop at
    // the far end of the tab order (FR 77: Stop stays keyboard-reachable).
    const { getByText } = render(<AgentikoRail />)
    act(() => { agentikoSpeakBackStore.speakAnswer(answer()) })
    act(() => { fake.refuse() })
    fireEvent.click(getByText('Play answer'))
    expect(document.activeElement).toBe(getByText('Stop'))
  })

  it('withdraws the replay when the preference is switched off', () => {
    const { getByTestId, queryByTestId } = render(<AgentikoRail />)
    act(() => { agentikoSpeakBackStore.speakAnswer(answer()) })
    act(() => { fake.refuse() })
    expect(getByTestId('agentiko-speak-refused')).toBeTruthy()
    fireEvent.click(getByTestId('agentiko-speakback-toggle'))
    expect(queryByTestId('agentiko-speak-refused')).toBeNull()
    expect(fake.spoken).toHaveLength(1)
  })

  it('offers the off switch inline the first time an answer is spoken', () => {
    localStorage.clear()
    const { getByTestId, getByText } = render(<AgentikoRail />)
    act(() => { agentikoSpeakBackStore.speakAnswer(answer()) })
    expect(getByTestId('agentiko-speak-notice')).toBeTruthy()
    fireEvent.click(getByText('Turn off'))
    expect(agentikoSpeakBackStore.getSnapshot()).toMatchObject({ enabled: false, speaking: false })
  })
})

describe('the FR 31 live region', () => {
  it('is always mounted, even with nothing to say', () => {
    const { getByTestId } = render(<AgentikoRail />)
    const region = getByTestId('agentiko-live-region')
    expect(region.getAttribute('role')).toBe('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('')
  })

  it('says nothing while speech is playing, so the answer is not heard twice', () => {
    const { getByTestId } = render(<AgentikoRail />)
    act(() => { agentikoSpeakBackStore.announce('Added 6 words') })
    expect(getByTestId('agentiko-live-region').textContent).toBe('Added 6 words')
    act(() => { agentikoSpeakBackStore.speakAnswer(answer()) })
    expect(getByTestId('agentiko-live-region').textContent).toBe('')
    act(() => { agentikoSpeakBackStore.announce('Listening') })
    expect(getByTestId('agentiko-live-region').textContent).toBe('')
  })
})
