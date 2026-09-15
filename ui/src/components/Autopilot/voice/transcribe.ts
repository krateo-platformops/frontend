/**
 * TRANSCRIBE — the one network call dictation makes, and the validation that stands
 * between a transport regression and Autopilot putting words in the user's mouth.
 * Voice spec §2.1, FR 24–26, 49–52, 55, 61, 64.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE SHAPE IS NOT NEGOTIABLE, AND IT IS NOT THE OBVIOUS ONE.
 *
 * The audio rides as a `file` part carrying a `data:audio/…;base64,…` URL. The shape
 * everyone reaches for first — an OpenAI `input_audio` part — is SILENTLY DISCARDED by
 * the gateway's native Gemini translation: measured on the deployed gateway, an
 * `input_audio` request returned `prompt_tokens: 19`, byte-for-byte the count of a
 * text-only control carrying no audio at all, while the same clip as a `file` part
 * returned 111 and a real transcript.
 *
 * "Silently discarded" undersells it. When the audio does not arrive the model does not
 * error and does not return an empty string. It returns a FLUENT, CONFIDENT, ENTIRELY
 * INVENTED SENTENCE. The measured example, for audio it never received, was:
 *
 *     "Hi, John. Can you recommend me some, uh, sci-fi movies that released in 2024?"
 *
 * with `finish_reason: "stop"`, HTTP 200, and nothing whatsoever to distinguish it from a
 * real transcription except the arithmetic. That text would have landed in the user's
 * composer as what they had just said.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * SO THE RESPONSE IS NOT TRUSTED (FR 61). `usage.prompt_tokens` must exceed a generous
 * upper bound on the TEXT prompt by a duration-proportional floor. That check is not
 * telemetry and it is not defensive coding: it is THE ONLY MECHANISM that can tell a
 * transcription from a fabrication, because both are well-formed prose and only one of
 * them cost the model any audio tokens. Missing `usage` is a failure, not a pass. A
 * future gateway version tightening its part handling, a MIME label Vertex stops
 * accepting, an empty blob from a device change — every one of those surfaces here as an
 * error the user can retry, instead of as a sentence they never said.
 *
 * Three more response outcomes are refusals rather than transcripts:
 *   · `length`         — the sentence was cut mid-word ("…in the Tra", measured at a
 *                        fixed 256-token budget). A truncated transcript is as misleading
 *                        as an invented one, so the partial content is DISCARDED.
 *   · `content_filter` — measured transient: the first attempt was filtered with 252
 *                        completion tokens and an IDENTICAL retry succeeded. It fires
 *                        inside Vertex, so no route change removes it; one retry, then
 *                        `blocked`.
 *   · empty / sentinel — the model heard nothing. `no-speech`, nothing appended.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY THE DEPENDENCIES ARE INJECTED RATHER THAN IMPORTED. An ESLint rule fences
 * everything under `voice/` from importing `transport.ts` and the provider's `send`, so
 * that voice input CANNOT submit a turn — the invariant is structural, not a promise, and
 * it is not weakened for convenience here. The portal bearer and the rate-limit detector
 * therefore arrive as injected functions, wired once by the rail (which lives outside the
 * fence). That also makes the whole call testable against a fake `fetch` with no globals.
 */

import { SESSION_COPY, VoiceError } from './errors'
import type { RecordingResult } from './recorder'
import { recordingFilename } from './recorder'
import { sanitizeTranscript } from './sanitizeTranscript'
import { audioArrived, AUDIO_TOKENS_FLOOR, buildVoiceSystemPrompt, maxTokensForSeconds, NO_SPEECH_SENTINEL, TRANSCRIBE_USER_TEXT } from './voicePrompt'

