// @vitest-environment jsdom
/**
 * DICTATION IN THE REAL COMPOSER — the states the microphone control renders, and the
 * one case that has to render NOTHING.
 *
 * The first test is the important one and it is a DOM-equality test: with dictation
 * unavailable — which is every plain-HTTP deployment, and every deployment where the
 * operator has not configured a transcription endpoint, i.e. all of them today — the
 * composer must be byte-identical to what it was before this feature existed. Not a
 * greyed button, not a tooltip, not a wrapper element, not a tab stop. The reference
 * snapshot is taken from the same component with the store left unavailable, so the
 * assertion cannot drift as the composer changes for other reasons.
 *
 * The last test closes the loop the whole feature exists for: a purely dictated draft
 * sends `modality: 'voice'`, which is what makes speak-back fire at all.
 *
 * `useAutopilot` is stubbed so the test drives the UI, not A2A; the voice store is the
 * real singleton with fake capture and a fake `fetch`, because jsdom has neither.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { Mock } from 'vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = vi.hoisted((): { api: Record<string, string> } => ({ api: {} }))

vi.mock('../../context/ConfigContext', () => ({ useConfigContext: () => ({ config: { api: mockConfig.api } }) }))
vi.mock('./AutopilotTour', () => ({ default: () => null }))
vi.mock('./AutopilotProvider', () => ({ useAutopilot: vi.fn() }))

import { useAutopilot } from './AutopilotProvider'
import AutopilotRail from './AutopilotRail'
import { autopilotComposerDraftStore } from './composerDraftStore'
import type { ThreadSummary } from './sessionHistoryStore'
import type { AutopilotMessage } from './types'
import type { MediaRecorderLike, MediaStreamLike, RecorderDeps } from './voice/recorder'
import { LEVEL_TICK_MS, SPEECH_RMS_THRESHOLD } from './voice/recorder'
import { autopilotSpeakBackStore } from './voice/speak/speakBackStore'
import { autopilotVoiceStore } from './voice/voiceStore'

const TRANSCRIBE_URL = 'https://gateway.krateo.dev/stt/v1/chat/completions'
const PLACEHOLDER = 'Ask Autopilot to do something…'

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

const setValue = (overrides: Partial<typeof baseValue> = {}) => {
  mockedUseAutopilot.mockReturnValue({ ...baseValue, ...overrides })
}

// ── the fake platform ────────────────────────────────────────────────────────────────
let clock = 0
let level = SPEECH_RMS_THRESHOLD * 5
// Typed to the signature it stands in for. `ReturnType<typeof vi.fn>` widened to
// `Mock<Procedure | Constructable>` in vitest 5, which is assignable to nothing specific —
// so every use as a `typeof fetch` became a type error the moment the dependency moved.
let fetchImpl: Mock<typeof fetch>

const stream: MediaStreamLike = { getTracks: () => [{ stop: () => undefined }] }

const recorderDeps = (): RecorderDeps => ({
  createLevelMeter: () => ({ close: () => undefined, rms: () => level }),
  createRecorder: () => {
    const made: MediaRecorderLike = {
      ondataavailable: null,
      onerror: null,
      onstop: null,
      start: () => undefined,
      stop: () => {
        made.ondataavailable?.({ data: new Blob(['bytes'], { type: 'audio/webm' }) })
        made.onstop?.()
      },
    }
    return made
  },
  getUserMedia: () => Promise.resolve(stream),
  now: () => clock,
})

const transcript = (text: string) => ({
  choices: [{ finish_reason: 'stop', message: { content: text } }],
  // Comfortably above the FR 61 floor for a two-second clip.
  usage: { prompt_tokens: 5000 },
})

const jsonResponse = (body: unknown): Response =>
  ({ json: () => Promise.resolve(body), ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) }) as unknown as Response

/** jsdom's FileReader delivers its `load` on a timer, so a microtask flush is not enough.
 *  The injected clock does not move here, so these ticks cannot trip an auto-stop. */
const drain = async (rounds: number): Promise<void> => {
  if (rounds <= 0) {
    return
  }
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(20)
  await drain(rounds - 1)
}

