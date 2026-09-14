// @vitest-environment jsdom
/**
 * CLOUD TTS SPEAKER — the `Speaker` contract, driven against a fake gateway and a fake
 * audio element, plus the invariant the whole exercise exists to protect.
 *
 * THE FIDELITY GUARD comes first because it is the point. FR 68 says the spoken words are
 * the written words: what the speaker is handed must be `speakableForMessage(message)`,
 * byte for byte, and the string that leaves the browser in `input.text` must be that same
 * string. The swap from the browser synthesiser to Cloud TTS is only safe BECAUSE the seam
 * is `Speaker` — nothing on the rendering path moved — and this is the assertion that says
 * so out loud, so a later edit that "improves" the spoken text for the network's benefit
 * fails here instead of shipping.
 *
 * jsdom has neither `Audio` nor a `fetch` worth driving, which is exactly why `TtsDeps`
 * exists: these tests replace it whole and assert on what was requested, what was played,
 * and what was reported back when the request failed or the browser refused to start audio.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AutopilotActionChip } from '../types'

import { speakableForMessage } from './speak/speakable'
import { createSpeakBackStore, REFUSAL_ANNOUNCEMENT } from './speak/speakBackStore'
import type { Speaker, SpeechDeps, SpeechUtteranceLike, SpeechVoiceLike } from './speak/speechEngine'
import type { TtsAudioHandlers, TtsDeps } from './speakTts'
import { buildSynthesizeBody, createTtsSpeaker, DEFAULT_TTS_VOICE, TTS_REQUEST_TIMEOUT_MS, ttsLanguageCode } from './speakTts'

const TTS_URL = 'https://portal.krateo.test/tts/v1/text:synthesize'
const AUDIO_BASE64 = 'QUJDRA=='
const DATA_URL = `data:audio/mpeg;base64,${AUDIO_BASE64}`

/** Markdown, a code fence and a link — so a speaker handed the RAW text rather than the
 *  rendered one is a visibly different string, not a subtly different one. */
const RICH_ANSWER = [
  '## Deployment `payments`',
  '',
  '- **2/3** replicas are Ready.',
  '- The third is in `CrashLoopBackOff`.',
  '',
  '```yaml',
  'replicas: 3',
  '```',
  '',
  'See [the events](https://example.test/events) for the restart history.',
].join('\n')

const CHIP: AutopilotActionChip = { label: 'scale payments to 3', readOnly: false, verb: 'runAction' }

const VOICE_TURN = { id: 'a1', modality: 'voice' as const, text: 'Two replicas are Ready.' }

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

/** Let every queued microtask run. Two turns because the request path is fetch → json →
 *  play, and a single tick settles only the first of them. */
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(1)
  await vi.advanceTimersByTimeAsync(1)
}

const notAllowed = (): Error => Object.assign(new Error('play() blocked'), { name: 'NotAllowedError' })

/** A fake `/tts/v1` that records what was asked of it and answers when the test says so. */
const fakeGateway = () => {
  const calls: { body: Record<string, unknown>; headers: Record<string, string>; url: string }[] = []
  const gate = deferred<Response>()
  let aborted = false
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>,
      headers: (init?.headers ?? {}) as Record<string, string>,
      url: typeof input === 'string' ? input : '',
    })
    init?.signal?.addEventListener('abort', () => { aborted = true })
    return gate.promise
  }) as typeof fetch
  return {
    aborted: () => aborted,
    calls,
    fetchImpl,
    reject: (reason: Error) => gate.reject(reason),
    respond: (statusCode: number) => gate.resolve({ ok: false, status: statusCode } as Response),
    succeed: () =>
      gate.resolve({ json: () => Promise.resolve({ audioContent: AUDIO_BASE64 }), ok: true, status: 200 } as unknown as Response),
    /** A 200 that is not the synthesize shape — a gateway misconfigured onto some other
     *  backend answers exactly like this, and it must not read as a clip. */
    succeedEmpty: () =>
      gate.resolve({ json: () => Promise.resolve({}), ok: true, status: 200 } as unknown as Response),
  }
}

