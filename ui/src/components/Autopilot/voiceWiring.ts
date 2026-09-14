/**
 * DICTATION WIRING — the one hook that connects the voice store to everything it is
 * deliberately not allowed to import itself.
 *
 * WHY THIS FILE EXISTS AT ALL, one directory OUTSIDE `voice/`. An ESLint rule fences
 * everything under `voice/` from `transport.ts` and `AutopilotProvider`, so that the voice
 * code CANNOT reach the transport itself — the invariant is structural rather than a
 * promise, and it is not relaxed for the sake of a few convenient imports. But the work
 * still needs things from this side: the portal bearer, the ONE rate-limit detector (FR 55
 * — not a second copy of it), the in-place session resume, and now the SEND that turns a
 * finished transcript into a chat turn. All of them arrive here, on the permitted side of
 * the fence, and are handed to the store. The dependency arrow points INTO `voice/`, never
 * out, so the microphone completes a turn without ever holding the means to send one.
 *
 * It also keeps `AutopilotRail.tsx` inside its 500-line ESLint budget, which is a real
 * constraint rather than a stylistic one.
 *
 * WHAT IT WIRES
 *   · capability + language, re-evaluated when config loads and on window focus (FR 6);
 *   · the transcription dependencies, rebuilt when the URL or model changes;
 *   · the SPEAK-BACK speaker: Cloud TTS when the install configured an endpoint, and the
 *     browser's on-device synthesiser when it did not (see `voice/speakTts.ts` for why the
 *     client cannot live under `voice/speak/` and therefore has to be handed in from here);
 *   · the conversation sink — the rail's submit, so a purely-spoken draft sends itself;
 *   · the microphone permission watcher, including a revocation that lands MID-RECORDING;
 *   · the vocabulary bias, from the same live page context the turn already carries,
 *     redacted through the same chokepoint (FR 54);
 *   · one console line, on first rail open, naming why dictation is unavailable (FR 5).
 */

import { useEffect, useRef } from 'react'

import { useConfigContext } from '../../context/ConfigContext'
import { raiseSessionExpired } from '../../utils/sessionResume'

import { redactValue } from './redact'
import { a2aAuthHeader, rateLimitNotice } from './transport'
import type { PageContextEnvelope } from './types'
import { watchMicrophonePermission } from './voice/permission'
import { autopilotSpeakBackStore } from './voice/speak/speakBackStore'
import { browserTtsAudio, createTtsSpeaker, DEFAULT_TTS_VOICE } from './voice/speakTts'
import { DEFAULT_VOICE_MODEL } from './voice/transcribe'
import { autopilotVoiceStore } from './voice/voiceStore'

/**
 * Stop BOTH halves of voice at once — the microphone and the synthesiser.
 *
 * Every moment that ends a conversation ends both: provider unmount, `newThread()`,
 * `switchToThread()` (voice spec FR 44). Calling them as one is not just brevity — it is
 * the guarantee that a future teardown path cannot remember one and forget the other,
 * which would leave either a live microphone or a voice reading an answer that is no
 * longer on screen.
 */
export const stopVoice = (): void => {
  autopilotSpeakBackStore.cancel()
  autopilotVoiceStore.cancel()
}

/**
 * ESCAPE'S VOICE LAYERS. Returns true when Escape was CONSUMED by voice and the rail must
 * stay open; false when nothing was speaking or listening and Escape means "collapse".
 *
 * Innermost first — stop the answer being read before cancelling a microphone that is not
 * even open — because in conversation mode Escape is the interrupt gesture, and the press
 * that shuts a voice up must not also close the rail the answer is written in.
 *
 * It lives here, beside `stopVoice`, rather than in the rail: this file is where the two
 * voice stores are already coordinated as one, and the rail is at its 500-line budget.
 */
export const escapeInterruptsVoice = (): boolean => {
  if (autopilotSpeakBackStore.getSnapshot().speaking) {
    autopilotSpeakBackStore.cancel()
    return true
  }
  const { phase } = autopilotVoiceStore.getSnapshot()
  if (phase === 'listening' || phase === 'transcribing') {
    autopilotVoiceStore.cancel()
    return true
  }
  return false
}

/** How many page names ride along as vocabulary bias before the block is capped. */
const MAX_CONTEXT_NAMES = 20

/**
 * FR 54: resource and namespace names from the live page, so the model spells
 * `payments-7f9c` the way it is actually written rather than as three English words.
 *
 * Every candidate goes through `redactValue()` FIRST — the same chokepoint the turn's
 * page-context envelope uses — and anything the scrub touched is dropped rather than sent
 * in redacted form: a value that looked like a credential has no business being spelled
 * out to a transcription model, in any shape. Names are also length-bounded, because a
 * long bias list inflates the TEXT side of the FR 61 token arithmetic, which is the side
 * that must stay small for the audio-arrival gate to keep its headroom.
 */