const settle = (): Promise<void> => drain(8)

const tick = (ms: number): void => {
  const steps = Math.round(ms / LEVEL_TICK_MS)
  for (let step = 0; step < steps; step += 1) {
    clock += LEVEL_TICK_MS
    vi.advanceTimersByTime(LEVEL_TICK_MS)
  }
}

const makeAvailable = (): void => {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve(stream) },
  })
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: { isTypeSupported: () => true } })
  mockConfig.api = { AUTOPILOT_VOICE_TRANSCRIBE_URL: TRANSCRIBE_URL }
}

const makeUnavailable = (): void => {
  // Both APIs present, insecure context — the measured false positive, and the majority
  // state of the install base.
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve(stream) },
  })
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: { isTypeSupported: () => true } })
  mockConfig.api = { AUTOPILOT_VOICE_TRANSCRIBE_URL: TRANSCRIBE_URL }
}

beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
    writable: true,
  })
})

beforeEach(() => {
  vi.useFakeTimers()
  clock = 0
  level = SPEECH_RMS_THRESHOLD * 5
  fetchImpl = vi.fn().mockResolvedValue(jsonResponse(transcript('scale payments to three replicas')))
  localStorage.clear()
  autopilotComposerDraftStore.clear()
  autopilotSpeakBackStore.installSpeechDeps(null)
  autopilotVoiceStore.installRecorderDeps(recorderDeps())
  autopilotVoiceStore.setPermission('prompt')
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  setValue()
})

