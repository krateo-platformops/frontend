/**
 * RECORDER — microphone in, one compressed blob out. No network, ever.
 * Voice spec FR 7, 12, 13, 23, 27, 56, 66.
 *
 * THE LOUDNESS GATE IS THE REASON THIS FILE MEASURES ANYTHING (FR 66). The same
 * `AnalyserNode` that powers the level meter and the silence auto-stop also tracks the
 * PEAK RMS OF THE WHOLE RECORDING, and if that peak never crossed the speech threshold
 * the blob is NOT UPLOADED AT ALL — a muted microphone, the wrong input device, or a mic
 * held by another application produces `no-speech`, not a request.
 *
 * That is not an optimisation. Thirty seconds of silence still bills ~960 audio tokens,
 * so it sails straight through the token-arithmetic gate on the response side; and the
 * measured behaviour of the model when it has nothing to transcribe is not an empty
 * string or an error — it is a confident, fluent, entirely invented sentence. The two
 * gates close different halves of the same hole: this one catches audio that reached the
 * model carrying nothing, the response gate catches audio that never reached it.
 *
 * WHY EVERYTHING IS INJECTED. jsdom has no `getUserMedia`, no `MediaRecorder` and no
 * `AudioContext`, so none of this is testable against the real platform. `RecorderDeps`
 * is the entire surface the recorder needs; `browserRecorderDeps()` is the ONE place the
 * real globals are read, and tests hand in a fake that can be silent, loud, slow, or
 * broken on demand.
 *
 * THE TRACKS ARE ALWAYS STOPPED (FR 23). Every exit — success, cancel, error, auto-stop,
 * a permission revoked mid-recording — runs through `release()`. A live-microphone
 * indicator left burning in the browser tab after a failed dictation is the single most
 * alarming thing this feature could do, and it would be a bug the user cannot fix.
 */

import { audioFileExtension, normalizeAudioMediaType } from './capability'
import { VoiceError } from './errors'
import { MIN_RECORDING_SECONDS } from './voicePrompt'

/** Hard cap on one dictation (FR 12/27). Also what bounds the payload against the
 *  gateway's 2 MiB request buffer at the requested 32 kbit/s. */
export const MAX_RECORDING_MS = 60_000
/**
 * Silence that ends a recording (FR 12).
 *
 * 8 s was right when this was DICTATION: you were composing a message into the composer and
 * a long pause meant you were still thinking. Pressing the microphone is now a spoken TURN
 * that sends itself, and in a conversation 8 s of dead air after you stop talking reads as
 * the thing being broken — you have finished speaking and nothing happens.
 *
 * 1.2 s is the conversational endpoint: comfortably past the ~250-500 ms pauses inside a
 * sentence, short enough that the turn goes while you are still expecting it to. It is a
 * COMPROMISE, and worth naming as one — a client-side RMS timer cannot tell "finished" from
 * "thinking", so a long mid-thought pause will cut you off where 8 s would not. The real fix
 * is server-side endpointing, where the MODEL decides the turn ended; until that lands this
 * number is the whole of the heuristic.
 */
export const SILENCE_STOP_MS = 1_200
/**
 * How long to wait for the user to START, before any speech has been heard at all.
 *
 * These are two different silences and collapsing them is a bug: the gap AFTER you stop
 * talking ends your turn, but the gap BEFORE you begin is you drawing breath. Sharing one
 * 1.2 s window means pressing the microphone and pausing to gather the thought stops the
 * recording before the first word — the old 8 s value hid that, which is exactly why it did
 * not show up until the window was shortened. Real server-side VAD splits the same pair
 * (prefix padding vs end-of-speech sensitivity); this is that split, done locally.
 */
export const SILENCE_LEAD_IN_MS = 8_000
/** RMS (0..1) above which the analyser considers the room to contain speech. */
export const SPEECH_RMS_THRESHOLD = 0.02
/** How often the level/silence/duration ticker runs. */
export const LEVEL_TICK_MS = 100
/** Requested encoder bitrate: ~240 KB for a full 60 s recording. */
export const AUDIO_BITS_PER_SECOND = 32_000

/** The slice of `MediaStreamTrack` we use — one method, and it is the important one. */
export interface MediaTrackLike { stop: () => void }
/** The slice of `MediaStream` we use. */
export interface MediaStreamLike { getTracks: () => MediaTrackLike[] }

/** The slice of `MediaRecorder` we drive. */
export interface MediaRecorderLike {
  ondataavailable: ((event: { data: Blob }) => void) | null
  onerror: ((event: unknown) => void) | null
  onstop: (() => void) | null
  start: (timesliceMs?: number) => void
  stop: () => void
}

/** A live loudness probe over the stream. `close()` must release the AudioContext. */
export interface LevelMeterLike {
  close: () => void
  /** Current RMS in 0..1. Polled; never pushed, so the ticker owns the cadence. */
  rms: () => number
}

