/**
 * CLOUD TEXT-TO-SPEECH SPEAKER — the same `Speaker` the browser synthesiser implements,
 * backed by Google Cloud Text-to-Speech reached through THE PORTAL'S OWN ORIGIN.
 * Voice spec §3.2, FR 68 / 74 / 78.
 *
 * WHY IT REPLACES THE BROWSER VOICE. `speechEngine.ts` pins `localService === true`
 * because a remote browser voice synthesises on the VOICE VENDOR'S servers: the full text
 * of an Autopilot answer — cluster names, namespaces, whatever the agent read — leaves the
 * browser for a third party the operator never chose. That pin is not negotiable, and it
 * costs twice over: on the probed machine the local voices are the ones that sound bad,
 * and a machine with NO local voice gets no speak-back at all.
 *
 * Cloud TTS pays neither price without giving the privacy argument up, because the answer
 * text does not leave the portal's trust boundary the way a vendor voice's does. The
 * browser POSTs to `<portal-origin>/tts/v1/text:synthesize` carrying ITS OWN portal
 * bearer; the agentgateway route is Strict-JWT gated for authenticated portal users, and
 * it is the GATEWAY that holds the GCP credential (`policies.auth.gcp`) and rewrites the
 * request upstream. The page never holds a Google credential and never talks to Google.
 * The operator who runs the gateway is the same operator who runs the portal.
 *
 * WHY THIS FILE IS ONE DIRECTORY OUTSIDE `voice/speak/`. Everything under `voice/speak/`
 * is fenced from making ANY network call, so that FR 68 — the spoken words are the written
 * words, never a second generation of them — is structural rather than a promise. A TTS
 * client IS a network call, so it cannot live inside that fence, and the fence names this
 * file explicitly so a later edit cannot quietly reach for it from within. What crosses
 * the fence is one `Speaker`, INJECTED by `voiceWiring.ts` through `installSpeaker()`.
 * The store hands that speaker the exact same `speakableForMessage()` string it hands the
 * browser one, so swapping the implementation preserves FR 68 by construction: this module
 * never sees a message, only a finished string it must not alter.
 *
 * WHY IT IS INJECTABLE. jsdom has neither `Audio` nor `AudioContext`, so a real unit test
 * has nothing to drive. `TtsDeps` is the whole platform surface this module touches —
 * fetch, the bearer, an audio element factory — and tests replace it whole, exactly as
 * `SpeechDeps` is replaced for the browser speaker.
 */

import type { Speaker, SpeakerHandlers } from './speak/speechEngine'

/**
 * The Cloud TTS voice when the operator has not named one in `AUTOPILOT_VOICE_NAME`.
 * A Chirp 3 HD voice — the generative tier, which is the whole reason for leaving the
 * browser's local voices behind. Overridable per install because a voice is a matter of
 * taste and of language, and neither is ours to decide from here.
 */
export const DEFAULT_TTS_VOICE = 'en-US-Chirp3-HD-Achernar'

/** MP3, decoded by `<audio>` everywhere. OGG_OPUS is smaller and Safari does not play it,
 *  and speak-back is a courtesy — it must not be the feature that needs a browser matrix. */
const AUDIO_ENCODING = 'MP3'
const AUDIO_MEDIA_TYPE = 'audio/mpeg'

/** One synthesis request's budget, mirroring the transcription attempt's: the same gateway,
 *  the same retry policy underneath it. */
export const TTS_REQUEST_TIMEOUT_MS = 20_000

/**
 * FR 74's watchdog, on the playback half: audio that reports neither `ended` nor `error`
 * must not leave `speaking` true forever. The per-character allowance is the browser
 * speaker's (`4000 + length * 200`), applied to the WHOLE answer rather than to one
 * 200-character chunk, because Cloud TTS returns one clip for the whole string — there is
 * no chunk queue here to stall part-way through, which is the Chromium failure the browser
 * speaker chunks for.
 */
const playbackTimeoutMs = (text: string): number => 4000 + text.length * 200

/** What the audio element must report back. Handed to the factory rather than assigned
 *  afterwards, so a real `HTMLAudioElement` can be adapted at the one place it is built. */
export interface TtsAudioHandlers {
  onEnded: () => void
  onError: () => void
}

/** The subset of `HTMLAudioElement` this module drives. */
export interface TtsAudioLike {
  pause: () => void
  play: () => Promise<void>
}

/** Everything the speaker needs from the platform. The only seam; tests replace it whole. */
export interface TtsDeps {
  /** The portal bearer as a header pair — the A2A path's `a2aAuthHeader()`. The gateway
   *  validates it and the Google credential is added on the far side of it. */
  authHeader: () => Record<string, string>
  /** Null when this platform has no audio element at all (jsdom, and nothing else in
   *  practice) — the caller degrades quietly rather than pretending to speak. */
  createAudio: (src: string, handlers: TtsAudioHandlers) => TtsAudioLike | null
  fetchImpl: typeof fetch
  /** The synthesize endpoint, from `AUTOPILOT_VOICE_TTS_URL`. Never hard-coded. */
  url: string
  /** The Cloud TTS voice name, from `AUTOPILOT_VOICE_NAME`. */
  voiceName: string
  /**
   * Gemini-TTS model, from `AUTOPILOT_VOICE_TTS_MODEL`. Absent keeps the Chirp/standard
   * request shape byte-for-byte, so an install that never sets it is unaffected.
   */
  modelName?: string
  /**
   * Gemini-TTS styling instruction, from `AUTOPILOT_VOICE_STYLE_PROMPT`. Only a Gemini-TTS
   * model reads it; sending it without `modelName` would be a field the API does not expect,
   * so the two travel together or not at all.
   */
  stylePrompt?: string
}