afterEach(() => {
  act(() => autopilotVoiceStore.cancel())
  autopilotVoiceStore.installTranscribeDeps(null)
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

/** The rail installs the real deps from config; swap in the fake fetch after mount. */
const withFakeTranscriber = (): void => {
  autopilotVoiceStore.installTranscribeDeps({
    authHeader: () => ({ Authorization: 'Bearer portal-jwt' }),
    fetchImpl,
    model: 'gemini-3.8-flash',
    raiseSessionExpired: () => Promise.resolve('logout' as const),
    rateLimitNotice: () => null,
    url: TRANSCRIBE_URL,
  })
}

// ────────────────────────────────────────────────────────────────────────────────────
/**
 * FIRST IN THE FILE ON PURPOSE. The console line is latched once per page lifetime (FR 5),
 * and the voice store here is the module singleton the app really uses — so any earlier
 * render in this file would consume the latch and make this assertion vacuous.
 */
describe('the one console line (FR 5)', () => {
  it('says once why nothing will be dictated, naming the reason and the origin', () => {
    makeUnavailable()
    render(<AutopilotRail />)
    // eslint-disable-next-line no-console -- reading the spy, not writing a log line
    const lines = vi.mocked(console.info).mock.calls
      .filter((call) => String(call[0]).includes('voice input unavailable'))
    expect(lines).toHaveLength(1)
    expect(String(lines[0][0])).toContain('insecure context')
    expect(String(lines[0][0])).toContain(window.location.origin)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('unavailable renders NOTHING (FR 1, 4)', () => {
  it('produces a composer byte-identical to the one with no voice feature at all', () => {
    makeUnavailable()
    const { container } = render(<AutopilotRail />)
    const composer = container.querySelector('[class*="apComposer"]')!.outerHTML

    // The reference: the same composer with the microphone available, minus the microphone.
    // If ANY voice markup leaked into the unavailable path, these diverge.
    cleanup()
    makeAvailable()
    const second = render(<AutopilotRail />)
    const available = second.container.querySelector('[class*="apComposer"]')!.outerHTML

    expect(composer).not.toBe(available)
    expect(composer).not.toContain('autopilot-voice')
    expect(composer).not.toContain('Dictate')
    expect(available).toContain('autopilot-voice-button')
  })

  it('adds no tab stop and no control when the context is insecure, APIs present or not', () => {
    makeUnavailable()
    const { queryByTestId } = render(<AutopilotRail />)
    expect(queryByTestId('autopilot-voice-button')).toBeNull()
    expect(queryByTestId('autopilot-voice-status')).toBeNull()
  })

  it('renders nothing when no transcription endpoint is configured, even over HTTPS', () => {
    makeAvailable()
    mockConfig.api = {}
    const { queryByTestId } = render(<AutopilotRail />)
    expect(queryByTestId('autopilot-voice-button')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('the control and its states', () => {
  it('renders an idle Dictate button when everything is in place', () => {
    makeAvailable()
    const { getByTestId } = render(<AutopilotRail />)
    const button = getByTestId('autopilot-voice-button')
    expect(button.getAttribute('aria-label')).toBe('Dictate')
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('renders blocked — focusable, aria-disabled, with the address-bar instruction (FR 18, 29, 32)', () => {
    makeAvailable()
    const { getByTestId } = render(<AutopilotRail />)
    act(() => autopilotVoiceStore.setPermission('denied'))

    const button = getByTestId('autopilot-voice-button')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.getAttribute('aria-label')).toContain('blocked')
    const hintId = button.getAttribute('aria-describedby')!
    expect(document.getElementById(hintId)?.textContent).toMatch(/lock icon in the address bar/i)
  })

  it('a press while blocked opens no microphone and triggers no prompt', () => {
    makeAvailable()
    const { getByTestId } = render(<AutopilotRail />)
    act(() => autopilotVoiceStore.setPermission('denied'))
    fireEvent.click(getByTestId('autopilot-voice-button'))
    expect(autopilotVoiceStore.getSnapshot().phase).toBe('idle')
  })

  it('shows LISTENING with a timer and a live level, and flips the label to Stop dictating', async () => {
    makeAvailable()
    const { getByTestId } = render(<AutopilotRail />)
    fireEvent.click(getByTestId('autopilot-voice-button'))
    await act(() => settle())
    act(() => tick(3000))

    expect(getByTestId('autopilot-voice-button').getAttribute('aria-pressed')).toBe('true')
    expect(getByTestId('autopilot-voice-button').getAttribute('aria-label')).toBe('Stop dictating')
    expect(getByTestId('autopilot-voice-status').textContent).toContain('listening')
    expect(getByTestId('autopilot-voice-status').textContent).toContain('0:03')
  })

  it('shows the error line with role=alert and leaves the draft untouched', async () => {
    makeAvailable()
    withFakeTranscriber()
    fetchImpl.mockRejectedValue(new TypeError('Failed to fetch'))
    const { getByPlaceholderText, getByTestId } = render(<AutopilotRail />)
    withFakeTranscriber()

    fireEvent.click(getByTestId('autopilot-voice-button'))
    await act(() => settle())
    act(() => tick(1500))
    fireEvent.click(getByTestId('autopilot-voice-button'))
    await act(() => settle())

    const alert = getByTestId('autopilot-voice-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('Speech service unreachable')
    expect((getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement).value).toBe('')
  })

  it('clears the error on the next keystroke (FR 22)', async () => {
    makeAvailable()
    fetchImpl.mockRejectedValue(new TypeError('Failed to fetch'))
    const { getByPlaceholderText, getByTestId, queryByTestId } = render(<AutopilotRail />)
    withFakeTranscriber()

    fireEvent.click(getByTestId('autopilot-voice-button'))
    await act(() => settle())
    act(() => tick(1500))
    fireEvent.click(getByTestId('autopilot-voice-button'))
    await act(() => settle())
    expect(queryByTestId('autopilot-voice-error')).not.toBeNull()

    fireEvent.change(getByPlaceholderText(PLACEHOLDER), { target: { value: 'typing instead' } })
    expect(queryByTestId('autopilot-voice-error')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('stopping, on every path a user expects', () => {
  const startListening = async (getByTestId: (id: string) => HTMLElement) => {
    fireEvent.click(getByTestId('autopilot-voice-button'))
    await act(() => settle())
    act(() => tick(1000))
    expect(autopilotVoiceStore.getSnapshot().phase).toBe('listening')
  }

  it('Escape in the composer cancels and uploads nothing (FR 13)', async () => {
    makeAvailable()
    const { getByPlaceholderText, getByTestId } = render(<AutopilotRail />)
    withFakeTranscriber()
    await startListening(getByTestId)

    fireEvent.keyDown(getByPlaceholderText(PLACEHOLDER), { key: 'Escape' })
    await act(() => settle())

    expect(autopilotVoiceStore.getSnapshot().phase).toBe('idle')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('ENTER while listening ends the utterance, and the spoken turn then sends itself (FR 10)', async () => {
    makeAvailable()
    const send = vi.fn()
    setValue({ send })
    const { getByPlaceholderText, getByTestId } = render(<AutopilotRail />)
    withFakeTranscriber()
    await startListening(getByTestId)

    fireEvent.keyDown(getByPlaceholderText(PLACEHOLDER), { key: 'Enter' })
    await act(() => settle())

    // Enter reads as "I am done talking": it ends capture rather than submitting an empty
    // composer, and conversation mode carries the finished transcript the rest of the way.
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('scale payments to three replicas', { modality: 'voice' })
    // The composer is left empty — the words are in the transcript, not waiting to be sent.
    expect((getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement).value).toBe('')
  })

  it('the status row Cancel discards the recording', async () => {
    makeAvailable()
    const { getByTestId } = render(<AutopilotRail />)
    withFakeTranscriber()
    await startListening(getByTestId)

    fireEvent.click(getByTestId('autopilot-voice-cancel'))
    await act(() => settle())

    expect(autopilotVoiceStore.getSnapshot().phase).toBe('idle')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('Alt+M toggles capture from anywhere in the rail (FR 57)', async () => {
    makeAvailable()
    const { getByPlaceholderText, getByTestId } = render(<AutopilotRail />)
    withFakeTranscriber()

    fireEvent.keyDown(getByPlaceholderText(PLACEHOLDER), { altKey: true, code: 'KeyM', key: 'µ' })
    await act(() => settle())
    expect(autopilotVoiceStore.getSnapshot().phase).toBe('listening')

    act(() => tick(1000))
    fireEvent.keyDown(getByTestId('autopilot-voice-button'), { altKey: true, code: 'KeyM', key: 'µ' })
    await act(() => settle())
    expect(autopilotVoiceStore.getSnapshot().phase).toBe('idle')
  })

  /**
   * FR 25 holds Send while a transcription is in flight, and the hold has to cover ENTER —
   * the habitual send gesture — not just the button. Sending here truncates the question to
   * whatever was typed before the user spoke, and clears the draft the arriving words are
   * about to land in, which then makes the NEXT turn a spurious `voice` one.
   */
  it('ENTER while transcribing does not submit the half-finished question (FR 25)', async () => {
    makeAvailable()
    const send = vi.fn()
    setValue({ send })
    const pending: { resolve: ((value: Response) => void) | null } = { resolve: null }
    fetchImpl.mockImplementation(() => new Promise<Response>((resolve) => { pending.resolve = resolve }))

    const { getByPlaceholderText, getByTestId } = render(<AutopilotRail />)
    withFakeTranscriber()

    fireEvent.change(getByPlaceholderText(PLACEHOLDER), { target: { value: 'restart the payments deployment in' } })
    fireEvent.click(getByTestId('autopilot-voice-button'))
    await act(() => settle())
    act(() => tick(2000))
    fireEvent.click(getByTestId('autopilot-voice-button'))
    await act(() => settle())
    expect(autopilotVoiceStore.getSnapshot().phase).toBe('transcribing')

    fireEvent.keyDown(getByPlaceholderText(PLACEHOLDER), { key: 'Enter' })
    expect(send).not.toHaveBeenCalled()
    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('restart the payments deployment in')

    // The words arrive and join the question, which is the whole point of holding Send.
    pending.resolve?.(jsonResponse(transcript('namespace prod')))
    await act(() => settle())
    expect((getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement).value)
      .toBe('restart the payments deployment in namespace prod')
  })

  /**
   * The rail collapses with `width: 0; overflow: hidden`, so its whole body — including the
   * Collapse button the user just pressed — stays in the DOM and keeps receiving keys.
   */
  it('Alt+M does NOTHING while the rail is collapsed — no microphone without a visible Cancel', async () => {
    makeAvailable()
    setValue({ open: false })
    const { container } = render(<AutopilotRail />)
    withFakeTranscriber()

    fireEvent.keyDown(container.querySelector('aside')!, { altKey: true, code: 'KeyM', key: 'µ' })
    await act(() => settle())

    expect(autopilotVoiceStore.getSnapshot().phase).toBe('idle')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('collapsing the rail stops capture — a microphone behind a closed rail cannot be stopped', async () => {
    makeAvailable()
    const { getByTestId, rerender } = render(<AutopilotRail />)
    withFakeTranscriber()
    await startListening(getByTestId)

    setValue({ open: false })
    rerender(<AutopilotRail />)
    await act(() => settle())

    expect(autopilotVoiceStore.getSnapshot().phase).toBe('idle')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('the loop that makes speak-back reachable', () => {
  it('speaking IS the send: a spoken turn goes on its own, stamped VOICE, with the composer left empty', async () => {
    makeAvailable()
    const send = vi.fn()
    setValue({ send })
    const { getByPlaceholderText, getByTestId } = render(<AutopilotRail />)
    withFakeTranscriber()

    fireEvent.click(getByTestId('autopilot-voice-button'))
    await act(() => settle())
    act(() => tick(2000))
    fireEvent.click(getByTestId('autopilot-voice-button'))
    await act(() => settle())

    // CONVERSATION MODE (FR 11, revised): no Send press. The words carry exactly what was
    // transcribed, and the `voice` stamp is what makes the answer spoken back (FR 67) — the
    // two halves of a conversation, both written to the transcript like any typed turn.
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('scale payments to three replicas', { modality: 'voice' })
    // The composer is empty afterwards: the question is in the transcript, not left behind
    // to be sent a second time by a subsequent Enter.
    expect((getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement).value).toBe('')
    expect(autopilotComposerDraftStore.getSnapshot().provenance).toBe('empty')
  })

  it('a draft the keyboard has touched is NEVER sent out from under the user', async () => {
    makeAvailable()
    const send = vi.fn()
    setValue({ send })
    const { getByLabelText, getByPlaceholderText, getByTestId } = render(<AutopilotRail />)
    withFakeTranscriber()

    // Type first, then dictate INTO that half-written question. The draft is `typed` for
    // good, so conversation mode must stay out of it: the user is still composing, and the
    // words they have not finished writing are not a turn.
    fireEvent.change(getByPlaceholderText(PLACEHOLDER), { target: { value: 'restart' } })
    fireEvent.click(getByTestId('autopilot-voice-button'))
    await act(() => settle())
    act(() => tick(2000))
    fireEvent.click(getByTestId('autopilot-voice-button'))
    await act(() => settle())

    expect(send).not.toHaveBeenCalled()
    expect((getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement).value).toBe('restart scale payments to three replicas')

    // It is still sendable by hand, and it is a TEXT turn — dictation does not launder
    // provenance, so this answer is not spoken back.
    fireEvent.click(getByLabelText('Send'))
    expect(send).toHaveBeenCalledWith('restart scale payments to three replicas', { modality: 'text' })
  })

  it('one typed character before Send makes it a TEXT turn — dictation does not launder provenance', async () => {
    makeAvailable()
    const send = vi.fn()
    setValue({ send })
    const { getByLabelText, getByPlaceholderText, getByTestId } = render(<AutopilotRail />)
    withFakeTranscriber()

    fireEvent.click(getByTestId('autopilot-voice-button'))
    await act(() => settle())
    act(() => tick(2000))
    fireEvent.click(getByTestId('autopilot-voice-button'))
    await act(() => settle())

    fireEvent.change(getByPlaceholderText(PLACEHOLDER), { target: { value: 'scale payments to three replicas?' } })
    fireEvent.click(getByLabelText('Send'))
    expect(send).toHaveBeenCalledWith('scale payments to three replicas?', { modality: 'text' })
  })
})
