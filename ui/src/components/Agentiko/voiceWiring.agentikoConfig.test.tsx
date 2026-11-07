// @vitest-environment jsdom
/**
 * Six of the seven voice keys, through the hook that reads them: AGENTIKO_ first, AUTOPILOT_ as the fallback.
 *
 * agentikoConfig.test.ts pins the resolver on its own; this pins that the voice wiring goes through
 * it, under the four cases each key has — new name only, old name only, both (new wins), neither (the
 * existing default). Names are written out in full. VOICE_SPEAK_BACK is read by AgentikoRail, not
 * this hook, and is pinned at the resolver only.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = vi.hoisted((): { api: Record<string, string> } => ({ api: {} }))

vi.mock('../../context/ConfigContext', () => ({ useConfigContext: () => ({ config: { api: mockConfig.api } }) }))

import { agentikoSpeakBackStore } from './voice/speak/speakBackStore'
import { DEFAULT_TTS_VOICE } from './voice/speakTts'
import { DEFAULT_VOICE_MODEL } from './voice/transcribe'
import { agentikoVoiceStore } from './voice/voiceStore'
import { useVoiceWiring } from './voiceWiring'

const wire = () => renderHook(() => useVoiceWiring(true, null, () => undefined))

type TranscribeDeps = Parameters<typeof agentikoVoiceStore.installTranscribeDeps>[0]

/** The transcribe deps the hook installed last (null when it installed none). */
const transcribeDeps = (): TranscribeDeps => {
  const install = vi.spyOn(agentikoVoiceStore, 'installTranscribeDeps')
  wire()
  return install.mock.calls[install.mock.calls.length - 1]?.[0] ?? null
}

/** The JSON body the installed TTS speaker POSTs for one sentence, or null when no speaker was installed. */
const ttsRequest = (): { url: unknown; body: Record<string, unknown> } | null => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(() => undefined))
  const install = vi.spyOn(agentikoSpeakBackStore, 'installSpeaker')
  wire()
  const speaker = install.mock.calls[install.mock.calls.length - 1]?.[0] ?? null
  if (!speaker) { return null }
  speaker.speak('Two replicas are Ready.', 'en-US', { onFinished: vi.fn(), onRefused: vi.fn() })
  const [[url, init]] = fetchSpy.mock.calls
  return { body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>, url }
}

beforeEach(() => {
  localStorage.clear()
  mockConfig.api = {}
})

afterEach(() => {
  vi.restoreAllMocks()
  agentikoSpeakBackStore.installSpeaker(null)
  agentikoVoiceStore.installTranscribeDeps(null)
})

describe('VOICE_TRANSCRIBE_URL and VOICE_MODEL', () => {
  it('new names only', () => {
    mockConfig.api = { AGENTIKO_VOICE_MODEL: 'model-new', AGENTIKO_VOICE_TRANSCRIBE_URL: 'https://new/stt' }
    expect(transcribeDeps()).toMatchObject({ model: 'model-new', url: 'https://new/stt' })
  })

  it('old names only', () => {
    mockConfig.api = { AUTOPILOT_VOICE_MODEL: 'model-old', AUTOPILOT_VOICE_TRANSCRIBE_URL: 'https://old/stt' }
    expect(transcribeDeps()).toMatchObject({ model: 'model-old', url: 'https://old/stt' })
  })

  it('both: the new names win', () => {
    mockConfig.api = {
      AGENTIKO_VOICE_MODEL: 'model-new',
      AGENTIKO_VOICE_TRANSCRIBE_URL: 'https://new/stt',
      AUTOPILOT_VOICE_MODEL: 'model-old',
      AUTOPILOT_VOICE_TRANSCRIBE_URL: 'https://old/stt',
    }
    expect(transcribeDeps()).toMatchObject({ model: 'model-new', url: 'https://new/stt' })
  })

  it('neither: no dictation, and the default model once a URL is set', () => {
    expect(transcribeDeps()).toBeNull()
    mockConfig.api = { AUTOPILOT_VOICE_TRANSCRIBE_URL: 'https://old/stt' }
    expect(transcribeDeps()).toMatchObject({ model: DEFAULT_VOICE_MODEL })
  })

  it('an empty new URL is a value: it turns dictation off even beside an old one', () => {
    mockConfig.api = { AGENTIKO_VOICE_TRANSCRIBE_URL: '', AUTOPILOT_VOICE_TRANSCRIBE_URL: 'https://old/stt' }
    expect(transcribeDeps()).toBeNull()
  })
})

describe('VOICE_TTS_URL, VOICE_NAME, VOICE_TTS_MODEL and VOICE_STYLE_PROMPT', () => {
  it('new names only', () => {
    mockConfig.api = {
      AGENTIKO_VOICE_NAME: 'it-IT-Chirp3-HD-New',
      AGENTIKO_VOICE_STYLE_PROMPT: 'prompt-new',
      AGENTIKO_VOICE_TTS_MODEL: 'tts-model-new',
      AGENTIKO_VOICE_TTS_URL: 'https://new/tts',
    }
    const sent = ttsRequest()
    expect(sent?.url).toBe('https://new/tts')
    expect(sent?.body).toMatchObject({ input: { prompt: 'prompt-new' }, voice: { model_name: 'tts-model-new', name: 'it-IT-Chirp3-HD-New' } })
  })

  it('old names only', () => {
    mockConfig.api = {
      AUTOPILOT_VOICE_NAME: 'it-IT-Chirp3-HD-Old',
      AUTOPILOT_VOICE_STYLE_PROMPT: 'prompt-old',
      AUTOPILOT_VOICE_TTS_MODEL: 'tts-model-old',
      AUTOPILOT_VOICE_TTS_URL: 'https://old/tts',
    }
    const sent = ttsRequest()
    expect(sent?.url).toBe('https://old/tts')
    expect(sent?.body).toMatchObject({ input: { prompt: 'prompt-old' }, voice: { model_name: 'tts-model-old', name: 'it-IT-Chirp3-HD-Old' } })
  })

  it('both: the new names win', () => {
    mockConfig.api = {
      AGENTIKO_VOICE_NAME: 'it-IT-Chirp3-HD-New',
      AGENTIKO_VOICE_STYLE_PROMPT: 'prompt-new',
      AGENTIKO_VOICE_TTS_MODEL: 'tts-model-new',
      AGENTIKO_VOICE_TTS_URL: 'https://new/tts',
      AUTOPILOT_VOICE_NAME: 'it-IT-Chirp3-HD-Old',
      AUTOPILOT_VOICE_STYLE_PROMPT: 'prompt-old',
      AUTOPILOT_VOICE_TTS_MODEL: 'tts-model-old',
      AUTOPILOT_VOICE_TTS_URL: 'https://old/tts',
    }
    const sent = ttsRequest()
    expect(sent?.url).toBe('https://new/tts')
    expect(sent?.body).toMatchObject({ input: { prompt: 'prompt-new' }, voice: { model_name: 'tts-model-new', name: 'it-IT-Chirp3-HD-New' } })
  })

  it('neither: no TTS speaker; with only a URL, the default voice and no model or prompt', () => {
    expect(ttsRequest()).toBeNull()
    vi.restoreAllMocks()
    mockConfig.api = { AUTOPILOT_VOICE_TTS_URL: 'https://old/tts' }
    const sent = ttsRequest()
    expect(sent?.body).toMatchObject({ voice: { name: DEFAULT_TTS_VOICE } })
    expect(sent?.body.voice).not.toHaveProperty('model_name')
    expect(sent?.body.input).not.toHaveProperty('prompt')
  })
})
