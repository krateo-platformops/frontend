// @vitest-environment jsdom
/**
 * THE TRANSCRIPTION CALL, AND THE GATE THAT MAKES ITS ANSWER TRUSTWORTHY.
 *
 * The centrepiece is `describe('the fabrication gate')`. Its fixture is the literal
 * measured failure: a well-formed HTTP 200 with `finish_reason: "stop"` carrying the
 * fluent invented sentence the model produced for audio it never received, alongside the
 * `prompt_tokens: 19` that proves no audio arrived. The assertion is not that an error is
 * raised — it is that THAT SENTENCE NEVER COMES BACK AS A TRANSCRIPT, because the only
 * thing standing between it and the user's composer is this arithmetic.
 *
 * jsdom is required for `Blob` and `FileReader`; `fetch` is a fake throughout, so no test
 * here touches a network.
 */
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VoiceError } from './errors'
import type { RecordingResult } from './recorder'
import {
  ATTEMPT_TIMEOUT_MS,
  buildTranscribeBody,
  promptTextChars,
  type TranscribeDeps,
  transcribeRecording,
} from './transcribe'
import { buildVoiceSystemPrompt, maxTokensForSeconds, NO_SPEECH_SENTINEL, textTokenEstimate } from './voicePrompt'

/** The exact invented sentence measured coming back for audio the model never received. */
const FABRICATION = 'Hi, John. Can you recommend me some, uh, sci-fi movies that released in 2024?'
/** The prompt-token count of a request carrying NO AUDIO AT ALL, measured. */
const NO_AUDIO_PROMPT_TOKENS = 19

const recording = (overrides: Partial<RecordingResult> = {}): RecordingResult => ({
  blob: new Blob(['fake-opus-bytes'], { type: 'audio/webm' }),
  mediaType: 'audio/webm',
  peakRms: 0.2,
  seconds: 7,
  ...overrides,
})

/** Enough prompt tokens that the FR 61 gate passes for a 7-second clip. */
const enoughTokens = (seconds = 7): number =>
  textTokenEstimate(promptTextChars(buildVoiceSystemPrompt('en-US', []))) + 8 * seconds + 50

const chatResponse = (overrides: {
  content?: string
  finish?: string
  promptTokens?: number | null
} = {}) => ({
  choices: [{
    finish_reason: overrides.finish ?? 'stop',
    message: { content: overrides.content ?? 'scale the payments composition to three replicas' },
  }],
  ...(overrides.promptTokens === null ? {} : { usage: { prompt_tokens: overrides.promptTokens ?? enoughTokens() } }),
})

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    json: () => Promise.resolve(body),
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  }) as unknown as Response

// Typed to the signatures they stand in for — see dictation.test.tsx for why a bare
// `ReturnType<typeof vi.fn>` stopped being assignable in vitest 5.
let fetchImpl: Mock<typeof fetch>
let raiseSessionExpired: Mock<() => Promise<'logout' | 'resumed'>>
let warn: ReturnType<typeof vi.spyOn>

const deps = (overrides: Partial<TranscribeDeps> = {}): TranscribeDeps => ({
  authHeader: () => ({ Authorization: 'Bearer portal-jwt' }),
  fetchImpl,
  model: 'gemini-3.8-flash',
  raiseSessionExpired,
  rateLimitNotice: (raw) => (raw && /RESOURCE_EXHAUSTED|429/.test(raw) ? 'rate limited, retry in a moment' : null),
  url: 'https://gateway.krateo.dev/stt/v1/chat/completions',
  ...overrides,
})

/** The request body as the fake `fetch` received it — always the JSON string we sent. */
const bodyText = (init: RequestInit): string => (typeof init.body === 'string' ? init.body : '')

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
    return 'RESOLVED'
  } catch (thrown) {
    return thrown instanceof VoiceError ? thrown.code : `UNEXPECTED:${String(thrown)}`
  }
}

