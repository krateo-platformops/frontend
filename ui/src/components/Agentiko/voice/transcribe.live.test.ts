// @vitest-environment jsdom
/**
 * The one test that is not a fake: the real `transcribeRecording` against the real `/stt/v1`.
 *
 * Everything else in this directory proves the code behaves correctly against stubs. That is
 * necessary and not sufficient — the two things that could still be wrong are the ones no stub
 * can settle, because both are properties of the backend rather than of us:
 *
 *   1. the shipped container. Browsers record `audio/webm;codecs=opus`; the only format ever
 *      proven to reach Vertex through this gateway was WAV, produced by hand. If Opus-in-WebM
 *      were rejected, every real dictation would fail as a generic `no-speech` or `engine`
 *      error, and no unit test would have said a word about it.
 *   2. `AUDIO_TOKENS_FLOOR`. The anti-fabrication gate rejects a response whose token count
 *      shows no audio arrived. Set too high, it rejects genuine transcriptions instead — and
 *      it was calibrated on a single WAV clip, in a format the client is forbidden to send.
 *
 * So this test sends real Opus to the real route with a real bearer and asserts both. It is
 * skipped unless `VOICE_LIVE=1`, because it needs a reachable cluster and a credential and
 * spends a model call. Run it when the route changes, the model changes, or before release:
 *
 *   VOICE_LIVE=1 \
 *   VOICE_STT_URL=https://portal.krateo.dev/stt/v1/chat/completions \
 *   VOICE_TOKEN="$(cat <a fresh portal bearer>)" \
 *   VOICE_FIXTURE=/tmp/voice-probe.webm \
 *   VOICE_EXPECT="scale the payments composition" \
 *     npx vitest run src/components/Agentiko/voice/transcribe.live.test.ts
 *
 * The fixture is any short spoken clip; `VOICE_EXPECT` is a lowercase substring of what it says,
 * loose enough to survive ordinary recognition variance. Speech recognition is not deterministic,
 * so this asserts the transcript is *plausibly the clip* — not an exact string.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { transcribeRecording, type TranscribeDeps } from './transcribe'
import { AUDIO_TOKENS_FLOOR, audioArrived, textTokenEstimate } from './voicePrompt'

const live = process.env.VOICE_LIVE === '1'
const url = process.env.VOICE_STT_URL ?? ''
const token = process.env.VOICE_TOKEN ?? ''
const fixture = process.env.VOICE_FIXTURE ?? ''
const expected = (process.env.VOICE_EXPECT ?? '').toLowerCase()

const deps = (): TranscribeDeps => ({
  authHeader: () => ({ Authorization: `Bearer ${token}` }),
  fetchImpl: globalThis.fetch,
  model: process.env.VOICE_MODEL || 'gemini-3.8-flash',
  raiseSessionExpired: () => Promise.resolve('logout' as const),
  rateLimitNotice: () => null,
  url,
})

describe.skipIf(!live)('transcribeRecording against the live /stt/v1', () => {
  it('transcribes audio/webm;codecs=opus — the container browsers actually record', async () => {
    expect(url, 'VOICE_STT_URL').toBeTruthy()
    expect(token, 'VOICE_TOKEN').toBeTruthy()
    expect(fixture, 'VOICE_FIXTURE').toBeTruthy()

    const bytes = readFileSync(fixture)
    const blob = new Blob([bytes], { type: 'audio/webm;codecs=opus' })
    const seconds = Number(process.env.VOICE_SECONDS || '4')

    const out = await transcribeRecording(deps(), {
      language: 'en-US',
      recording: { blob, mediaType: 'audio/webm', peakRms: 0.5, seconds },
    })

    // It came back at all, which means the gate passed and the container was accepted.
    expect(out.text.trim().length).toBeGreaterThan(0)
    if (expected) { expect(out.text.toLowerCase()).toContain(expected) }

    // And the floor has real headroom on THIS container, not just on the WAV it was tuned on.
    const audioTokens = out.promptTokens - textTokenEstimate(out.textPromptChars)
    const perSecond = audioTokens / seconds
    // eslint-disable-next-line no-console -- the measurement is the point of the test
    console.log(`live: "${out.text.trim()}" · ${audioTokens} audio tokens / ${seconds}s = `
      + `${perSecond.toFixed(1)}/s vs floor ${AUDIO_TOKENS_FLOOR}/s`)
    expect(perSecond).toBeGreaterThan(AUDIO_TOKENS_FLOOR)
    expect(audioArrived(out.promptTokens, out.textPromptChars, seconds)).toBe(true)
  }, 60_000)

  it('still rejects a response that carries no audio, against the live endpoint', async () => {
    // The same gate, exercised where it matters: a zero-length recording must not come back as
    // a confident sentence. Whatever the backend does with it, nothing may reach the caller.
    const blob = new Blob([new Uint8Array(0)], { type: 'audio/webm;codecs=opus' })
    await expect(transcribeRecording(deps(), {
      language: 'en-US',
      recording: { blob, mediaType: 'audio/webm', peakRms: 0.5, seconds: 4 },
    })).rejects.toThrow()
  }, 60_000)
})
