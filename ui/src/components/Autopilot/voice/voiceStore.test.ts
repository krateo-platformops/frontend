// @vitest-environment jsdom
/**
 * THE STORE — the state machine, and the one line that makes dictation real:
 * `autopilotComposerDraftStore.appendDictatedSegment(text)`.
 *
 * Two things are asserted harder than the rest.
 *
 * ONE: what reaches the draft. The happy path must append (after whatever was already
 * typed, never replacing it) AND leave the draft's provenance `dictated`, because that
 * provenance is the entire trigger for speak-back — a bug here does not merely lose a
 * transcript, it silently makes the other half of the feature unreachable. The fabricated
 * response must reach the draft NOT AT ALL.
 *
 * TWO: that nothing survives a teardown. Cancel, thread switch, collapse, a permission
 * revoked mid-recording — each must leave no recorder running and no upload in flight, and
 * must leave the draft exactly as it was.
 */
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { autopilotComposerDraftStore } from '../composerDraftStore'

import type { MediaRecorderLike, MediaStreamLike, RecorderDeps } from './recorder'
import { LEVEL_TICK_MS, SPEECH_RMS_THRESHOLD } from './recorder'
import { autopilotSpeakBackStore } from './speak/speakBackStore'
import type { TranscribeDeps } from './transcribe'
import { promptTextChars } from './transcribe'
import { buildVoiceSystemPrompt, textTokenEstimate } from './voicePrompt'
import { createVoiceStore, type VoiceStore } from './voiceStore'

const URL_OK = 'https://gateway.krateo.dev/stt/v1/chat/completions'
const LOUD = SPEECH_RMS_THRESHOLD * 5
const FABRICATION = 'Hi, John. Can you recommend me some, uh, sci-fi movies that released in 2024?'

/** Enough prompt tokens that the FR 61 gate passes for a short clip. */
const enoughTokens = (seconds: number): number =>
  textTokenEstimate(promptTextChars(buildVoiceSystemPrompt('en-US', []))) + 8 * seconds + 100

let clock = 0
let level = LOUD
let tracksStopped = 0
let getUserMediaCalls = 0
let recordersMade = 0
const order: string[] = []

/**
 * The permission-prompt window, made controllable. While `deferMedia` is set, every
 * `getUserMedia()` parks until its entry in `mediaGate` is called — which is what a real
 * browser does for as long as the permission bubble is on screen. Every race worth testing
 * in this store lives inside that window, and the default harness (`await settle()` right
 * after `start()`) closes it too fast to see any of them.
 */
let deferMedia = false
const mediaGate: (() => void)[] = []

const stream: MediaStreamLike = { getTracks: () => [{ stop: () => { tracksStopped += 1 } }] }