/** A fake `<audio>`: records the src it was built from, and lets the test decide whether
 *  playback started, ended, errored, or was refused by the autoplay policy. */
const audioProbe = () => {
  const sources: string[] = []
  const gate = deferred<void>()
  let handlers: TtsAudioHandlers | null = null
  let pauses = 0
  const createAudio: TtsDeps['createAudio'] = (src, next) => {
    sources.push(src)
    handlers = next
    return { pause: () => { pauses += 1 }, play: () => gate.promise }
  }
  return {
    createAudio,
    ended: () => handlers?.onEnded(),
    errored: () => handlers?.onError(),
    pauses: () => pauses,
    playFailed: (reason: Error) => gate.reject(reason),
    playStarted: () => gate.resolve(),
    sources,
  }
}

const ttsDeps = (
  gateway: ReturnType<typeof fakeGateway>,
  audio: ReturnType<typeof audioProbe>,
  overrides: Partial<TtsDeps> = {},
): TtsDeps => ({
  authHeader: () => ({ Authorization: 'Bearer portal-token' }),
  createAudio: audio.createAudio,
  fetchImpl: gateway.fetchImpl,
  url: TTS_URL,
  voiceName: DEFAULT_TTS_VOICE,
  ...overrides,
})

const spyHandlers = () => ({ onFinished: vi.fn(), onRefused: vi.fn() })

/** A `Speaker` that records the words it was handed and nothing else — the seam the
 *  fidelity guard reads, with no engine of any kind behind it. */
const recordingSpeaker = (said: string[]): Speaker => ({
  cancel: () => undefined,
  speak: (text) => {
    said.push(text)
    return true
  },
})

/** The browser half, for the tests that prove it is still there and still in charge. */
const LOCAL_EN: SpeechVoiceLike = { lang: 'en-US', localService: true, name: 'Samantha' }
const REMOTE_EN: SpeechVoiceLike = { lang: 'en-US', localService: false, name: 'Google US English' }

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
  return { deps, said: () => spoken.map((utterance) => utterance.text).join(' '), spoken }
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('THE FIDELITY GUARD (FR 68)', () => {
  const message = { actions: [CHIP], text: RICH_ANSWER }

  it('hands the installed speaker the EXACT speakableForMessage() string, byte for byte', () => {
    const said: string[] = []
    const store = createSpeakBackStore(null)
    store.installSpeaker(recordingSpeaker(said))
    expect(store.speakAnswer({ ...message, id: 'a1', modality: 'voice' })).toBe(true)
    expect(said).toHaveLength(1)
    expect(said[0]).toBe(speakableForMessage(message))
  })

  it('sends that same string to the gateway as input.text — nothing re-renders it on the way out', () => {
    const gateway = fakeGateway()
    const store = createSpeakBackStore(null)
    store.installSpeaker(createTtsSpeaker(ttsDeps(gateway, audioProbe())))
    store.speakAnswer({ ...message, id: 'a1', modality: 'voice' })
    const { input } = gateway.calls[0].body as { input: { text: string } }
    expect(input.text).toBe(speakableForMessage(message))
  })

  it('speaks the RENDERED answer, not the raw markdown — the guard is watching a real transform', () => {
    // Belt and braces on the test above: if `speakableForMessage` were ever the identity
    // function, that assertion would hold while saying nothing. It is not.
    expect(speakableForMessage(message)).not.toBe(RICH_ANSWER)
    expect(speakableForMessage(message)).not.toContain('```')
  })
})