/** Default model when the operator has not named one.
 *
 *  A GENERAL multimodal model, deliberately, not a dedicated speech-to-text one. Google now
 *  publishes `gemini-3.5-transcribe` (and `-live`), which on paper suits dictation better —
 *  utterance-level language detection and diarization, both relevant here since the prompt asks
 *  for a reply in the speaker's own language.
 *
 *  It is NOT the default because this call is an OpenAI-compatible `/chat/completions` carrying
 *  the clip as a `file` part (see the header note: an `input_audio` part is accepted and then
 *  SILENTLY DISCARDED — measured, `prompt_tokens: 19`, identical to sending no audio). Whether a
 *  dedicated transcription model is reachable in that shape through the gateway is unverified,
 *  and the failure mode if it is not is the silent one this file already documents: a confident
 *  transcript of nothing. Switching the default is a change to make against a configured gateway
 *  with a real clip, not from the model list. */
export const DEFAULT_VOICE_MODEL = 'gemini-3.8-flash'
/** FR 27: the gateway's request buffer is 2 MiB and fails closed; stay well inside it. */
export const MAX_BASE64_CHARS = 1_572_864
/** FR 25: one attempt's budget. The gateway's own retry policy can spend ~4 s of it. */
export const ATTEMPT_TIMEOUT_MS = 20_000

/** Everything the call needs that lives outside the voice fence. */
export interface TranscribeDeps {
  /** The portal bearer as a header pair — the A2A path's `a2aAuthHeader()`. */
  authHeader: () => Record<string, string>
  fetchImpl: typeof fetch
  model: string
  /** FR 55: `transport.ts`'s ONE rate-limit detector, injected rather than re-implemented. */
  rateLimitNotice: (raw: string | undefined) => string | null
  /** The 401 in-place resume. Resolves `'resumed'` when the user re-authenticated. */
  raiseSessionExpired: () => Promise<'logout' | 'resumed'>
  url: string
}

export interface TranscribeInput {
  /** Resource/namespace names from the live page, ALREADY redacted (FR 54). */
  contextNames?: readonly string[]
  language: string | undefined
  recording: RecordingResult
}

export interface TranscribeOutcome {
  /** Surfaced so the store can log the arithmetic at debug on every call (FR 61). */
  promptTokens: number
  text: string
  /** The other half of that arithmetic — the text side the estimate is computed from. */
  textPromptChars: number
}

/**
 * FR 64: base64 off the main thread. `FileReader.readAsDataURL` yields the data URL
 * directly, and its media-type prefix is REPLACED with the normalised one rather than
 * trusted from `blob.type` — the browser writes `audio/webm;codecs=opus` there, and the
 * parameter would travel into Vertex's `inlineData.mimeType`.
 */
export const blobToDataUrl = async (blob: Blob, mediaType: string): Promise<string> => {
  const payload = await new Promise<string>((resolve, reject) => {
    const Reader = (globalThis as { FileReader?: typeof FileReader }).FileReader
    if (typeof Reader !== 'function') {
      reject(new VoiceError('engine'))
      return
    }
    const reader = new Reader()
    reader.onerror = () => reject(new VoiceError('engine'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : '')
    }
    reader.readAsDataURL(blob)
  })
  if (!payload) {
    throw new VoiceError('engine')
  }
  if (payload.length > MAX_BASE64_CHARS) {
    throw new VoiceError('too-large')
  }
  return `data:${mediaType};base64,${payload}`
}

/** The §2.1 body. Exported so a test can assert every field of the real request. */
export const buildTranscribeBody = (
  model: string,
  systemPrompt: string,
  dataUrl: string,
  filename: string,
  seconds: number,
): Record<string, unknown> => ({
  max_tokens: maxTokensForSeconds(seconds),
  messages: [
    { content: systemPrompt, role: 'system' },
    {
      content: [
        { text: TRANSCRIBE_USER_TEXT, type: 'text' },
        // NEVER `file_id` (the native Gemini path cannot resolve an OpenAI file id) and
        // NEVER an `input_audio` part (measured: dropped without error).
        { file: { file_data: dataUrl, filename }, type: 'file' },
      ],
      role: 'user',
    },
  ],
  model,
  stream: false,
  temperature: 0,
})