/** Everything the recorder needs from the platform. The only seam; tests replace it whole. */
export interface RecorderDeps {
  /** Null when this browser cannot analyse the stream — the loudness gate then cannot be
   *  enforced, which is treated as "do not record" rather than "upload unchecked". */
  createLevelMeter: (stream: MediaStreamLike) => LevelMeterLike | null
  createRecorder: (stream: MediaStreamLike, mimeType: string) => MediaRecorderLike
  getUserMedia: () => Promise<MediaStreamLike>
  now: () => number
}

/** What one finished recording is, as `transcribe.ts` receives it. */
export interface RecordingResult {
  blob: Blob
  /** Normalised, parameter-free (FR 50): audio/webm | audio/ogg | audio/m4a. */
  mediaType: string
  /** FR 66: the loudest moment of the whole recording, 0..1. */
  peakRms: number
  /** Wall-clock length, which is what both token gates are proportioned against. */
  seconds: number
}

/** Why a recording stopped on its own (FR 12). Neither is an error. */
export type AutoStopReason = 'max-duration' | 'silence'

export interface RecordingHandlers {
  /** A recording ended by itself; the result still follows via `onResult`. */
  onAutoStop: (reason: AutoStopReason) => void
  /** Terminal. The tracks are already released by the time this fires. */
  onError: (error: VoiceError) => void
  /** 0..1, on every tick, for the level meter. */
  onLevel: (rms: number) => void
  /** The recording is complete AND passed the loudness gate. */
  onResult: (result: RecordingResult) => void
  /** Elapsed milliseconds, on every tick, for the m:ss timer. */
  onTick: (elapsedMs: number) => void
}

/** The handle the store keeps. `stop` finishes and uploads; `cancel` discards. */
export interface RecordingSession {
  cancel: () => void
  stop: () => void
}

/**
 * Map a `getUserMedia` rejection onto the two outcomes the user can act on. Anything
 * else is a denial in practice — the browser refused the microphone and the reason is
 * not one we can explain better than "allow it when asked".
 */
const mediaErrorCode = (thrown: unknown): 'denied' | 'no-mic' => {
  const name = (thrown as { name?: string } | null)?.name ?? ''
  return name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError'
    ? 'no-mic'
    : 'denied'
}

/**
 * Read the real browser globals, or null when this browser cannot record. Never called
 * from a test. `echoCancellation` and `noiseSuppression` are requested because the
 * speaker sits a metre from the microphone in an office and both measurably improve what
 * the model receives; neither is required, and a browser that ignores them still works.
 */
export const browserRecorderDeps = (): RecorderDeps | null => {
  const scope = globalThis as unknown as {
    AudioContext?: new () => AudioContext
    MediaRecorder?: new (stream: MediaStream, options?: MediaRecorderOptions) => MediaRecorder
    navigator?: Navigator
    webkitAudioContext?: new () => AudioContext
  }
  const media = scope.navigator?.mediaDevices
  const Recorder = scope.MediaRecorder
  if (!media || typeof media.getUserMedia !== 'function' || typeof Recorder !== 'function') {
    return null
  }
  const AudioCtx = scope.AudioContext ?? scope.webkitAudioContext
  return {
    createLevelMeter: (stream) => {
      if (!AudioCtx) {
        return null
      }
      try {
        const context = new AudioCtx()
        const analyser = context.createAnalyser()
        analyser.fftSize = 2048
        context.createMediaStreamSource(stream as MediaStream).connect(analyser)
        const samples = new Float32Array(analyser.fftSize)
        return {
          close: () => { void context.close().catch(() => undefined) },
          rms: () => {
            analyser.getFloatTimeDomainData(samples)
            let sum = 0
            for (const sample of samples) {
              sum += sample * sample
            }
            return Math.sqrt(sum / samples.length)
          },
        }
      } catch {
        return null
      }
    },
    createRecorder: (stream, mimeType) => new Recorder(stream as unknown as MediaStream, {
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      mimeType,
    }) as unknown as MediaRecorderLike,
    getUserMedia: () => media.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    }),
    now: () => Date.now(),
  }
}

/** The filename the request carries. Cosmetic — the media type is what the gateway reads. */
export const recordingFilename = (mediaType: string): string => `dictation.${audioFileExtension(mediaType)}`

/**
 * Open the microphone and start recording. Resolves once capture is actually running, so
 * the caller can move to `listening` on a fact rather than an intention; rejects with a
 * `VoiceError` when the microphone could not be opened at all.
 */