describe('the request (the portal origin, never Google)', () => {
  it('POSTs the synthesize shape to the configured URL with the portal bearer and no cookies', () => {
    const gateway = fakeGateway()
    const speaker = createTtsSpeaker(ttsDeps(gateway, audioProbe()))
    expect(speaker.speak('Two replicas are Ready.', 'en-US', spyHandlers())).toBe(true)
    expect(gateway.calls[0].url).toBe(TTS_URL)
    expect(gateway.calls[0].headers.Authorization).toBe('Bearer portal-token')
    expect(gateway.calls[0].body).toEqual({
      audioConfig: { audioEncoding: 'MP3' },
      input: { text: 'Two replicas are Ready.' },
      voice: { languageCode: 'en-US', name: DEFAULT_TTS_VOICE },
    })
  })

  it('takes the language from the configured VOICE, which is the one that serves it', () => {
    expect(ttsLanguageCode('it-IT-Chirp3-HD-Achernar', 'en-US')).toBe('it-IT')
    expect(ttsLanguageCode('', 'it-IT')).toBe('it-IT')
    expect(buildSynthesizeBody('ciao', 'it-IT-Chirp3-HD-Achernar', 'en-US')).toMatchObject({
      voice: { languageCode: 'it-IT', name: 'it-IT-Chirp3-HD-Achernar' },
    })
  })

  // GEMINI-TTS. `model_name` selects the generative tier and `input.prompt` steers delivery —
  // the only lever that can ask for Italian prose with English pronunciation of the jargon in
  // it, which no locale-pinned voice can do (an en-US voice mangles the prose, an it-IT voice
  // Italianises `Deployment`).
  it('adds model_name and input.prompt when a Gemini-TTS model is configured', () => {
    expect(buildSynthesizeBody('ciao', 'Kore', 'it-IT', 'gemini-2.5-flash-tts', 'Read in Italian; English terms in English.')).toMatchObject({
      input: { prompt: 'Read in Italian; English terms in English.', text: 'ciao' },
      voice: { languageCode: 'it-IT', model_name: 'gemini-2.5-flash-tts', name: 'Kore' },
    })
  })

  // Inert until opted into: an install that names no model gets the byte-for-byte request it
  // got before, so upgrading cannot change how anyone's speak-back sounds.
  it('omits both fields entirely when no model is configured', () => {
    const body = buildSynthesizeBody('ciao', 'en-US-Chirp3-HD-Achernar', 'en-US')
    expect(body).toEqual({
      audioConfig: { audioEncoding: 'MP3' },
      input: { text: 'ciao' },
      voice: { languageCode: 'en-US', name: 'en-US-Chirp3-HD-Achernar' },
    })
  })

  // A prompt without a model would be a field the Chirp API does not expect.
  it('ignores a style prompt when no model is named', () => {
    const body = buildSynthesizeBody('ciao', 'en-US-Chirp3-HD-Achernar', 'en-US', undefined, 'some style') as { input: Record<string, unknown> }
    expect(body.input).toEqual({ text: 'ciao' })
  })

  it('plays the returned clip, and reports finished when it ends', async () => {
    const gateway = fakeGateway()
    const audio = audioProbe()
    const handlers = spyHandlers()
    const speaker = createTtsSpeaker(ttsDeps(gateway, audio))
    speaker.speak('Two replicas are Ready.', 'en-US', handlers)
    gateway.succeed()
    audio.playStarted()
    await flush()
    expect(audio.sources).toEqual([DATA_URL])
    expect(handlers.onFinished).not.toHaveBeenCalled()
    audio.ended()
    expect(handlers.onFinished).toHaveBeenCalledTimes(1)
  })

  it('says false — and fires nothing — when there is nothing to say', () => {
    const handlers = spyHandlers()
    const gateway = fakeGateway()
    const speaker = createTtsSpeaker(ttsDeps(gateway, audioProbe()))
    expect(speaker.speak('   ', 'en-US', handlers)).toBe(false)
    expect(gateway.calls).toHaveLength(0)
    expect(handlers.onFinished).not.toHaveBeenCalled()
  })
})