/** The prompt's TEXT length — the denominator of the FR 61 estimate, audio excluded. */
export const promptTextChars = (systemPrompt: string): number => systemPrompt.length + TRANSCRIBE_USER_TEXT.length

interface ChatChoice {
  finish_reason?: string
  message?: { content?: unknown }
}
interface ChatResponse {
  choices?: ChatChoice[]
  usage?: { prompt_tokens?: number }
}

const contentText = (choice: ChatChoice | undefined): string => {
  const content = choice?.message?.content
  if (typeof content === 'string') {
    return content
  }
  // Some translations return the content as an array of parts; join the text ones.
  if (Array.isArray(content)) {
    return content.map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
      ? (part as { text: string }).text
      : '')).join('')
  }
  return ''
}

/** FR 26: HTTP status → error code. `body` is the raw text, read once by the caller. */
const errorForStatus = (status: number, body: string, deps: TranscribeDeps): VoiceError => {
  // Guardrail rejections first: they arrive AS a 502/403 and are a different user story
  // from "your session is bad" or "the gateway is broken".
  if (status === 502 && body.includes('Response blocked')) {
    return new VoiceError('blocked')
  }
  if (status === 403 && body.includes('Request blocked')) {
    return new VoiceError('blocked')
  }
  if (status === 403) {
    return new VoiceError('session', { message: SESSION_COPY[403] })
  }
  if (status === 413) {
    return new VoiceError('too-large')
  }
  const notice = deps.rateLimitNotice(body)
  if (status === 429 || notice) {
    return new VoiceError('rate-limited', { message: notice ?? undefined })
  }
  // 401 falls through DELIBERATELY as `engine` carrying the status: the caller turns it
  // into the in-place session resume and retries the same blob once, and only a refused
  // resume becomes the user-visible `session` error.
  return new VoiceError('engine', { status })
}

/** One POST. Throws `VoiceError`; returns the parsed body on HTTP 200. */
const postOnce = async (
  deps: TranscribeDeps,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<ChatResponse> => {
  // THE OUTER SIGNAL MAY ALREADY BE ABORTED, and `addEventListener('abort', …)` on an
  // already-aborted signal NEVER FIRES — so without this check the fresh inner controller
  // below stays live and the microphone audio is POSTed after the user said stop. The
  // windows are real and some are seconds wide: the base64 encode before the first POST,
  // the gap between the two `content_filter` attempts, and above all the session-resume
  // modal between a 401 and its retry, which has no time bound at all. FR 13/63.
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new VoiceError('timeout')
  }
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()
  signal?.addEventListener('abort', onOuterAbort)
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS)
  // Released in the outer `finally` rather than straight after the fetch: the response BODY
  // is read below, and a body that stalls after its headers arrive would otherwise be
  // abortable by nothing at all — the rail would sit in `transcribing` with Send held until
  // the user cancelled by hand.
  const release = (): void => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }

  try {
    let response: Response
    try {
      response = await deps.fetchImpl(deps.url, {
        body: JSON.stringify(body),
        credentials: 'omit',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...deps.authHeader() },
        method: 'POST',
        signal: controller.signal,
      })
    } catch (thrown) {
      // An abort the CALLER asked for is a cancellation and is re-thrown for the store to
      // recognise; an abort we caused is a timeout; anything else never reached the gateway.
      if (signal?.aborted) {
        throw thrown
      }
      throw new VoiceError(controller.signal.aborted ? 'timeout' : 'network')
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => '')
      throw errorForStatus(response.status, raw, deps)
    }
    try {
      return await response.json() as ChatResponse
    } catch (thrown) {
      if (signal?.aborted) {
        throw thrown
      }
      if (controller.signal.aborted) {
        throw new VoiceError('timeout')
      }
      // FR 49: a non-JSON body (a proxy error page, an HTML 200) is an engine failure, not
      // a transcript and not a crash.
      throw new VoiceError('engine', { status: response.status })
    }
  } finally {
    release()
  }
}

