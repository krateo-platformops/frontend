/**
 * CAPABILITY GATE — the pure predicate that decides whether the microphone control
 * exists at all. Voice spec FR 1–6.
 *
 * THE ORDER OF THE TESTS IS THE WHOLE POINT, and it is `isSecureContext` FIRST.
 *
 * `getUserMedia` and `MediaRecorder` being present is a PROVEN FALSE POSITIVE for "this
 * browser can record": on a plain-HTTP origin some browsers still expose the constructors
 * and only fail at call time, and the great majority of Krateo installs are still plain
 * HTTP (the portal is HTTPS now, but every deployment that has not enabled TLS is not).
 * Testing the APIs first would render a microphone button that can only ever produce a
 * permission error. So the context is tested before anything else touches `navigator`.
 *
 * THE URL IS THE ON/OFF SWITCH (FR 4). There is no `AUTOPILOT_VOICE_ENGINE` and no
 * boolean: the transcription endpoint is configuration, ABSENT BY DEFAULT, and with it
 * unset the control does not render and the composer's DOM is byte-identical to what it
 * was before this feature existed. The dedicated `/stt/v1` route this feature wants is
 * still with the platform team, so nothing is hard-coded — not `/llm/v1`, not the gateway
 * origin, not a path. Whatever the operator configures is where the audio goes.
 *
 * UNAVAILABLE IS HIDDEN, NOT GREYED. A permanently disabled microphone on every
 * plain-HTTP portal would be a permanent indicator for the DEFAULT state, which the
 * house rule forbids (status markers are exception-only). One `console.info` on first
 * rail open names the reason and the origin so an operator can act on it; the UI says
 * nothing at all.
 *
 * Pure and window-injectable: jsdom has neither `MediaRecorder` nor `getUserMedia`, so
 * every branch here is unit-testable by handing in a fake global.
 */

/** Why dictation is not available. Each maps to one operator-actionable console line. */
export type VoiceUnavailableReason = 'insecure-context' | 'no-recorder' | 'not-configured'

/** Available carries the chosen container, so the recorder never re-picks it. */
export type VoiceCapability
  = { available: false; reason: VoiceUnavailableReason }
  | { available: true; mimeType: string }

/**
 * Container preference (FR 27), most-compressed first. Opus at the requested 32 kbit/s is
 * ~240 KB for a full 60 s recording — comfortably inside the gateway's 2 MiB request
 * buffer. WAV/PCM is NOT in this list and has no fallback (FR 56): 60 s of 16 kHz mono
 * PCM is ~2.6 MB of base64 and would 413 at the gateway, so a browser that supports
 * nothing here is `no-recorder` rather than quietly uncompressed.
 */
export const VOICE_MIME_PREFERENCE: readonly string[] = Object.freeze([
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
])

/**
 * The media type written into the data URL for a recorded container (FR 50).
 *
 * MANDATORY, PARAMETER-FREE, and never taken from `blob.type`. The gateway parses the
 * data URL's media type and passes it verbatim to Vertex as `inlineData.mimeType`; a
 * `;codecs=opus` parameter is stripped there but the filename extension fallback maps
 * `webm` to **video**`/webm`, so relying on the filename loses the audio. Safari's
 * `audio/mp4` is relabelled `audio/m4a`, which is the spelling Gemini accepts.
 */
export const normalizeAudioMediaType = (mimeType: string): string => {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  if (base === 'audio/mp4') {
    return 'audio/m4a'
  }
  return base
}

/** The filename extension that goes with a normalised media type (cosmetic; FR 50). */
export const audioFileExtension = (mediaType: string): string => {
  if (mediaType === 'audio/m4a') {
    return 'm4a'
  }
  return mediaType === 'audio/ogg' ? 'ogg' : 'webm'
}

/** The minimal shape of the global this module reads — so a test can supply all of it. */
export interface VoiceCapabilityGlobal {
  MediaRecorder?: { isTypeSupported?: (type: string) => boolean }
  isSecureContext?: boolean
  location?: { origin?: string }
  navigator?: { mediaDevices?: { getUserMedia?: unknown } }
}

/**
 * FR 3: a non-empty ABSOLUTE http(s) URL. A relative path is rejected deliberately — the
 * call is cross-origin to the gateway by design (there is no nginx `location /voice/`),
 * so a relative value is always a misconfiguration, and silently POSTing microphone audio
 * at the portal's own origin is the wrong way to find that out.
 */
export const isTranscribeUrl = (url: string | undefined): boolean => {
  if (!url || !url.trim()) {
    return false
  }
  try {
    const { protocol } = new URL(url.trim())
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** The first container this browser can actually record, or null (FR 27/56). */
export const pickRecordingMimeType = (scope: VoiceCapabilityGlobal): string | null => {
  const isTypeSupported = scope.MediaRecorder?.isTypeSupported
  if (typeof isTypeSupported !== 'function') {
    return null
  }
  return VOICE_MIME_PREFERENCE.find((type) => {
    try {
      return isTypeSupported.call(scope.MediaRecorder, type) === true
    } catch {
      return false
    }
  }) ?? null
}

/**
 * The gate. Order is normative (FR 1–3): secure context, then configuration, then the
 * recording APIs. `transcribeUrl` is `config.api.AUTOPILOT_VOICE_TRANSCRIBE_URL`.
 */
export const detectVoiceCapability = (
  transcribeUrl: string | undefined,
  scope: VoiceCapabilityGlobal = globalThis,
): VoiceCapability => {
  // FIRST, ALWAYS. API presence on an insecure origin is a measured false positive.
  if (scope.isSecureContext !== true) {
    return { available: false, reason: 'insecure-context' }
  }
  if (!isTranscribeUrl(transcribeUrl)) {
    return { available: false, reason: 'not-configured' }
  }
  if (typeof scope.navigator?.mediaDevices?.getUserMedia !== 'function') {
    return { available: false, reason: 'no-recorder' }
  }
  const mimeType = pickRecordingMimeType(scope)
  return mimeType ? { available: true, mimeType } : { available: false, reason: 'no-recorder' }
}

/**
 * FR 5: the single console line, naming the reason AND the origin — an operator reading
 * "insecure context" without the origin cannot tell which deployment said it.
 */
export const voiceUnavailableMessage = (
  reason: VoiceUnavailableReason,
  origin: string,
): string => {
  const why: Record<VoiceUnavailableReason, string> = {
    'insecure-context': `insecure context (${origin}) — serve the portal over HTTPS to enable dictation`,
    'no-recorder': 'this browser cannot record a compressed audio container (MediaRecorder / getUserMedia)',
    'not-configured': 'no transcription endpoint configured — set AUTOPILOT_VOICE_TRANSCRIBE_URL to enable dictation',
  }
  return `[agentiko] voice input unavailable: ${why[reason]}`
}