const recorderDeps = (): RecorderDeps => ({
  createLevelMeter: () => ({ close: () => undefined, rms: () => level }),
  createRecorder: () => {
    recordersMade += 1
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
  getUserMedia: () => {
    getUserMediaCalls += 1
    order.push('getUserMedia')
    if (!deferMedia) {
      return Promise.resolve(stream)
    }
    return new Promise<MediaStreamLike>((resolve) => { mediaGate.push(() => resolve(stream)) })
  },
  now: () => clock,
})

// Typed to the signature it stands in for — see dictation.test.tsx.
let fetchImpl: Mock<typeof fetch>

const transcribeDeps = (): TranscribeDeps => ({
  authHeader: () => ({ Authorization: 'Bearer portal-jwt' }),
  fetchImpl,
  model: 'gemini-3.8-flash',
  raiseSessionExpired: () => Promise.resolve('logout' as const),
  rateLimitNotice: () => null,
  url: URL_OK,
})

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    json: () => Promise.resolve(body),
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response

const transcriptResponse = (content: string, promptTokens: number) => ({
  choices: [{ finish_reason: 'stop', message: { content } }],
  usage: { prompt_tokens: promptTokens },
})

const tick = (ms: number): void => {
  const steps = Math.round(ms / LEVEL_TICK_MS)
  for (let step = 0; step < steps; step += 1) {
    clock += LEVEL_TICK_MS
    vi.advanceTimersByTime(LEVEL_TICK_MS)
  }
}

/**
 * Let the store's promise chain (getUserMedia → FileReader → fetch → append) settle.
 * The small non-zero advance is required: jsdom's FileReader schedules its `load` event on
 * a timer, so a microtask flush alone never delivers the data URL. The injected clock is
 * NOT moved here, so these ticks cannot trip the duration or silence auto-stops.
 */
const drain = async (rounds: number): Promise<void> => {
  if (rounds <= 0) {
    return
  }
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(20)
  await drain(rounds - 1)
}

const settle = (): Promise<void> => drain(8)

let store: VoiceStore

const makeAvailableStore = (): VoiceStore => {
  const made = createVoiceStore(recorderDeps())
  made.installTranscribeDeps(transcribeDeps())
  made.setCapabilityInput({ transcribeUrl: URL_OK })
  return made
}

/** Start, speak for `ms`, stop, and let the whole chain settle. */
const dictate = async (ms = 2000): Promise<void> => {
  store.start()
  await settle()
  level = LOUD
  tick(ms)
  store.stop()
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers()
  clock = 0
  level = LOUD
  tracksStopped = 0
  getUserMediaCalls = 0
  recordersMade = 0
  deferMedia = false
  mediaGate.length = 0
  order.length = 0
  fetchImpl = vi.fn().mockResolvedValue(jsonResponse(transcriptResponse('scale payments to three replicas', enoughTokens(2))))
  autopilotComposerDraftStore.clear()
  autopilotSpeakBackStore.installSpeechDeps(null)

  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve(stream) },
  })
  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    value: { isTypeSupported: () => true },
  })

  store = makeAvailableStore()
})