describe('cancel() — exactly one outcome, whenever it lands', () => {
  it('aborts a request still in flight and reports finished once', async () => {
    const gateway = fakeGateway()
    const audio = audioProbe()
    const handlers = spyHandlers()
    const speaker = createTtsSpeaker(ttsDeps(gateway, audio))
    speaker.speak('Two replicas are Ready.', 'en-US', handlers)
    speaker.cancel()
    expect(gateway.aborted()).toBe(true)
    expect(handlers.onFinished).toHaveBeenCalledTimes(1)
    // The response arriving after the cancel must not resurrect the answer.
    gateway.succeed()
    await flush()
    expect(audio.sources).toHaveLength(0)
    expect(handlers.onFinished).toHaveBeenCalledTimes(1)
  })

  it('stops playback already under way, and a late `ended` adds nothing', async () => {
    const gateway = fakeGateway()
    const audio = audioProbe()
    const handlers = spyHandlers()
    const speaker = createTtsSpeaker(ttsDeps(gateway, audio))
    speaker.speak('Two replicas are Ready.', 'en-US', handlers)
    gateway.succeed()
    audio.playStarted()
    await flush()
    speaker.cancel()
    expect(audio.pauses()).toBe(1)
    expect(handlers.onFinished).toHaveBeenCalledTimes(1)
    audio.ended()
    expect(handlers.onFinished).toHaveBeenCalledTimes(1)
  })

  it('does not turn its own pause() into a refusal — the play() it interrupted rejects late', async () => {
    // A cancel pauses the element, which rejects the outstanding play() promise. Without
    // the staleness guard that rejection would arrive as a second outcome, and an
    // AbortError-shaped one would even look like something worth reporting.
    const gateway = fakeGateway()
    const audio = audioProbe()
    const handlers = spyHandlers()
    const speaker = createTtsSpeaker(ttsDeps(gateway, audio))
    speaker.speak('Two replicas are Ready.', 'en-US', handlers)
    gateway.succeed()
    await flush()
    speaker.cancel()
    audio.playFailed(notAllowed())
    await flush()
    expect(handlers.onRefused).not.toHaveBeenCalled()
    expect(handlers.onFinished).toHaveBeenCalledTimes(1)
  })

  it('is safe when idle, and adds nothing after a queue has already finished', async () => {
    const gateway = fakeGateway()
    const audio = audioProbe()
    const handlers = spyHandlers()
    const speaker = createTtsSpeaker(ttsDeps(gateway, audio))
    expect(() => speaker.cancel()).not.toThrow()
    speaker.speak('Two replicas are Ready.', 'en-US', handlers)
    gateway.succeed()
    audio.playStarted()
    await flush()
    audio.ended()
    speaker.cancel()
    expect(handlers.onFinished).toHaveBeenCalledTimes(1)
  })

  it('through the store: cancel() clears `speaking` and the answer stays put', async () => {
    const gateway = fakeGateway()
    const audio = audioProbe()
    const store = createSpeakBackStore(null)
    store.installSpeaker(createTtsSpeaker(ttsDeps(gateway, audio)))
    expect(store.speakAnswer(VOICE_TURN)).toBe(true)
    expect(store.getSnapshot().speaking).toBe(true)
    store.cancel()
    expect(store.getSnapshot().speaking).toBe(false)
    gateway.succeed()
    await flush()
    expect(store.getSnapshot().speaking).toBe(false)
  })
})

