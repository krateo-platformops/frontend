/**
 * SPEECH ENGINE — the browser's `speechSynthesis`, behind an injectable seam.
 * Voice spec §3.2, FR 69 / 74 / 78 / 79.
 *
 * WHY THE BROWSER AND NOT A MODEL (§3.2). Speech synthesis needs no microphone and NO
 * SECURE CONTEXT — measured on the deployed plain-HTTP portal, where `isSecureContext` is
 * false, `navigator.mediaDevices` is absent entirely, and `speechSynthesis` still works
 * with 210 voices. So the output half of voice ships on every existing Krateo deployment
 * while the input half waits for platform TLS. It is also free, instant, and — with a
 * local voice — sends the answer text nowhere at all.
 *
 * WHY `localService === true` IS A HARD PIN (FR 69). Of the 210 voices on the probed
 * machine, 19 report `localService: false`: they synthesise on the VOICE VENDOR'S servers,
 * which means the full text of an Autopilot answer — cluster names, namespaces, whatever
 * the agent read — leaves the browser. In the voice list they look identical to the local
 * ones. There is no visible difference and no prompt. So a remote voice is NEVER selected,
 * and "no local voice for this machine" means speak-back is UNAVAILABLE rather than a
 * silent fallback to a vendor. The privacy argument that ruled browser speech OUT for
 * dictation (Chrome uploads microphone audio) is the argument that rules it IN here.
 *
 * The pin's cost — the local voices sound worst, and a machine without one is silent — is
 * paid off by `../speakTts.ts`, NOT by relaxing the pin: an install that configures
 * `AUTOPILOT_VOICE_TTS_URL` replaces this whole speaker with Cloud TTS behind the portal's
 * own gateway, and one that does not keeps exactly the behaviour described above.
 *
 * WHY IT IS INJECTABLE. jsdom has no `speechSynthesis` at all, so a real unit test has
 * nothing to drive. `SpeechDeps` is the whole surface this module needs — a synthesis
 * object and an utterance factory — and `browserSpeechDeps()` is the one place the real
 * globals are read. Tests hand in a fake and assert on what was spoken, in what order,
 * and what happened when the browser refused.
 *
 * FR 65 (structural): nothing under `voice/speak/` may import the A2A transport or the
 * provider's `send`. A model call on the speak-back path must not compile — that is what
 * makes FR 68's fidelity invariant structural rather than a promise. Enforced by the
 * `no-restricted-imports` block in eslint.config.js.
 */

import { chunkForUtterances } from './speakable'

/** Why speak-back is not available. `disabled` is the operator kill-switch (FR 46). */
export type SpeakBackUnavailableReason = 'disabled' | 'no-local-voice' | 'no-synthesis'

/** The subset of `SpeechSynthesisVoice` this module reads. */
export interface SpeechVoiceLike {
  default?: boolean
  lang: string
  /** FR 69: the whole point. `false` means the text goes to the voice vendor's servers. */
  localService: boolean
  name: string
}

/** The subset of `SpeechSynthesisUtterance` this module writes and listens to. */
export interface SpeechUtteranceLike {
  lang?: string
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
  text: string
  voice?: SpeechVoiceLike | null
}

/** The subset of `SpeechSynthesis` this module drives. */
export interface SpeechSynthesisLike {
  addEventListener?: (type: string, listener: () => void) => void
  cancel: () => void
  getVoices: () => SpeechVoiceLike[]
  removeEventListener?: (type: string, listener: () => void) => void
  speak: (utterance: SpeechUtteranceLike) => void
}

/** Everything the speaker needs from the platform. The only seam; tests replace it whole. */
export interface SpeechDeps {
  createUtterance: (text: string) => SpeechUtteranceLike
  synthesis: SpeechSynthesisLike
}

/**
 * Read the real browser globals, or null when this browser cannot speak at all. Called
 * once by the store; never called from a test (which injects `SpeechDeps` directly).
 *
 * Deliberately NOT gated on `isSecureContext` (FR 79): synthesis is not on the
 * secure-context list, and the deployed plain-HTTP portal proves it works there.
 */
export const browserSpeechDeps = (): SpeechDeps | null => {
  const scope = globalThis as unknown as {
    SpeechSynthesisUtterance?: new (text: string) => SpeechUtteranceLike
    speechSynthesis?: SpeechSynthesisLike
  }
  const synthesis = scope.speechSynthesis
  const Utterance = scope.SpeechSynthesisUtterance
  if (!synthesis || typeof synthesis.speak !== 'function' || typeof Utterance !== 'function') {
    return null
  }
  return { createUtterance: (text) => new Utterance(text), synthesis }
}

const family = (language: string): string => language.toLowerCase().replace('_', '-').split('-')[0]

/**
 * FR 69: an exact `navigator.language` match, then the same language family, then any
 * local voice — and NEVER a remote one. Returns null when the machine has no local voice,
 * which the caller must treat as "unavailable", not as "use whatever is there".
 */