export const startRecording = async (
  deps: RecorderDeps,
  mimeType: string,
  handlers: RecordingHandlers,
): Promise<RecordingSession> => {
  let stream: MediaStreamLike
  try {
    stream = await deps.getUserMedia()
  } catch (thrown) {
    throw new VoiceError(mediaErrorCode(thrown))
  }

  const mediaType = normalizeAudioMediaType(mimeType)
  const startedAt = deps.now()
  const chunks: Blob[] = []
  let meter: LevelMeterLike | null = null
  let recorder: MediaRecorderLike | null = null
  let ticker: ReturnType<typeof setInterval> | null = null
  let peakRms = 0
  let lastLoudAt = startedAt
  let heardSpeech = false
  let settled = false
  let discarded = false

  /** FR 23: the single exit. Idempotent — every path may call it. */
  const release = (): void => {
    if (ticker !== null) {
      clearInterval(ticker)
      ticker = null
    }
    meter?.close()
    meter = null
    for (const track of stream.getTracks()) {
      try {
        track.stop()
      } catch {
        // A track already ended by the browser (device unplugged) throws here on some
        // engines. There is nothing left to release and nothing useful to report.
      }
    }
  }

  const fail = (error: VoiceError): void => {
    if (settled) {
      return
    }
    settled = true
    release()
    handlers.onError(error)
  }

  const finish = (): void => {
    if (settled) {
      return
    }
    settled = true
    const seconds = Math.max(0.1, (deps.now() - startedAt) / 1000)
    release()
    if (discarded) {
      return
    }
    // TOO SHORT TO BE SPEECH, and too short for the response gate to mean anything. FR 61's
    // floor is duration-proportional, so a fifth of a second asks it for under two audio
    // tokens — a threshold a fabrication clears without carrying any audio at all. A
    // press-and-release misclick is the reachable case (a click or a pop can cross the RMS
    // threshold), and nothing anyone dictates fits in under a second, so this is `no-speech`
    // and nothing is uploaded.
    if (seconds < MIN_RECORDING_SECONDS) {
      handlers.onError(new VoiceError('no-speech'))
      return
    }
    // FR 66 — THE HEARD-SOMETHING GATE. Nothing crossed the speech threshold for the whole
    // recording, so there is nothing to transcribe and nothing to fabricate from. Not
    // uploaded: no request, no spend, no invented sentence.
    if (peakRms < SPEECH_RMS_THRESHOLD) {
      handlers.onError(new VoiceError('no-speech'))
      return
    }
    handlers.onResult({ blob: new Blob(chunks, { type: mediaType }), mediaType, peakRms, seconds })
  }

  try {
    recorder = deps.createRecorder(stream, mimeType)
  } catch {
    release()
    throw new VoiceError('engine')
  }

  recorder.ondataavailable = (event) => {
    if (event.data && (event.data.size === undefined || event.data.size > 0)) {
      chunks.push(event.data)
    }
  }
  recorder.onerror = () => fail(new VoiceError('engine'))
  recorder.onstop = () => finish()

  meter = deps.createLevelMeter(stream)
  // No analyser means the loudness gate cannot be enforced, and an unenforceable FR 66 is
  // exactly the condition under which the model invents a sentence. Refuse to record
  // rather than upload something we cannot vouch for.
  if (!meter) {
    release()
    throw new VoiceError('engine')
  }

  const stopRecorder = (): void => {
    if (ticker !== null) {
      clearInterval(ticker)
      ticker = null
    }
    try {
      recorder?.stop()
    } catch {
      // Already stopped, or stopped by the browser. `onstop` may never fire in that case,
      // so settle the session here rather than leaving the store stuck in `listening`.
      finish()
    }
  }

  ticker = setInterval(() => {
    const now = deps.now()
    const level = meter?.rms() ?? 0
    peakRms = Math.max(peakRms, level)
    if (level >= SPEECH_RMS_THRESHOLD) {
      lastLoudAt = now
      heardSpeech = true
    }
    handlers.onLevel(level)
    handlers.onTick(now - startedAt)
    if (now - startedAt >= MAX_RECORDING_MS) {
      handlers.onAutoStop('max-duration')
      stopRecorder()
      return
    }
    // Trailing silence ends the TURN, but only once there is a turn to end; before the first
    // word the budget is the lead-in instead. Both report 'silence' — for a recording with no
    // speech in it the transcription step returns the no-speech sentinel and nothing is
    // appended, which is the same outcome as before and needs no new caller handling.
    const quietFor = heardSpeech ? now - lastLoudAt : now - startedAt
    const quietBudget = heardSpeech ? SILENCE_STOP_MS : SILENCE_LEAD_IN_MS
    if (quietFor >= quietBudget) {
      handlers.onAutoStop('silence')
      stopRecorder()
    }
  }, LEVEL_TICK_MS)

  try {
    recorder.start(LEVEL_TICK_MS * 2)
  } catch {
    release()
    throw new VoiceError('engine')
  }

  return {
    cancel: () => {
      // FR 13: the recording is DISCARDED — no upload, nothing appended, draft untouched.
      discarded = true
      stopRecorder()
      if (!settled) {
        settled = true
        release()
      }
    },
    stop: () => stopRecorder(),
  }
}