describe('the autoplay refusal (FR 78)', () => {
  it('reports onRefused, NOT onFinished, when the browser will not start audio', async () => {
    const gateway = fakeGateway()
    const audio = audioProbe()
    const handlers = spyHandlers()
    const speaker = createTtsSpeaker(ttsDeps(gateway, audio))
    speaker.speak('Two replicas are Ready.', 'en-US', handlers)
    gateway.succeed()
    audio.playFailed(notAllowed())
    await flush()
    expect(handlers.onRefused).toHaveBeenCalledTimes(1)
    expect(handlers.onFinished).not.toHaveBeenCalled()
  })

  it('treats any OTHER play() rejection as a plain failure that ends the answer quietly', async () => {
    const gateway = fakeGateway()
    const audio = audioProbe()
    const handlers = spyHandlers()
    const speaker = createTtsSpeaker(ttsDeps(gateway, audio))
    speaker.speak('Two replicas are Ready.', 'en-US', handlers)
    gateway.succeed()
    audio.playFailed(new Error('the decoder refused the clip'))
    await flush()
    expect(handlers.onRefused).not.toHaveBeenCalled()
    expect(handlers.onFinished).toHaveBeenCalledTimes(1)
  })

  it('through the store: the refusal offers "Play answer", which replays the SAME words', async () => {
    const gateway = fakeGateway()
    const store = createSpeakBackStore(null)
    const replayed: string[] = []
    const audio = audioProbe()
    store.installSpeaker(createTtsSpeaker(ttsDeps(gateway, audio)))
    store.speakAnswer(VOICE_TURN)
    gateway.succeed()
    audio.playFailed(notAllowed())
    await flush()
    expect(store.getSnapshot()).toMatchObject({
      announcement: REFUSAL_ANNOUNCEMENT,
      refusedMessageId: 'a1',
      speaking: false,
    })
    store.installSpeaker(recordingSpeaker(replayed))
    // A speaker swap withdraws the offer with the answer it belonged to, so re-arm it the
    // way the rail would: the point here is WHICH words come back, not that they survive
    // an engine change.
    store.speakAnswer(VOICE_TURN)
    expect(replayed[0]).toBe(speakableForMessage({ text: VOICE_TURN.text }))
  })
})

describe('failure degrades, and never wedges `speaking` (FR 74)', () => {
  const wedgeCheck = async (breakIt: (gateway: ReturnType<typeof fakeGateway>) => void): Promise<boolean> => {
    const gateway = fakeGateway()
    const store = createSpeakBackStore(null)
    store.installSpeaker(createTtsSpeaker(ttsDeps(gateway, audioProbe())))
    store.speakAnswer(VOICE_TURN)
    expect(store.getSnapshot().speaking).toBe(true)
    breakIt(gateway)
    await flush()
    return store.getSnapshot().speaking
  }

  it('an HTTP 500 ends the answer quietly', async () => {
    expect(await wedgeCheck((gateway) => gateway.respond(500))).toBe(false)
  })

  it('a dead network ends the answer quietly', async () => {
    expect(await wedgeCheck((gateway) => gateway.reject(new Error('Failed to fetch')))).toBe(false)
  })

  it('a 200 carrying no audioContent ends the answer quietly', async () => {
    expect(await wedgeCheck((gateway) => gateway.succeedEmpty())).toBe(false)
  })

  it('an element that errors mid-clip ends the answer quietly', async () => {
    const gateway = fakeGateway()
    const audio = audioProbe()
    const handlers = spyHandlers()
    const speaker = createTtsSpeaker(ttsDeps(gateway, audio))
    speaker.speak('Two replicas are Ready.', 'en-US', handlers)
    gateway.succeed()
    audio.playStarted()
    await flush()
    audio.errored()
    expect(handlers.onRefused).not.toHaveBeenCalled()
    expect(handlers.onFinished).toHaveBeenCalledTimes(1)
  })

  it('a platform with no audio element at all ends the answer quietly', async () => {
    const gateway = fakeGateway()
    const handlers = spyHandlers()
    const speaker = createTtsSpeaker(ttsDeps(gateway, audioProbe(), { createAudio: () => null }))
    speaker.speak('Two replicas are Ready.', 'en-US', handlers)
    gateway.succeed()
    await flush()
    expect(handlers.onFinished).toHaveBeenCalledTimes(1)
  })

  it('gives up on a request that never comes back, and aborts it on the way out', () => {
    const gateway = fakeGateway()
    const handlers = spyHandlers()
    const speaker = createTtsSpeaker(ttsDeps(gateway, audioProbe()))
    speaker.speak('Two replicas are Ready.', 'en-US', handlers)
    vi.advanceTimersByTime(TTS_REQUEST_TIMEOUT_MS + 1)
    expect(handlers.onFinished).toHaveBeenCalledTimes(1)
    expect(gateway.aborted()).toBe(true)
  })

  it('gives up on playback that reports neither end nor error', async () => {
    const gateway = fakeGateway()
    const audio = audioProbe()
    const store = createSpeakBackStore(null)
    store.installSpeaker(createTtsSpeaker(ttsDeps(gateway, audio)))
    store.speakAnswer(VOICE_TURN)
    gateway.succeed()
    audio.playStarted()
    await flush()
    expect(store.getSnapshot().speaking).toBe(true)
    vi.advanceTimersByTime(600_000)
    expect(store.getSnapshot().speaking).toBe(false)
  })
})