/**
 * Validate one response and return the transcript, or throw. THE ORDER MATTERS: the
 * audio-arrival gate runs BEFORE the empty/sentinel check, so a fabricated non-empty
 * sentence is reported as `no-audio` (the honest cause) rather than slipping past as
 * ordinary text. `content_filter` is signalled separately so the caller can retry it.
 */
const readTranscript = (
  parsed: ChatResponse,
  promptChars: number,
  seconds: number,
): { kind: 'filtered' } | { kind: 'ok'; promptTokens: number; text: string } => {
  const choice = parsed.choices?.[0]
  const finish = choice?.finish_reason
  if (finish === 'content_filter') {
    return { kind: 'filtered' }
  }
  if (finish === 'length') {
    // The partial content is DISCARDED, never offered as a transcript (FR 51).
    throw new VoiceError('engine')
  }
  if (finish !== 'stop') {
    throw new VoiceError('engine')
  }

  const promptTokens = parsed.usage?.prompt_tokens
  if (!audioArrived(promptTokens, promptChars, seconds)) {
    console.warn(
      '[autopilot] dictation rejected — the model was not billed for any audio, so the text it returned is invented, not transcribed.',
      { audioTokensFloorPerSecond: AUDIO_TOKENS_FLOOR, promptTokens, seconds, textPromptChars: promptChars },
    )
    throw new VoiceError('no-audio')
  }

  const raw = contentText(choice)
  if (!raw.trim() || raw.trim() === NO_SPEECH_SENTINEL) {
    throw new VoiceError('no-speech')
  }
  const sanitized = sanitizeTranscript(raw)
  if (!sanitized.ok) {
    throw new VoiceError(sanitized.reason === 'empty' ? 'no-speech' : 'engine')
  }
  return { kind: 'ok', promptTokens: promptTokens as number, text: sanitized.text }
}

/**
 * Transcribe one recording. Resolves with text that has passed every gate, or throws a
 * `VoiceError`. Never resolves with model prose that failed validation — there is no
 * "probably fine" branch, by design.
 */
export const transcribeRecording = async (
  deps: TranscribeDeps,
  input: TranscribeInput,
  signal?: AbortSignal,
): Promise<TranscribeOutcome> => {
  const { recording } = input
  const dataUrl = await blobToDataUrl(recording.blob, recording.mediaType)
  const systemPrompt = buildVoiceSystemPrompt(input.language, input.contextNames ?? [])
  const body = buildTranscribeBody(
    deps.model || DEFAULT_VOICE_MODEL,
    systemPrompt,
    dataUrl,
    recordingFilename(recording.mediaType),
    recording.seconds,
  )
  const promptChars = promptTextChars(systemPrompt)

  const attempt = async (): Promise<ChatResponse> => {
    try {
      return await postOnce(deps, body, signal)
    } catch (thrown) {
      // FR 26: a 401 raises the existing in-place resume. On 'resumed' the SAME blob is
      // retried once (the modal invalidates the token cache); on 'logout' we stop.
      if (thrown instanceof VoiceError && thrown.code === 'engine' && thrown.status === 401) {
        const outcome = await deps.raiseSessionExpired()
        if (outcome !== 'resumed') {
          throw new VoiceError('session', { message: SESSION_COPY[401] })
        }
        return postOnce(deps, body, signal)
      }
      throw thrown
    }
  }

  const first = readTranscript(await attempt(), promptChars, recording.seconds)
  if (first.kind === 'ok') {
    return { promptTokens: first.promptTokens, text: first.text, textPromptChars: promptChars }
  }
  // Measured transient: an identical retry of a filtered request succeeded. Only a SECOND
  // filter is surfaced as `blocked` — and it is Vertex's own filter, so no route change
  // makes it go away.
  const second = readTranscript(await attempt(), promptChars, recording.seconds)
  if (second.kind === 'ok') {
    return { promptTokens: second.promptTokens, text: second.text, textPromptChars: promptChars }
  }
  throw new VoiceError('blocked')
}