/** Read the real browser `Audio`, or null when there is none. The one place the real
 *  global is touched; never called from a test (which injects `createAudio` directly). */
export const browserTtsAudio = (src: string, handlers: TtsAudioHandlers): TtsAudioLike | null => {
  const Ctor = (globalThis as { Audio?: new (src?: string) => HTMLAudioElement }).Audio
  if (typeof Ctor !== 'function') {
    return null
  }
  const element = new Ctor(src)
  element.onended = () => handlers.onEnded()
  element.onerror = () => handlers.onError()
  return element
}

/**
 * The `languageCode` that rides beside `voice.name`. THE NAME IS AUTHORITATIVE: a Cloud
 * TTS voice serves one language, and `en-US-Chirp3-HD-Achernar` will not read Italian
 * because `navigator.language` says `it-IT` — asking for that pairing describes a voice
 * that does not exist. So the code is read off the configured name's own leading
 * `<lang>-<REGION>` segments, and the caller's UI language is the fallback for a name that
 * carries none. An install that wants Italian speak-back configures an Italian voice.
 */
export const ttsLanguageCode = (voiceName: string, language: string): string => {
  const parts = voiceName.split('-')
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return `${parts[0]}-${parts[1]}`
  }
  return language || 'en-US'
}

/**
 * The standard Cloud TTS `text:synthesize` body. Exported so a test can assert every field
 * of the real request — and, more to the point, that `input.text` is the string it was
 * handed, unaltered (FR 68).
 */
export const buildSynthesizeBody = (
  text: string,
  voiceName: string,
  language: string,
  modelName?: string,
  stylePrompt?: string,
): Record<string, unknown> => {
  const voice: Record<string, unknown> = {
    languageCode: ttsLanguageCode(voiceName, language),
    name: voiceName,
  }
  const input: Record<string, unknown> = { text }
  // GEMINI-TTS, and ONLY when a model is named. `model_name` selects the generative tier and
  // `input.prompt` steers delivery in natural language — which is the only lever that reaches
  // the problem a voice name cannot: an Italian answer carrying English technical jargon.
  // A locale-pinned voice gets exactly one of the two right. `en-US-Chirp3-HD-Achernar` reads
  // Italian prose with English phonetics (reported live); an it-IT voice fixes the prose and
  // then Italianises `Deployment` and `namespace`. The prompt is where you ask for both.
  //
  // Both fields are omitted entirely when no model is configured, so the Chirp request stays
  // byte-for-byte what it was and no install changes behaviour by upgrading.
  if (modelName) {
    voice.model_name = modelName
    if (stylePrompt) {
      input.prompt = stylePrompt
    }
  }
  return { audioConfig: { audioEncoding: AUDIO_ENCODING }, input, voice }
}

/**
 * FR 78: the autoplay policy REFUSED to start audio for lack of a user activation. It is
 * the same refusal `speechSynthesis` reports as `error: 'not-allowed'` — a distinct,
 * recoverable outcome the store turns into "Play answer", never a failure — and on the
 * media path it arrives as a rejected `play()` whose `DOMException.name` is
 * `NotAllowedError`. Every OTHER rejection (a clip the decoder refused, a `pause()` that
 * interrupted the `play()` it raced) is a plain failure and ends the answer quietly.
 */
const isAutoplayRefusal = (thrown: unknown): boolean =>
  typeof thrown === 'object' && thrown !== null && (thrown as { name?: unknown }).name === 'NotAllowedError'

/**
 * One answer at a time over `TtsDeps` (FR 45), fetched then played.
 *
 * EXACTLY ONE OUTCOME PER `speak()`, and the latch is not decoration. The browser speaker
 * gets that from its generation counter alone because it reports NOTHING from `cancel()` —
 * the store clears `speaking` itself in the same call. This one has to report, because a
 * cancel here can land while a fetch promise or a `play()` promise is still outstanding and
 * those continuations run afterwards; and `cancel()`'s own `pause()` REJECTS the `play()`
 * it interrupts, which would otherwise be a second outcome for the same answer. So the
 * active call's handlers are held in `pending`, taken by whichever outcome arrives first,
 * and the generation counter keeps a stale continuation from settling a NEWER call.
 */
