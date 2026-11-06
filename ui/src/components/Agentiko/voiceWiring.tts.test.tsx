// @vitest-environment jsdom
/**
 * THE ON/OFF SWITCH — which voice reads an answer is decided here, by the presence of
 * `AUTOPILOT_VOICE_TTS_URL`, exactly as `AUTOPILOT_VOICE_TRANSCRIBE_URL` decides whether
 * dictation exists at all.
 *
 * The first test is the one that protects every install that has not opted in: with the
 * key absent, NO TTS speaker is installed and speak-back is the browser's `speechSynthesis`
 * pinned to on-device voices, unchanged. The rest assert the other direction — the request
 * goes to the CONFIGURED URL carrying the portal bearer and nothing else, because the GCP
 * credential lives in the gateway and a page that never holds one cannot leak one.
 *
 * The hook is rendered on its own rather than through the rail: this is about the wiring,
 * and the rail's own speak-back chrome is covered in speakBack.test.tsx.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockConfig = vi.hoisted((): { api: Record<string, string> } => ({ api: {} }))

vi.mock('../../context/ConfigContext', () => ({ useConfigContext: () => ({ config: { api: mockConfig.api } }) }))

import { agentikoSpeakBackStore } from './voice/speak/speakBackStore'
import type { Speaker } from './voice/speak/speechEngine'
import { DEFAULT_TTS_VOICE } from './voice/speakTts'
import { useVoiceWiring } from './voiceWiring'

const TTS_URL = 'https://portal.krateo.test/tts/v1/text:synthesize'

const wire = () => renderHook(() => useVoiceWiring(true, null, () => undefined))

/** The JSON a recorded `fetch` call carried, as text. */
const bodyText = (init: RequestInit | undefined): string => (typeof init?.body === 'string' ? init.body : '{}')

/** The speaker the hook installed on its last pass, or null when it installed none. */
const installed = (spy: { mock: { calls: [Speaker | null][] } }): Speaker | null =>
  spy.mock.calls[spy.mock.calls.length - 1]?.[0] ?? null

beforeEach(() => {
  localStorage.clear()
  mockConfig.api = {}
})

afterEach(() => {
  vi.restoreAllMocks()
  agentikoSpeakBackStore.installSpeaker(null)
})

describe('the speak-back voice is chosen by config', () => {
  it('installs NO TTS speaker when the install configured no endpoint', () => {
    const install = vi.spyOn(agentikoSpeakBackStore, 'installSpeaker')
    wire()
    expect(install).toHaveBeenCalledWith(null)
    expect(installed(install)).toBeNull()
  })

  it('installs one when the endpoint is set, and it POSTs there with the portal bearer', () => {
    mockConfig.api = { AUTOPILOT_VOICE_TTS_URL: TTS_URL }
    localStorage.setItem('K_user', JSON.stringify({ accessToken: 'portal-token' }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(() => undefined))
    const install = vi.spyOn(agentikoSpeakBackStore, 'installSpeaker')
    wire()

    const speaker = installed(install)
    expect(speaker).not.toBeNull()
    speaker?.speak('Two replicas are Ready.', 'en-US', { onFinished: vi.fn(), onRefused: vi.fn() })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [[url, init]] = fetchSpy.mock.calls
    expect(url).toBe(TTS_URL)
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer portal-token')
    expect(JSON.parse(bodyText(init))).toMatchObject({
      input: { text: 'Two replicas are Ready.' },
      voice: { name: DEFAULT_TTS_VOICE },
    })
  })

  it('lets the operator name the voice', () => {
    mockConfig.api = { AUTOPILOT_VOICE_NAME: 'it-IT-Chirp3-HD-Achernar', AUTOPILOT_VOICE_TTS_URL: TTS_URL }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(() => undefined))
    const install = vi.spyOn(agentikoSpeakBackStore, 'installSpeaker')
    wire()
    installed(install)?.speak('Due repliche sono pronte.', 'en-US', { onFinished: vi.fn(), onRefused: vi.fn() })
    const [[, sent]] = fetchSpy.mock.calls
    expect(JSON.parse(bodyText(sent))).toMatchObject({
      voice: { languageCode: 'it-IT', name: 'it-IT-Chirp3-HD-Achernar' },
    })
  })

  it('makes speak-back available on a machine jsdom-like enough to have no voice at all', () => {
    // jsdom has no `speechSynthesis`, which is the "no-synthesis" case the browser speaker
    // can never recover from — and precisely the machine Cloud TTS exists to serve.
    expect(agentikoSpeakBackStore.getSnapshot()).toMatchObject({ available: false, reason: 'no-synthesis' })
    mockConfig.api = { AUTOPILOT_VOICE_TTS_URL: TTS_URL }
    wire()
    expect(agentikoSpeakBackStore.getSnapshot()).toMatchObject({ available: true, reason: null })
  })
})