export const contextVocabulary = (context: PageContextEnvelope | null): string[] => {
  if (!context) {
    return []
  }
  const names: string[] = []
  for (const widget of context.widgets ?? []) {
    for (const candidate of [widget.name, widget.title]) {
      if (!candidate || candidate.length > 40) {
        continue
      }
      const scrubbed = redactValue(candidate)
      if (typeof scrubbed === 'string' && scrubbed === candidate) {
        names.push(candidate)
      }
    }
    if (names.length >= MAX_CONTEXT_NAMES) {
      break
    }
  }
  return names.slice(0, MAX_CONTEXT_NAMES)
}

/**
 * Wire dictation for the lifetime of the rail. `collect` is the rail's live page-context
 * snapshot (called only while the rail is open, as it already is for the "seeing …"
 * strip); `open` drives the console line and the collapse teardown; `submitSpokenTurn`
 * sends a completed spoken draft (conversation mode).
 */
export const useVoiceWiring = (
  open: boolean,
  context: PageContextEnvelope | null,
  submitSpokenTurn: (text: string) => void,
): void => {
  const { config } = useConfigContext()
  const transcribeUrl = config?.api.AUTOPILOT_VOICE_TRANSCRIBE_URL
  const model = config?.api.AUTOPILOT_VOICE_MODEL

  // FR 6: capability is re-evaluated when config loads AND on window focus, so a portal
  // that gains TLS (or an operator who fills the key in) does not need a page reload.
  useEffect(() => {
    autopilotVoiceStore.setCapabilityInput({ transcribeUrl })
    const onFocus = () => autopilotVoiceStore.setCapabilityInput({ transcribeUrl })
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [transcribeUrl])

  useEffect(() => {
    if (!transcribeUrl) {
      autopilotVoiceStore.installTranscribeDeps(null)
      return
    }
    autopilotVoiceStore.installTranscribeDeps({
      authHeader: a2aAuthHeader,
      fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
      model: model || DEFAULT_VOICE_MODEL,
      raiseSessionExpired,
      rateLimitNotice,
      url: transcribeUrl,
    })
  }, [transcribeUrl, model])

  // SPEAK-BACK'S VOICE. The URL is the on/off switch, exactly as it is for dictation: with
  // no endpoint configured the store keeps the browser synthesiser and its `localService`
  // pin, unchanged. With one, Cloud TTS replaces it — same `Speaker` contract, same
  // `speakableForMessage()` string, so nothing on the FR 68 fidelity path moves. The bearer
  // is `a2aAuthHeader` and NOTHING else: the gateway route holds the GCP credential, and a
  // page that never has one cannot leak one.
  const ttsUrl = config?.api.AUTOPILOT_VOICE_TTS_URL
  // Gemini-TTS. Absent leaves the Chirp request shape untouched, so this is inert until an
  // install opts in. The style prompt is the reason to: it is the only field that can ask for
  // Italian prose AND English pronunciation of the technical terms inside it.
  const ttsModel = config?.api.AUTOPILOT_VOICE_TTS_MODEL
  const stylePrompt = config?.api.AUTOPILOT_VOICE_STYLE_PROMPT
  const voiceName = config?.api.AUTOPILOT_VOICE_NAME
  useEffect(() => {
    if (!ttsUrl) {
      autopilotSpeakBackStore.installSpeaker(null)
      return
    }
    autopilotSpeakBackStore.installSpeaker(createTtsSpeaker({
      authHeader: a2aAuthHeader,
      createAudio: browserTtsAudio,
      fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
      url: ttsUrl,
      voiceName: voiceName || DEFAULT_TTS_VOICE,
      modelName: ttsModel,
      stylePrompt: stylePrompt,
    }))
  }, [ttsUrl, voiceName, ttsModel, stylePrompt])

  // CONVERSATION MODE: the rail's submit reaches the store through a ref, NOT as an effect
  // dependency. `submitSpokenTurn` closes over live rail state and so is a new function on
  // every render; installing it directly would re-wire the store on every keystroke, and a
  // missed re-wire would leave a stale closure holding a cleared draft. The ref is written
  // on each render and the store is handed ONE stable adapter, for the rail's lifetime.
  const submitRef = useRef(submitSpokenTurn)
  submitRef.current = submitSpokenTurn
  useEffect(() => {
    autopilotVoiceStore.installConversationSink((text) => submitRef.current(text))
    return () => autopilotVoiceStore.installConversationSink(null)
  }, [])

  // FR 19: the watcher, not a check at press time — a permission granted or revoked in the
  // address bar must move the control live, including mid-recording.
  useEffect(() => watchMicrophonePermission((permission) => autopilotVoiceStore.setPermission(permission)), [])

  // Keyed on the NAMES, not the envelope: `collect()` returns a fresh object every render,
  // so depending on it would re-run this on every keystroke for no change.
  const names = contextVocabulary(context)
  const namesKey = names.join('\u0000')
  useEffect(() => {
    autopilotVoiceStore.setContextNames(namesKey ? namesKey.split('\u0000') : [])
  }, [namesKey])

  // FR 5/44: say once why nothing will be dictated; stop capture when the rail collapses —
  // a microphone still open behind a closed rail has no visible way to be stopped.
  useEffect(() => {
    if (open) {
      autopilotVoiceStore.logUnavailableOnce(window.location.origin)
    } else {
      autopilotVoiceStore.cancel()
    }
  }, [open])
}