afterEach(() => {
  store.cancel()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('the seam — what reaches the composer draft', () => {
  it('APPENDS the transcript and marks the draft dictated, which is what makes speak-back reachable', async () => {
    await dictate()
    expect(autopilotComposerDraftStore.getSnapshot()).toEqual({
      provenance: 'dictated',
      text: 'scale payments to three replicas',
    })
    expect(autopilotComposerDraftStore.turnModality()).toBe('voice')
    expect(store.getSnapshot().phase).toBe('idle')
  })

  it('appends AFTER text typed before dictation and never replaces it (FR 8)', async () => {
    autopilotComposerDraftStore.setTypedDraft('in the payments namespace')
    await dictate()
    expect(autopilotComposerDraftStore.getSnapshot().text)
      .toBe('in the payments namespace scale payments to three replicas')
    // One typed character makes the whole turn typed, for good — the trigger is
    // "purely dictated", not "mostly dictated".
    expect(autopilotComposerDraftStore.turnModality()).toBe('text')
  })

  it('appends after text typed DURING listening, at the moment the transcript arrives', async () => {
    store.start()
    await settle()
    autopilotComposerDraftStore.setTypedDraft('and')
    tick(1500)
    store.stop()
    await settle()
    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('and scale payments to three replicas')
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('the FR 61 arithmetic is logged on every call, not only on failures', () => {
  it('reports the observed audio tokens per second, which is the only field data the floor can be re-calibrated from', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    await dictate()

    const line = debug.mock.calls.find((call) => String(call[0]).includes('dictation transcribed'))
    expect(line).toBeDefined()
    const detail = line?.[1] as { audioTokensPerSecond: number; promptTokens: number; seconds: number }
    expect(detail.promptTokens).toBe(enoughTokens(2))
    expect(detail.seconds).toBeCloseTo(2, 5)
    // The floor of 8 is calibrated on ONE measurement, in WAV — a format FR 27 forbids
    // sending. Nothing else in the product will ever produce the Opus number.
    expect(detail.audioTokensPerSecond).toBeGreaterThan(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('a fabricated response never reaches the draft (FR 61, at the store level)', () => {
  it('leaves the composer EMPTY and surfaces no-audio when the token count shows no audio arrived', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fetchImpl.mockResolvedValue(jsonResponse(transcriptResponse(FABRICATION, 19)))

    await dictate()

    expect(autopilotComposerDraftStore.getSnapshot()).toEqual({ provenance: 'empty', text: '' })
    expect(store.getSnapshot().phase).toBe('error')
    expect(store.getSnapshot().error?.code).toBe('no-audio')
    expect(JSON.stringify(store.getSnapshot())).not.toContain('sci-fi')
  })

  it('leaves a draft the user had already typed exactly as it was', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fetchImpl.mockResolvedValue(jsonResponse(transcriptResponse(FABRICATION, 19)))
    autopilotComposerDraftStore.setTypedDraft('why is payments down')

    await dictate()

    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('why is payments down')
  })

  it('never even POSTs a silent recording (FR 66) — nothing spent, nothing to fabricate from', async () => {
    // Silent from the first sample: a muted microphone, or the wrong input device.
    level = 0
    store.start()
    await settle()
    tick(2000)
    store.stop()
    await settle()

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.getSnapshot().error?.code).toBe('no-speech')
    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('')
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('availability and permission gating', () => {
  it('does not start when the context is insecure, whatever the APIs say', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    store.setCapabilityInput({ transcribeUrl: URL_OK })
    expect(store.getSnapshot().capability).toEqual({ available: false, reason: 'insecure-context' })
    store.start()
    await settle()
    expect(getUserMediaCalls).toBe(0)
  })

  it('does not start with no configured URL', async () => {
    store.setCapabilityInput({ transcribeUrl: '' })
    store.start()
    await settle()
    expect(getUserMediaCalls).toBe(0)
  })

  it('does not start — and triggers no prompt — when the permission is denied (FR 18)', async () => {
    store.setPermission('denied')
    store.start()
    await settle()
    expect(getUserMediaCalls).toBe(0)
  })

  it('a permission revoked MID-RECORDING aborts capture and keeps the draft (FR 19)', async () => {
    autopilotComposerDraftStore.setTypedDraft('keep me')
    store.start()
    await settle()
    tick(1000)
    store.setPermission('denied')
    await settle()

    expect(store.getSnapshot().phase).toBe('idle')
    expect(tracksStopped).toBeGreaterThan(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('keep me')
  })

  it('logs the reason at most once (FR 5)', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    store.setCapabilityInput({ transcribeUrl: '' })
    store.logUnavailableOnce('http://34.141.24.198')
    store.logUnavailableOnce('http://34.141.24.198')
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toContain('AUTOPILOT_VOICE_TRANSCRIBE_URL')
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('one session at a time, and every way out of it (FR 44, 45)', () => {
  it('a second start while listening is a no-op — exactly one recorder exists', async () => {
    store.start()
    await settle()
    store.start()
    await settle()
    expect(getUserMediaCalls).toBe(1)
  })

  it('cancel during listening discards the recording and uploads nothing (FR 13)', async () => {
    store.start()
    await settle()
    tick(1500)
    store.cancel()
    await settle()

    expect(store.getSnapshot().phase).toBe('idle')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(tracksStopped).toBeGreaterThan(0)
    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('')
  })

  it('cancel during transcribing aborts the request and drops its result', async () => {
    // A holder object, not a `let`: TypeScript narrows a variable assigned only inside a
    // callback to `null` and then refuses to call it.
    const pending: { resolve: ((value: Response) => void) | null } = { resolve: null }
    fetchImpl.mockImplementation(() => new Promise<Response>((resolve) => { pending.resolve = resolve }))

    store.start()
    await settle()
    tick(1500)
    store.stop()
    await settle()
    expect(store.getSnapshot().phase).toBe('transcribing')

    store.cancel()
    pending.resolve?.(jsonResponse(transcriptResponse('late arrival', enoughTokens(2))))
    await settle()

    expect(store.getSnapshot().phase).toBe('idle')
    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('')
  })

  it('the 60-second auto-stop is reported as INFORMATION, and what was said is still transcribed', async () => {
    // A minute of audio must be billed like a minute of audio for the FR 61 gate to pass.
    fetchImpl.mockResolvedValue(jsonResponse(transcriptResponse('scale payments to three replicas', enoughTokens(60))))
    store.start()
    await settle()
    level = LOUD
    tick(60_000)
    await settle()

    expect(store.getSnapshot().info).toMatch(/Stopped at 60 s/)
    expect(store.getSnapshot().error).toBeNull()
    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('scale payments to three replicas')
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
/**
 * THE PERMISSION-PROMPT WINDOW. `getUserMedia` is pending for as long as the browser's
 * bubble is on screen, and the rail renders Cancel the moment the phase turns `listening`
 * — so every press the user can make in that window arrives while the store holds no
 * recorder at all. Guarding those callbacks on the PHASE alone is not enough: a cancel
 * followed by a second press puts the phase back to `listening`, and the first, abandoned
 * open then finds exactly the state it was waiting for.
 */
describe('a press inside the permission-prompt window (FR 45)', () => {
  it('never adopts an abandoned attempt: cancel-then-restart leaves ONE recorder, and the abandoned one is released', async () => {
    deferMedia = true
    store.start()
    await settle()
    store.cancel()
    store.start()
    await settle()
    expect(mediaGate).toHaveLength(2)

    // The user finally presses Allow. Both opens resolve — the abandoned one first.
    mediaGate[0]()
    mediaGate[1]()
    await settle()

    expect(recordersMade).toBe(2)
    // The abandoned attempt cancelled ITSELF rather than claiming the store: its tracks are
    // stopped, so no second microphone is left live with the tab indicator burning.
    expect(tracksStopped).toBe(1)
    expect(store.getSnapshot().phase).toBe('listening')

    level = LOUD
    tick(2000)
    store.stop()
    await settle()

    // ONE upload, ONE segment. Before the attempt id, the abandoned recorder was still
    // wired to these handlers and appended a second transcript at its own auto-stop.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('scale payments to three replicas')
  })

  it('an abandoned attempt reaching its own auto-stop uploads nothing and appends nothing', async () => {
    deferMedia = true
    store.start()
    await settle()
    store.cancel()
    store.start()
    await settle()
    mediaGate[0]()
    mediaGate[1]()
    await settle()

    // The user speaks, then cancels. `cancel()` can only reach the session the store holds
    // — so if the abandoned one is merely unreachable rather than stopped, it is still
    // recording right now, and nothing will ever call it off.
    level = LOUD
    tick(1000)
    store.cancel()
    expect(store.getSnapshot().phase).toBe('idle')

    // Past the abandoned attempt's own eight-second silence stop, which is where it would
    // upload audio the user cancelled and append the transcript into an idle composer.
    level = 0
    tick(9000)
    await settle()

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('')
    expect(store.getSnapshot().phase).toBe('idle')
  })

  it('honours a Stop pressed before the microphone finished opening, rather than swallowing it', async () => {
    deferMedia = true
    store.start()
    await settle()
    expect(store.getSnapshot().phase).toBe('listening')

    // No session exists yet, so this press had nothing to call. It must not be dropped:
    // the rail says LISTENING, and the alternative is a microphone that runs on to its own
    // eight-second silence stop while the user believes they have stopped it.
    store.stop()
    mediaGate[0]()
    await settle()

    expect(store.getSnapshot().phase).not.toBe('listening')
    expect(tracksStopped).toBe(1)
    // Nothing usable was captured (the clock never moved), so this is `no-speech` — and it
    // never reached the network.
    expect(store.getSnapshot().error?.code).toBe('no-speech')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
/**
 * THE PHASE BUDGET (FR 25) HAS TO HOLD WHEN NOTHING IS WAITING ON A FETCH. The 401 path
 * parks the whole call on the session-resume modal, which the user can leave open for as
 * long as they like — an abort with no fetch in flight is observed by nobody.
 */
describe('the transcribing phase cannot outlive its budget', () => {
  it('times out while parked on the session-resume modal, and never re-POSTs the audio afterwards', async () => {
    const resume: { resolve: ((value: 'logout' | 'resumed') => void) | null } = { resolve: null }
    store.installTranscribeDeps({
      ...transcribeDeps(),
      raiseSessionExpired: () => new Promise((resolve) => { resume.resolve = resolve }),
    })
    fetchImpl.mockResolvedValue(jsonResponse({ error: 'expired' }, 401))

    await dictate()
    expect(store.getSnapshot().phase).toBe('transcribing')
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(31_000)
    // Not stuck: Send is released and the user is told, rather than the rail sitting in
    // `transcribing` with Send disabled for as long as the modal is up.
    expect(store.getSnapshot().phase).toBe('error')
    expect(store.getSnapshot().error?.code).toBe('timeout')

    // The user signs back in minutes later. The retry must NOT go out: an already-aborted
    // signal fires no `abort` event, so nothing but an explicit check stops this POST.
    resume.resolve?.('resumed')
    await settle()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('')
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('barge-in (FR 75)', () => {
  it('cancels speech BEFORE opening the microphone, so the synthesiser is never recorded', async () => {
    vi.spyOn(autopilotSpeakBackStore, 'cancel').mockImplementation(() => { order.push('speak.cancel') })
    store.start()
    await settle()
    expect(order).toEqual(['speak.cancel', 'getUserMedia'])
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('remount survival (FR 42) — the store is module-level for exactly this', () => {
  it('keeps capture running across an unmount/remount and its result still lands in the draft', async () => {
    store.start()
    await settle()
    tick(1200)

    // A routerVersion bump: every subscriber goes away and comes back. The store does not.
    const unsubscribe = store.subscribe(() => undefined)
    unsubscribe()
    expect(store.getSnapshot().phase).toBe('listening')
    expect(store.getSnapshot().elapsedMs).toBeGreaterThan(0)

    store.stop()
    await settle()
    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('scale payments to three replicas')
  })

  it('keeps an in-flight transcription across a remount and lands its result', async () => {
    // A holder object, not a `let`: TypeScript narrows a variable assigned only inside a
    // callback to `null` and then refuses to call it.
    const pending: { resolve: ((value: Response) => void) | null } = { resolve: null }
    fetchImpl.mockImplementation(() => new Promise<Response>((resolve) => { pending.resolve = resolve }))

    store.start()
    await settle()
    tick(1200)
    store.stop()
    await settle()
    expect(store.getSnapshot().phase).toBe('transcribing')

    const unsubscribe = store.subscribe(() => undefined)
    unsubscribe()

    pending.resolve?.(jsonResponse(transcriptResponse('survived the remount', enoughTokens(2))))
    await settle()
    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('survived the remount')
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('errors', () => {
  it('clears on the next Dictate press (FR 22)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fetchImpl.mockResolvedValue(jsonResponse(transcriptResponse(FABRICATION, 19)))
    await dictate()
    expect(store.getSnapshot().error).not.toBeNull()

    store.toggle()
    await settle()
    expect(store.getSnapshot().error).toBeNull()
    expect(store.getSnapshot().phase).toBe('listening')
  })

  it('clears on dismissError, which the textarea calls on every keystroke', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fetchImpl.mockResolvedValue(jsonResponse(transcriptResponse(FABRICATION, 19)))
    await dictate()
    store.dismissError()
    expect(store.getSnapshot().error).toBeNull()
    expect(store.getSnapshot().phase).toBe('idle')
  })

  it('reports network failure without touching the draft', async () => {
    fetchImpl.mockRejectedValue(new TypeError('Failed to fetch'))
    await dictate()
    expect(store.getSnapshot().error?.code).toBe('network')
    expect(autopilotComposerDraftStore.getSnapshot().text).toBe('')
  })

  it('recorder is a no-op without transcription deps rather than throwing', async () => {
    store.installTranscribeDeps(null)
    await dictate()
    expect(store.getSnapshot().error?.code).toBe('engine')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