export const pickLocalVoice = (voices: SpeechVoiceLike[], language: string): SpeechVoiceLike | null => {
  const local = voices.filter((voice) => voice.localService === true)
  if (!local.length) {
    return null
  }
  const wanted = language.toLowerCase().replace('_', '-')
  const exact = local.find((voice) => voice.lang.toLowerCase().replace('_', '-') === wanted)
  if (exact) {
    return exact
  }
  const sameFamily = local.find((voice) => family(voice.lang) === family(wanted))
  if (sameFamily) {
    return sameFamily
  }
  return local.find((voice) => voice.default === true) ?? local[0]
}

/** What the caller learns about a queue that has finished, failed, or been refused. */
export interface SpeakerHandlers {
  /** Every utterance finished, or the queue was cancelled — speaking is over either way. */
  onFinished: () => void
  /**
   * The browser REFUSED to speak for lack of user activation (FR 78). `speak()` does not
   * throw for this — it fires the utterance's `error` event with `error === 'not-allowed'`,
   * promptly and detectably — so it is a distinct, recoverable outcome, not a failure.
   */
  onRefused: () => void
  /**
   * The attempt FAILED — a synthesize status, a dead network, an expired bearer, a clip the
   * decoder refused. Distinct from `onFinished` because speak-back is MANDATORY, not a
   * courtesy: a caller that cannot tell a failure from a completed answer cannot fall back,
   * and silence is the one outcome this feature may not have. Optional so an existing caller
   * keeps compiling; the store treats its absence as `onFinished`.
   */
  onFailed?: () => void
}

/**
 * THE SEAM SPEAK-BACK IS SWAPPED AT. `createSpeaker` below is one implementation; the Cloud
 * TTS client in `../speakTts.ts` is the other, injected through
 * `speakBackStore.installSpeaker()`. Both are handed the exact same
 * `speakableForMessage()` string, which is what keeps FR 68 true across the swap.
 */
export interface Speaker {
  /** Stop immediately and drop the rest of the queue. Safe to call when idle. */
  cancel: () => void
  /** Speak `text` in `language`. Returns false when nothing will be spoken and NO handler
   *  will fire — for this implementation, when no local voice could be chosen. */
  speak: (text: string, language: string, handlers: SpeakerHandlers) => boolean
}

/** Watchdog budget for one utterance: a queue that reports neither `end` nor `error` is
 *  cancelled and reset rather than left stuck holding `speaking` true forever (FR 74). */
const utteranceTimeoutMs = (text: string): number => 4000 + text.length * 200

/**
 * A sequential utterance queue over `SpeechDeps`. Sequential (chunk N+1 starts on chunk
 * N's `end`) rather than queued-all-at-once so that `cancel()` has exactly one meaning
 * and a stalled chunk is detectable — the Chromium long-utterance stall is the reason the
 * text is chunked at all.
 *
 * At most ONE queue exists at a time (FR 45): a new `speak()` cancels the previous one
 * first, or a stale queue would speak a previous turn's answer over the current one.
 */
export const createSpeaker = (deps: SpeechDeps): Speaker => {
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const cancel = (): void => {
    generation += 1
    clearTimer()
    try {
      deps.synthesis.cancel()
    } catch {
      // A synthesiser that throws on cancel must not wedge the rail; the queue is
      // abandoned by the generation bump either way.
    }
  }

  return {
    cancel,
    speak: (text, language, handlers) => {
      cancel()
      const chunks = chunkForUtterances(text)
      const voice = pickLocalVoice(deps.synthesis.getVoices(), language)
      if (!voice || !chunks.length) {
        return false
      }
      const mine = generation
      const isStale = (): boolean => mine !== generation

      const sayFrom = (index: number): void => {
        if (isStale()) {
          return
        }
        if (index >= chunks.length) {
          clearTimer()
          handlers.onFinished()
          return
        }
        const utterance = deps.createUtterance(chunks[index])
        utterance.voice = voice
        utterance.lang = voice.lang
        const settle = (next: () => void): void => {
          if (isStale()) {
            return
          }
          clearTimer()
          next()
        }
        utterance.onend = () => settle(() => sayFrom(index + 1))
        utterance.onerror = (event) => settle(() => {
          if (event?.error === 'not-allowed') {
            cancel()
            handlers.onRefused()
            return
          }
          // Any other error ends the queue quietly: half an answer already said cannot be
          // un-said, and re-speaking from the top would repeat it.
          cancel()
          handlers.onFinished()
        })
        clearTimer()
        timer = setTimeout(() => {
          if (isStale()) {
            return
          }
          cancel()
          handlers.onFinished()
        }, utteranceTimeoutMs(chunks[index]))
        deps.synthesis.speak(utterance)
      }

      sayFrom(0)
      return true
    },
  }
}