beforeEach(() => {
  fetchImpl = vi.fn()
  raiseSessionExpired = vi.fn().mockResolvedValue('logout')
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('the fabrication gate (FR 61) — a confident invented sentence must never reach the draft', () => {
  it('REJECTS the measured no-audio response and returns no text at all', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(chatResponse({
      content: FABRICATION,
      finish: 'stop',
      promptTokens: NO_AUDIO_PROMPT_TOKENS,
    })))

    const outcome = await transcribeRecording(deps(), { language: 'en-US', recording: recording() })
      .then(() => 'RESOLVED', (thrown: unknown) => thrown)

    expect(outcome).toBeInstanceOf(VoiceError)
    expect((outcome as VoiceError).code).toBe('no-audio')
    // The whole point: the invented sentence is discarded UNREAD, not surfaced anywhere.
    expect(JSON.stringify(outcome)).not.toContain('sci-fi')
    expect((outcome as VoiceError).message).not.toContain('sci-fi')
    expect((outcome as VoiceError).message).toContain('nothing was added')
  })

  it('logs the arithmetic that condemned it, so a transport regression is diagnosable', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(chatResponse({ content: FABRICATION, promptTokens: NO_AUDIO_PROMPT_TOKENS })))
    await codeOf(transcribeRecording(deps(), { language: 'en-US', recording: recording() }))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/invented, not transcribed/i)
    expect(warn.mock.calls[0][1]).toMatchObject({ promptTokens: NO_AUDIO_PROMPT_TOKENS, seconds: 7 })
  })

  it('treats MISSING usage as a failure — with no arithmetic there is only the model\'s word', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(chatResponse({ content: FABRICATION, promptTokens: null })))
    expect(await codeOf(transcribeRecording(deps(), { language: 'en-US', recording: recording() }))).toBe('no-audio')
  })

  it('lets a REAL transcription through — the gate must not be a false-rejection bug', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(chatResponse()))
    const outcome = await transcribeRecording(deps(), { language: 'en-US', recording: recording() })
    expect(outcome.text).toBe('scale the payments composition to three replicas')
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('the request shape (FR 24, 50)', () => {
  const bodyOf = async (): Promise<Record<string, never>> => {
    await codeOf(transcribeRecording(deps(), { contextNames: ['payments-7f9c'], language: 'it-IT', recording: recording() }))
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    return JSON.parse(bodyText(init)) as Record<string, never>
  }

  beforeEach(() => {
    fetchImpl.mockResolvedValue(jsonResponse(chatResponse()))
  })

  it('POSTs once, to the configured URL only, with the portal bearer and no cookies', async () => {
    await bodyOf()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gateway.krateo.dev/stt/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('omit')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer portal-jwt')
    expect((init.headers as Record<string, string>).Accept).toBe('application/json')
  })

  it('carries the audio as a `file` part with a parameter-free audio media type', async () => {
    const body = await bodyOf() as unknown as { messages: { content: unknown[]; role: string }[] }
    const parts = body.messages[1].content as { file?: { file_data: string; filename: string }; type: string }[]
    expect(parts[0]).toEqual({ text: 'Transcribe the audio.', type: 'text' })
    expect(parts[1].type).toBe('file')
    expect(parts[1].file?.file_data).toMatch(/^data:audio\/webm;base64,/)
    expect(parts[1].file?.filename).toBe('dictation.webm')
    expect(parts[1].file).not.toHaveProperty('file_id')
  })

  it('NEVER sends an input_audio part — measured to be silently discarded by the gateway', async () => {
    const raw = JSON.stringify(await bodyOf())
    expect(raw).not.toContain('input_audio')
  })

  it('sets stream:false, temperature:0, the configured model, and a duration-scaled max_tokens', async () => {
    const body = await bodyOf() as unknown as Record<string, unknown>
    expect(body.stream).toBe(false)
    expect(body.temperature).toBe(0)
    expect(body.model).toBe('gemini-3.8-flash')
    expect(body.max_tokens).toBe(maxTokensForSeconds(7))
  })

  it('scales max_tokens with the clip: a 60 s dictation gets far more than a 7 s one', () => {
    const short = buildTranscribeBody('m', 'p', 'data:audio/webm;base64,AA', 'dictation.webm', 7)
    const long = buildTranscribeBody('m', 'p', 'data:audio/webm;base64,AA', 'dictation.webm', 60)
    expect(long.max_tokens as number).toBeGreaterThan(short.max_tokens as number)
  })

  it('sends the mandatory language hint and the vocabulary bias in the system message', async () => {
    const body = await bodyOf() as unknown as { messages: { content: string }[] }
    expect(body.messages[0].content).toContain('it-IT')
    expect(body.messages[0].content).toMatch(/never translate/i)
    expect(body.messages[0].content).toContain('payments-7f9c')
  })

  it('relabels a Safari audio/mp4 recording as audio/m4a', async () => {
    await codeOf(transcribeRecording(deps(), { language: 'en-US', recording: recording({ mediaType: 'audio/m4a' }) }))
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(bodyText(init)).toContain('data:audio/m4a;base64,')
    expect(bodyText(init)).toContain('dictation.m4a')
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('response validation (FR 51)', () => {
  it('DISCARDS a length-truncated result — a sentence cut mid-word is as misleading as an invented one', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(chatResponse({ content: 'scale the payments composition in the Tra', finish: 'length' })))
    const outcome = await transcribeRecording(deps(), { language: 'en-US', recording: recording() })
      .then(() => 'RESOLVED', (thrown: unknown) => thrown)
    expect((outcome as VoiceError).code).toBe('engine')
    expect((outcome as VoiceError).message).not.toContain('in the Tra')
  })

  it('retries an identical request ONCE on content_filter — measured transient — and succeeds', async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(chatResponse({ content: '', finish: 'content_filter' })))
      .mockResolvedValueOnce(jsonResponse(chatResponse()))
    const outcome = await transcribeRecording(deps(), { language: 'en-US', recording: recording() })
    expect(outcome.text).toBe('scale the payments composition to three replicas')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [[, first], [, second]] = fetchImpl.mock.calls as [string, RequestInit][]
    expect(bodyText(second)).toBe(bodyText(first))
  })

  it('surfaces only a SECOND content_filter as blocked', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(chatResponse({ content: '', finish: 'content_filter' })))
    expect(await codeOf(transcribeRecording(deps(), { language: 'en-US', recording: recording() }))).toBe('blocked')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each([NO_SPEECH_SENTINEL, '', '   '])('maps content %j to no-speech', async (content) => {
    fetchImpl.mockResolvedValue(jsonResponse(chatResponse({ content })))
    expect(await codeOf(transcribeRecording(deps(), { language: 'en-US', recording: recording() }))).toBe('no-speech')
  })

  it('rejects an unrecognised finish_reason rather than trusting its content', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(chatResponse({ finish: 'tool_calls' })))
    expect(await codeOf(transcribeRecording(deps(), { language: 'en-US', recording: recording() }))).toBe('engine')
  })

  it('rejects an over-long result: 60 s of speech cannot produce it, so the model answered', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(chatResponse({ content: 'x'.repeat(4000), promptTokens: enoughTokens() })))
    expect(await codeOf(transcribeRecording(deps(), { language: 'en-US', recording: recording() }))).toBe('engine')
  })

  it('treats an unparseable body as engine, not as a transcript (FR 49)', async () => {
    // `as unknown as Response`, exactly as `jsonResponse` above does: a test double carries the
    // three members the code under test touches, not the whole Response surface. Needed explicitly
    // now only because fetchImpl is typed to `typeof fetch` rather than to an any-shaped mock.
    fetchImpl.mockResolvedValue({
      json: () => Promise.reject(new Error('not json')),
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html>proxy error</html>'),
    } as unknown as Response)
    expect(await codeOf(transcribeRecording(deps(), { language: 'en-US', recording: recording() }))).toBe('engine')
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('HTTP status mapping (FR 26)', () => {
  const cases: [number, string, string][] = [
    [413, 'too big', 'too-large'],
    [429, 'slow down', 'rate-limited'],
    [500, 'boom', 'engine'],
    [503, 'unavailable', 'engine'],
    [403, 'forbidden', 'session'],
    [403, 'Request blocked by guardrails', 'blocked'],
    [502, 'Response blocked: the model returned what looks like a live credential.', 'blocked'],
  ]

  it.each(cases)('%i → %s', async (status, body, expected) => {
    fetchImpl.mockResolvedValue(jsonResponse(body, status))
    expect(await codeOf(transcribeRecording(deps(), { language: 'en-US', recording: recording() }))).toBe(expected)
  })

  it('maps a provider quota body to rate-limited through the ONE injected detector (FR 55)', async () => {
    fetchImpl.mockResolvedValue(jsonResponse('{"error":{"status":"RESOURCE_EXHAUSTED"}}', 500))
    const outcome = await transcribeRecording(deps(), { language: 'en-US', recording: recording() })
      .then(() => null, (thrown: VoiceError) => thrown)
    expect(outcome?.code).toBe('rate-limited')
    expect(outcome?.message).toBe('rate limited, retry in a moment')
  })

  it('maps a fetch rejection to network — an unreachable gateway never affects anything else', async () => {
    fetchImpl.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await codeOf(transcribeRecording(deps(), { language: 'en-US', recording: recording() }))).toBe('network')
  })

  it('on 401 raises the in-place resume and RETRIES THE SAME BLOB once when the user re-authenticates', async () => {
    raiseSessionExpired.mockResolvedValue('resumed')
    fetchImpl
      .mockResolvedValueOnce(jsonResponse('unauthorized', 401))
      .mockResolvedValueOnce(jsonResponse(chatResponse()))
    const outcome = await transcribeRecording(deps(), { language: 'en-US', recording: recording() })
    expect(raiseSessionExpired).toHaveBeenCalledTimes(1)
    expect(outcome.text).toBe('scale the payments composition to three replicas')
    const [[, first], [, second]] = fetchImpl.mock.calls as [string, RequestInit][]
    expect(bodyText(second)).toBe(bodyText(first))
  })

  it('on 401 with a refused resume stops, with the session copy and no retry', async () => {
    raiseSessionExpired.mockResolvedValue('logout')
    fetchImpl.mockResolvedValue(jsonResponse('unauthorized', 401))
    const outcome = await transcribeRecording(deps(), { language: 'en-US', recording: recording() })
      .then(() => null, (thrown: VoiceError) => thrown)
    expect(outcome?.code).toBe('session')
    expect(outcome?.message).toContain('401')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
describe('bounds', () => {
  it('caps one attempt at 20 s, inside the phase budget the store owns', () => {
    expect(ATTEMPT_TIMEOUT_MS).toBe(20_000)
  })

  it('refuses an over-cap payload WITHOUT uploading it', async () => {
    // 2 MiB of bytes base64-encodes past the 1,572,864-char cap the gateway's request
    // buffer imposes; the request must never be attempted.
    const huge = recording({ blob: new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'audio/webm' }) })
    expect(await codeOf(transcribeRecording(deps(), { language: 'en-US', recording: huge }))).toBe('too-large')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────────────────────────────────────
/**
 * CANCELLING MUST ACTUALLY CANCEL. `addEventListener('abort', …)` on a signal that has
 * ALREADY aborted never fires — so a call that reaches this module after the user pressed
 * Escape, switched thread or collapsed the rail would build a fresh inner controller,
 * never abort it, and upload the microphone audio anyway. The store discards the resulting
 * text, so the visible symptom is nothing at all; the invisible one is a recording sent to
 * Vertex after the user said stop (FR 13/63).
 */
describe('an already-aborted signal stops the upload', () => {
  it('never POSTs when the signal aborted before the call', async () => {
    const controller = new AbortController()
    controller.abort()
    fetchImpl.mockResolvedValue(jsonResponse(chatResponse()))

    await transcribeRecording(deps(), { language: 'en-US', recording: recording() }, controller.signal)
      .then(() => 'RESOLVED', () => 'THREW')

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never POSTs the RETRY when the signal aborted while the session-resume modal was open', async () => {
    const controller = new AbortController()
    // The 401 parks the call on the modal. Whatever the user does to the rail meanwhile —
    // Escape, a thread switch, the phase budget expiring — aborts this signal with no
    // fetch in flight to notice.
    raiseSessionExpired.mockImplementation(() => {
      controller.abort()
      return Promise.resolve('resumed')
    })
    fetchImpl
      .mockResolvedValueOnce(jsonResponse('unauthorized', 401))
      .mockResolvedValueOnce(jsonResponse(chatResponse()))

    await transcribeRecording(deps(), { language: 'en-US', recording: recording() }, controller.signal)
      .then(() => 'RESOLVED', () => 'THREW')

    expect(raiseSessionExpired).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('never POSTs the content_filter retry when the signal aborted between the attempts', async () => {
    const controller = new AbortController()
    fetchImpl
      .mockImplementationOnce(() => {
        controller.abort()
        return Promise.resolve(jsonResponse(chatResponse({ content: '', finish: 'content_filter' })))
      })
      .mockResolvedValueOnce(jsonResponse(chatResponse()))

    await transcribeRecording(deps(), { language: 'en-US', recording: recording() }, controller.signal)
      .then(() => 'RESOLVED', () => 'THREW')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
