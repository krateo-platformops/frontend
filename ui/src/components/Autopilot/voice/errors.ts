/**
 * DICTATION ERROR VOCABULARY — the closed set of things that can go wrong between the
 * microphone and the composer, and the exact words the user is shown for each (voice
 * spec FR 21).
 *
 * It lives in its own module because BOTH halves of capture need it and neither may
 * import the other: `recorder.ts` (which never touches the network) raises `denied`,
 * `no-mic` and `no-speech`, and `transcribe.ts` (which never touches the microphone)
 * raises the rest. A shared error type is the only thing they have in common.
 *
 * TWO OF THESE CODES ARE THE SAFETY FEATURE, not error handling:
 *
 *   · `no-audio`  — the response came back fluent and confident, but the token
 *                   arithmetic proves the model never received any audio, so the text is
 *                   a fabrication (FR 61, §1.2). Measured: a request whose audio the
 *                   gateway silently discarded returned "Hi, John. Can you recommend me
 *                   some, uh, sci-fi movies that released in 2024?" with
 *                   `finish_reason: "stop"`, for audio that said something else entirely.
 *   · `no-speech` — the microphone was open but never heard anything above the speech
 *                   threshold (FR 66), so nothing is uploaded at all. Thirty seconds of
 *                   silence still bills ~960 audio tokens and would sail through the
 *                   `no-audio` arithmetic, and the model writes a plausible sentence
 *                   anyway when it has nothing to transcribe.
 *
 * Both say "nothing was added" in as many words, because the one thing the user must be
 * able to trust is that a failure NEVER leaves invented text in the composer.
 */

/** Every way dictation can fail, as one closed union. */
export type VoiceErrorCode
  = 'blocked'
  | 'denied'
  | 'engine'
  | 'network'
  | 'no-audio'
  | 'no-mic'
  | 'no-speech'
  | 'rate-limited'
  | 'session'
  | 'timeout'
  | 'too-large'

/**
 * The user-facing line for each code (FR 21). `rate-limited` and `session` carry a
 * placeholder here: their real copy is owned elsewhere and passed in at throw time —
 * the rate-limit notice by `transport.ts`'s `rateLimitNotice()` (FR 55: one detector,
 * one string, no second copy of either) and the auth copy by the two status lines the
 * A2A path already shows. Both arrive through `VoiceError`'s explicit `message`.
 */
export const VOICE_ERROR_COPY: Readonly<Record<VoiceErrorCode, string>> = Object.freeze({
  blocked: 'The gateway\'s content filter blocked this transcript — type it instead.',
  denied: 'Microphone access was denied. Allow it when the browser asks to dictate.',
  engine: 'Transcription failed — try again.',
  network: 'Speech service unreachable — check your connection.',
  'no-audio': 'The recording didn\'t reach the transcriber — nothing was added. Try again.',
  'no-mic': 'No microphone found.',
  'no-speech': 'No speech detected — nothing was added. Try again.',
  'rate-limited': 'Krateo Agentiko is temporarily rate-limited by the AI provider. Please retry in a moment.',
  session: 'Agentiko rejected the request — your session is not valid. Sign in again.',
  timeout: 'Transcription took too long — try a shorter dictation.',
  'too-large': 'Recording too large to send — keep it under a minute.',
})

/** The 401 / 403 lines, kept identical to the A2A turn path's `describeHttpFailure`. */
export const SESSION_COPY: Readonly<Record<401 | 403, string>> = Object.freeze({
  401: 'Agentiko rejected the request (401) — your session is not valid. Sign in again.',
  403: 'Agentiko denied the request (403) — your user is not allowed to use this agent.',
})

/** A dictation failure with a code the UI can branch on and copy it can render as-is. */
export class VoiceError extends Error {
  readonly code: VoiceErrorCode
  /** The HTTP status, when the failure came from one — folded into the `engine` copy. */
  readonly status?: number

  constructor(code: VoiceErrorCode, options: { message?: string; status?: number } = {}) {
    super(options.message ?? (code === 'engine' && options.status
      ? `Transcription failed (HTTP ${options.status}) — try again.`
      : VOICE_ERROR_COPY[code]))
    this.code = code
    this.name = 'VoiceError'
    this.status = options.status
  }
}

/** Narrow an unknown thrown value to a `VoiceError`, or wrap it as `engine`. */
export const asVoiceError = (thrown: unknown): VoiceError =>
  (thrown instanceof VoiceError ? thrown : new VoiceError('engine'))
