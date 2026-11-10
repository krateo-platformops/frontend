/**
 * CAPABILITY GATE — the pure predicate that decides whether the microphone control can
 * record, and when it cannot, WHY. Voice spec FR 1–6.
 *
 * THE ORDER OF THE TESTS IS THE WHOLE POINT. It is also the order the control explains
 * itself in when several things are wrong at once (decided 2026-11-10): not configured,
 * then insecure, then unsupported — and only after all three does a denied microphone
 * permission get a say (that one is the control's, in `VoiceControl.tsx`).
 *
 * Configuration comes first because it decides whether the feature exists on this
 * platform at all: TLS on a portal with no transcription endpoint still leaves dictation
 * off, so "needs HTTPS" would send someone to fix the wrong thing first. It reads nothing
 * from the browser, so putting it first costs the rule below nothing.
 *
 * `isSecureContext` is tested BEFORE ANYTHING TOUCHES `navigator`. `getUserMedia` and
 * `MediaRecorder` being present is a PROVEN FALSE POSITIVE for "this browser can record":
 * on a plain-HTTP origin some browsers still expose the constructors and only fail at call
 * time. Testing the APIs first would call a browser able to record when the only thing it
 * can ever produce is a permission error.
 *
 * THE URL IS THE ON/OFF SWITCH (FR 4). There is no `AUTOPILOT_VOICE_ENGINE` and no
 * boolean: the transcription endpoint is configuration, ABSENT BY DEFAULT. The dedicated
 * `/stt/v1` route this feature wants is still with the platform team, so nothing is
 * hard-coded — not `/llm/v1`, not the gateway origin, not a path. Whatever the operator
 * configures is where the audio goes.
 *
 * UNAVAILABLE IS SHOWN, DISABLED, AND SAYS WHY (decided 2026-11-10, superseding the
 * original "hidden, not greyed"). The control is always rendered; where it cannot work it
 * gets exactly the blocked microphone's treatment — focusable, `aria-disabled`, the reason
 * in its label and in a keyboard-reachable tooltip — with the copy in
 * `VOICE_UNAVAILABLE_COPY` below. A missing control explains nothing to the person looking
 * for it. The one `console.info` on first rail open (FR 5) still names the reason AND the
 * origin for the operator, who is the one who can act on most of these.
 *
 * Pure and window-injectable: jsdom has neither `MediaRecorder` nor `getUserMedia`, so
 * every branch here is unit-testable by handing in a fake global.
 */

/**
 * Why dictation is not available. Each maps to one operator-actionable console line and
 * to one user-facing label + hint.
 */
export type VoiceUnavailableReason = 'insecure-context' | 'no-recorder' | 'not-configured'

/**
 * What the disabled control says for each reason. `label` is its accessible name and says
 * WHY, because that is the one string every assistive technology reads; `hint` is the
 * tooltip and the `aria-describedby` text.
 */
export const VOICE_UNAVAILABLE_COPY: Readonly<Record<VoiceUnavailableReason, { hint: string; label: string }>> = Object.freeze({
  'insecure-context': {
    hint: 'Dictation needs a secure (HTTPS) connection.',
    label: 'Dictate — needs HTTPS',
  },
  'no-recorder': {
    hint: 'This browser can\'t record audio. Try a current version of Chrome, Edge, Firefox or Safari.',
    label: 'Dictate — not supported here',
  },
  'not-configured': {
    hint: 'Dictation isn\'t set up on this platform. Ask an administrator to configure it.',
    label: 'Dictate — not set up',
  },
})

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
 * The gate. Order is normative — configuration, then secure context, then the recording
 * APIs; the header says why each sits where it does. `transcribeUrl` is
 * `agentikoConfig(config.api, 'VOICE_TRANSCRIBE_URL')`.
 */
export const detectVoiceCapability = (
  transcribeUrl: string | undefined,
  scope: VoiceCapabilityGlobal = globalThis,
): VoiceCapability => {
  // First: whether the feature exists on this platform at all. Reads nothing from the browser.
  if (!isTranscribeUrl(transcribeUrl)) {
    return { available: false, reason: 'not-configured' }
  }
  // Before ANY API probe: API presence on an insecure origin is a measured false positive.
  if (scope.isSecureContext !== true) {
    return { available: false, reason: 'insecure-context' }
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