export const createTtsSpeaker = (deps: TtsDeps): Speaker => {
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  let audio: TtsAudioLike | null = null
  /** The active call's handlers, or null once an outcome has been reported for it. */
  let pending: SpeakerHandlers | null = null

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** Drop every platform handle the active call holds. Safe when idle, and safe twice. */
  const release = (): void => {
    clearTimer()
    try {
      controller?.abort()
    } catch {
      // An AbortController that throws must not wedge the rail: the request is abandoned
      // by the generation bump either way, and the handle is dropped below regardless.
    }
    controller = null
    try {
      audio?.pause()
    } catch {
      // Same for a pause() that throws — nothing later can trip over a handle we no
      // longer hold.
    }
    audio = null
  }

  /** Report the first outcome to arrive, and only the first. */
  const settle = (report: (handlers: SpeakerHandlers) => void): void => {
    const handlers = pending
    if (!handlers) {
      return
    }
    pending = null
    release()
    report(handlers)
  }

  /**
   * Stop, and report `onFinished` for an answer that was still going. The browser speaker
   * leaves that report to the store; here the caller may be racing a request that has not
   * come back, so "speaking is over" has to be said by the only code that knows it.
   */
  const cancel = (): void => {
    generation += 1
    const handlers = pending
    pending = null
    release()
    handlers?.onFinished()
  }

  return {
    cancel,
    /**
     * Returns false ONLY when there is nothing to say — no handler will fire in that case,
     * which is the contract the store's `startSpeaking` reads. It cannot return false for
     * "no usable voice" the way the browser speaker does: the voice is the operator's
     * configured name and whether Cloud TTS will serve it is not knowable until the
     * response comes back. A voice the gateway rejects therefore arrives as a failed
     * request — reported through `onFinished`, after this has already returned true.
     */
    speak: (text, language, handlers) => {
      cancel()
      if (!text.trim()) {
        return false
      }
      const mine = generation
      const isStale = (): boolean => mine !== generation
      const abort = new AbortController()
      pending = handlers
      controller = abort
      timer = setTimeout(() => settle((active) => active.onFinished()), TTS_REQUEST_TIMEOUT_MS)

      const play = (dataUrl: string): void => {
        // STALE-GUARDED, like its two sibling continuations below. `release()` drops our
        // reference to an element but cannot DETACH its handlers — the seam hands back an
        // opaque handle — so a cancelled answer's element stays wired to this closure. Without
        // the guard that closure reports into whatever `pending` holds NEXT, and because
        // `settle()` calls `release()`, a dead clip's `ended` would abort the NEW answer's
        // in-flight synthesize request: the next answer is never spoken while its full text
        // sits in the chat. Reachable by speaking again mid-clip, and by FR 78's "Play answer"
        // replay, where the just-refused element is still attached. `createSpeaker` guards the
        // same spot (speechEngine.ts) and this has to match it.
        const ended = (): void => {
          if (isStale()) {
            return
          }
          settle((active) => active.onFinished())
        }
        const element = deps.createAudio(dataUrl, { onEnded: ended, onError: ended })
        if (!element) {
          ended()
          return
        }
        audio = element
        // A seam whose createAudio reports synchronously has already settled us by here, and
        // the assignment above would then leave a released element held. Hand it straight back.
        if (!pending) {
          release()
          return
        }
        clearTimer()
        timer = setTimeout(ended, playbackTimeoutMs(text))
        // `Promise.resolve` rather than `.catch()` straight off `play()`: the seam admits an
        // implementation that returns nothing at all, and `Promise.resolve` normalises that
        // to a promise so the rejection path below is reached the same way in both cases.
        void Promise.resolve(element.play()).catch((thrown: unknown) => {
          if (isStale()) {
            return
          }
          const refused = isAutoplayRefusal(thrown)
          settle((active) => {
            if (refused) {
              active.onRefused()
              return
            }
            active.onFinished()
          })
        })
      }

      const request = async (): Promise<void> => {
        const response = await deps.fetchImpl(deps.url, {
          body: JSON.stringify(buildSynthesizeBody(text, deps.voiceName, language, deps.modelName, deps.stylePrompt)),
          credentials: 'omit',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...deps.authHeader() },
          method: 'POST',
          signal: abort.signal,
        })
        if (!response.ok) {
          throw new Error(`text:synthesize responded ${response.status}`)
        }
        const body = await response.json() as { audioContent?: unknown }
        const encoded = typeof body.audioContent === 'string' ? body.audioContent : ''
        if (!encoded) {
          throw new Error('text:synthesize returned no audioContent')
        }
        if (isStale()) {
          return
        }
        play(`data:${AUDIO_MEDIA_TYPE};base64,${encoded}`)
      }

      void request().catch(() => {
        // A FAILURE IS REPORTED AS A FAILURE. This used to call onFinished(), on the premise
        // that speak-back is "a courtesy laid over an answer already written in the chat" —
        // so an HTTP status, a dead network or an expired bearer simply ended the answer
        // silently. That premise is wrong: speak-back is mandatory, and a caller that cannot
        // distinguish a failed synthesize from a spoken one cannot fall back to the local
        // voice. Silence is the one outcome this feature may not have.
        //
        // The store decides what to do with it; this only reports honestly. What must NOT
        // happen either way is `speaking` staying true, which the settle still guarantees.
        if (isStale()) {
          return
        }
        settle((active) => (active.onFailed ?? active.onFinished)())
      })
      return true
    },
  }
}