describe('availability keys off the installed speaker (FR 79)', () => {
  it('is available on a machine with NO local voice — the whole reason for the swap', () => {
    const store = createSpeakBackStore(fakeSynthesis([REMOTE_EN]).deps)
    expect(store.getSnapshot()).toMatchObject({ available: false, reason: 'no-local-voice' })
    store.installSpeaker(createTtsSpeaker(ttsDeps(fakeGateway(), audioProbe())))
    expect(store.getSnapshot()).toMatchObject({ available: true, reason: null })
  })

  it('is available with no speechSynthesis at all', () => {
    const store = createSpeakBackStore(null)
    store.installSpeaker(createTtsSpeaker(ttsDeps(fakeGateway(), audioProbe())))
    expect(store.getSnapshot()).toMatchObject({ available: true, reason: null })
  })

  it('the operator kill-switch still wins over an installed TTS speaker', () => {
    const gateway = fakeGateway()
    const store = createSpeakBackStore(null)
    store.installSpeaker(createTtsSpeaker(ttsDeps(gateway, audioProbe())))
    store.setConfigValue('off')
    expect(store.getSnapshot()).toMatchObject({ available: false, reason: 'disabled' })
    expect(store.speakAnswer(VOICE_TURN)).toBe(false)
    expect(gateway.calls).toHaveLength(0)
    store.setConfigValue('on')
    expect(store.getSnapshot().available).toBe(true)
  })
})

describe('no TTS speaker installed — the browser path is untouched', () => {
  it('speaks through speechSynthesis with a local voice, exactly as before', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.installSpeaker(null)
    expect(store.getSnapshot()).toMatchObject({ available: true, reason: null })
    expect(store.speakAnswer(VOICE_TURN)).toBe(true)
    expect(fake.said()).toContain('Two replicas are Ready.')
    expect(fake.spoken[0].voice).toBe(LOCAL_EN)
  })

  it('still reports no-local-voice on a machine that only has remote voices', () => {
    const fake = fakeSynthesis([REMOTE_EN])
    const store = createSpeakBackStore(fake.deps)
    store.installSpeaker(null)
    expect(store.getSnapshot()).toMatchObject({ available: false, reason: 'no-local-voice' })
    expect(store.speakAnswer(VOICE_TURN)).toBe(false)
    expect(fake.spoken).toHaveLength(0)
  })

  it('hands the browser speaker back when the TTS one is removed', async () => {
    const gateway = fakeGateway()
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.installSpeaker(createTtsSpeaker(ttsDeps(gateway, audioProbe())))
    store.speakAnswer(VOICE_TURN)
    expect(gateway.calls).toHaveLength(1)
    expect(fake.spoken).toHaveLength(0)
    store.installSpeaker(null)
    await flush()
    store.speakAnswer({ ...VOICE_TURN, id: 'a2' })
    expect(gateway.calls).toHaveLength(1)
    expect(fake.said()).toContain('Two replicas are Ready.')
  })
})
