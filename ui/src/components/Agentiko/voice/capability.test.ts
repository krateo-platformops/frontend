/**
 * The gate, and specifically THE ORDER OF ITS TESTS.
 *
 * The first two cases are the ones that matter: a browser with `getUserMedia` and
 * `MediaRecorder` sitting on a plain-HTTP origin must come back UNAVAILABLE with reason
 * `insecure-context`, because API presence there is a proven false positive and rendering
 * a microphone would produce a control that can only ever fail. And an unconfigured
 * transcription URL must come back unavailable too, because the endpoint is the on/off
 * switch and there is no default to fall back on.
 */
import { describe, expect, it } from 'vitest'

import {
  audioFileExtension,
  detectVoiceCapability,
  isTranscribeUrl,
  normalizeAudioMediaType,
  pickRecordingMimeType,
  type VoiceCapabilityGlobal,
  voiceUnavailableMessage,
} from './capability'

const URL_OK = 'https://gateway.krateo.dev/stt/v1/chat/completions'

const scope = (overrides: Partial<VoiceCapabilityGlobal> = {}): VoiceCapabilityGlobal => ({
  MediaRecorder: { isTypeSupported: () => true },
  isSecureContext: true,
  location: { origin: 'https://portal.krateo.dev' },
  navigator: { mediaDevices: { getUserMedia: () => undefined } },
  ...overrides,
})

describe('detectVoiceCapability — the secure context is tested FIRST', () => {
  it('is available when the context is secure, the URL is configured and the APIs exist', () => {
    expect(detectVoiceCapability(URL_OK, scope())).toEqual({ available: true, mimeType: 'audio/webm;codecs=opus' })
  })

  it('REFUSES on an insecure origin even with getUserMedia AND MediaRecorder both present (FR 2)', () => {
    const insecure = scope({ isSecureContext: false })
    // Both APIs are present in this fake, exactly as they are on the browsers where this
    // false positive was measured. Presence must not be allowed to outvote the context.
    expect(insecure.navigator?.mediaDevices?.getUserMedia).toBeTypeOf('function')
    expect(insecure.MediaRecorder?.isTypeSupported).toBeTypeOf('function')
    expect(detectVoiceCapability(URL_OK, insecure)).toEqual({ available: false, reason: 'insecure-context' })
  })

  it('reports insecure-context BEFORE not-configured, so the operator fixes the real blocker first', () => {
    expect(detectVoiceCapability(undefined, scope({ isSecureContext: false })))
      .toEqual({ available: false, reason: 'insecure-context' })
  })

  it('is unavailable with no transcription URL — presence of the key is the only switch (FR 4)', () => {
    expect(detectVoiceCapability(undefined, scope())).toEqual({ available: false, reason: 'not-configured' })
    expect(detectVoiceCapability('', scope())).toEqual({ available: false, reason: 'not-configured' })
    expect(detectVoiceCapability('   ', scope())).toEqual({ available: false, reason: 'not-configured' })
  })

  it('rejects a relative URL: the call is cross-origin to the gateway by design', () => {
    expect(isTranscribeUrl('/voice/v1/audio/transcriptions')).toBe(false)
    expect(detectVoiceCapability('/stt/v1', scope())).toEqual({ available: false, reason: 'not-configured' })
  })

  it('accepts http and https absolute URLs and nothing else', () => {
    expect(isTranscribeUrl('http://34.141.24.198:8080/llm/v1/chat/completions')).toBe(true)
    expect(isTranscribeUrl(URL_OK)).toBe(true)
    expect(isTranscribeUrl('ws://gateway/stt')).toBe(false)
    expect(isTranscribeUrl('not a url')).toBe(false)
  })

  it('is no-recorder without getUserMedia', () => {
    expect(detectVoiceCapability(URL_OK, scope({ navigator: {} })))
      .toEqual({ available: false, reason: 'no-recorder' })
  })

  it('is no-recorder when NO compressed container is supported — there is no WAV fallback (FR 56)', () => {
    expect(detectVoiceCapability(URL_OK, scope({ MediaRecorder: { isTypeSupported: () => false } })))
      .toEqual({ available: false, reason: 'no-recorder' })
  })

  it('falls down the container preference list in order', () => {
    const only = (wanted: string) => scope({ MediaRecorder: { isTypeSupported: (type) => type === wanted } })
    expect(pickRecordingMimeType(only('audio/ogg;codecs=opus'))).toBe('audio/ogg;codecs=opus')
    expect(pickRecordingMimeType(only('audio/mp4'))).toBe('audio/mp4')
    expect(pickRecordingMimeType(only('audio/wav'))).toBeNull()
  })

  it('survives an isTypeSupported that throws', () => {
    const throwing = scope({ MediaRecorder: { isTypeSupported: () => { throw new Error('nope') } } })
    expect(detectVoiceCapability(URL_OK, throwing)).toEqual({ available: false, reason: 'no-recorder' })
  })
})

describe('media types are normalised, never taken from the blob (FR 50)', () => {
  it('strips codec parameters — the gateway passes the media type verbatim to Vertex', () => {
    expect(normalizeAudioMediaType('audio/webm;codecs=opus')).toBe('audio/webm')
    expect(normalizeAudioMediaType('audio/ogg;codecs=opus')).toBe('audio/ogg')
  })

  it('relabels Safari audio/mp4 as audio/m4a', () => {
    expect(normalizeAudioMediaType('audio/mp4')).toBe('audio/m4a')
    expect(audioFileExtension('audio/m4a')).toBe('m4a')
  })

  it('never yields a video/* type — the filename extension fallback maps webm to video/webm', () => {
    for (const type of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']) {
      expect(normalizeAudioMediaType(type).startsWith('audio/')).toBe(true)
    }
  })
})

describe('the one console line (FR 5)', () => {
  it('names the reason AND the origin, so an operator knows which deployment said it', () => {
    const line = voiceUnavailableMessage('insecure-context', 'http://34.141.24.198')
    expect(line).toContain('[agentiko] voice input unavailable')
    expect(line).toContain('http://34.141.24.198')
    expect(line).toContain('HTTPS')
  })

  it('tells an operator with HTTPS but no URL what key to set', () => {
    expect(voiceUnavailableMessage('not-configured', 'https://portal.krateo.dev'))
      .toContain('AUTOPILOT_VOICE_TRANSCRIBE_URL')
  })
})
