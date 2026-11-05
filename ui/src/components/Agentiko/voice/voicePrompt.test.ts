/**
 * The words we send with the audio, and the arithmetic that decides whether to believe
 * what comes back.
 *
 * The prompt tests are contract tests: each clause exists to stop one specific way the
 * model can stop transcribing and start assisting, so deleting a clause must fail here
 * rather than surface later as Agentiko answering a question the user only meant to
 * dictate.
 *
 * The `audioArrived` tests pin the two numbers the fabrication gate is made of, INCLUDING
 * the one that would have been wrong: a floor of 32 tokens/second (Google's documented
 * rate) would have rejected the only real transcription ever measured through this path.
 */
import { describe, expect, it } from 'vitest'

import {
  audioArrived,
  AUDIO_TOKENS_FLOOR,
  buildVocabularyBlock,
  buildVoiceSystemPrompt,
  languageHint,
  maxTokensForSeconds,
  MIN_RECORDING_SECONDS,
  NO_SPEECH_SENTINEL,
  textTokenEstimate,
  VOICE_SYSTEM_PROMPT,
  VOICE_VOCABULARY,
} from './voicePrompt'

describe('VOICE_SYSTEM_PROMPT — a transcriber, not an assistant (FR 53)', () => {
  it('says it is a transcription engine and not an assistant', () => {
    expect(VOICE_SYSTEM_PROMPT).toMatch(/transcription engine, not an assistant/i)
  })

  it('forbids answering, summarising, translating, explaining and acting — even on a question', () => {
    for (const forbidden of ['answer', 'summarise', 'translate', 'explain', 'act on']) {
      expect(VOICE_SYSTEM_PROMPT.toLowerCase()).toContain(forbidden)
    }
    expect(VOICE_SYSTEM_PROMPT).toMatch(/question in the audio is text to transcribe, never a question to answer/i)
  })

  it('forbids the decorations the sanitiser would otherwise have to guess at', () => {
    expect(VOICE_SYSTEM_PROMPT).toMatch(/quotation marks, labels, speaker names, timestamps/i)
  })

  it('names the no-speech sentinel exactly once, so the response check has one thing to match', () => {
    expect(VOICE_SYSTEM_PROMPT.split(NO_SPEECH_SENTINEL)).toHaveLength(2)
    expect(NO_SPEECH_SENTINEL).toBe('<no-speech>')
  })
})

describe('the language hint is mandatory and never a lock (FR 14)', () => {
  it('names the likely language, then explicitly permits any other and forbids translation', () => {
    const hint = languageHint('it-IT')
    expect(hint).toContain('it-IT')
    expect(hint).toMatch(/transcribe in whatever language you actually hear/i)
    expect(hint).toMatch(/never translate/i)
  })

  it('is present even with no navigator language — it is never omitted', () => {
    expect(languageHint(undefined)).toContain('en-US')
    expect(buildVoiceSystemPrompt(undefined)).toMatch(/never translate/i)
  })
})

describe('vocabulary bias (FR 54)', () => {
  it('carries the domain terms', () => {
    const block = buildVocabularyBlock()
    expect(block).toContain('Krateo')
    expect(block).toContain('CompositionDefinition')
    expect(VOICE_VOCABULARY.length).toBeLessThanOrEqual(40)
  })

  it('appends live page names and de-duplicates case-insensitively', () => {
    const block = buildVocabularyBlock(['payments-7f9c', 'PAYMENTS-7F9C', 'krateo'])
    expect(block).toContain('payments-7f9c')
    expect(block.match(/payments-7f9c/gi)).toHaveLength(1)
    expect(block.match(/krateo/gi)).toHaveLength(1)
  })

  it('caps the page names at 20 and the whole block at 1,200 characters', () => {
    const many = Array.from({ length: 60 }, (_, index) => `namespace-with-a-fairly-long-name-${index}`)
    const block = buildVocabularyBlock(many)
    expect(block.length).toBeLessThanOrEqual(1200)
    expect(block).not.toContain('namespace-with-a-fairly-long-name-59')
  })
})

describe('the output budget scales with the recording (FR 50)', () => {
  it('gives a 7-second clip more than the fixed 256 that truncated one mid-word', () => {
    expect(maxTokensForSeconds(7)).toBe(256 + 64 * 7)
    expect(maxTokensForSeconds(7)).toBeGreaterThan(256)
  })

  it('caps at 4096 for a full-length dictation', () => {
    expect(maxTokensForSeconds(60)).toBe(Math.min(4096, 256 + 64 * 60))
    expect(maxTokensForSeconds(600)).toBe(4096)
  })
})

describe('the audio-arrival arithmetic (FR 61) — the only thing that separates a transcription from a fabrication', () => {
  const promptChars = 1500

  it('REJECTS the measured no-audio signature: 19 prompt tokens for a real recording', () => {
    // 19 is the count a request carrying NO AUDIO AT ALL returns — measured identically for
    // a dropped `input_audio` part and for a text-only control. The model still answered
    // with a fluent invented sentence, so this arithmetic is the only thing that catches it.
    expect(audioArrived(19, promptChars, 3.9)).toBe(false)
    expect(audioArrived(19, promptChars, 7)).toBe(false)
  })

  it('ACCEPTS the measured real transcription: ~24 audio tokens/second', () => {
    // The V1 run: 111 total for ≈3.9 s, of which 92 were audio over a 19-token text prompt.
    const shortPrompt = 19 * 3.5
    expect(audioArrived(111, shortPrompt, 3.9)).toBe(true)
  })

  it('would have been BROKEN by a literal 32 tokens/second floor — which is why the floor is 8', () => {
    const shortPrompt = 19 * 3.5
    const audioTokens = 111 - textTokenEstimate(shortPrompt)
    expect(audioTokens / 3.9).toBeLessThan(32)
    expect(audioTokens / 3.9).toBeGreaterThan(AUDIO_TOKENS_FLOOR)
    expect(AUDIO_TOKENS_FLOOR).toBe(8)
  })

  /**
   * The floor is `AUDIO_TOKENS_FLOOR × seconds`, so at a fraction of a second it asks for a
   * fraction of a token — and a fabrication carrying no audio whatsoever clears that on the
   * estimate's rounding error alone. `MIN_RECORDING_SECONDS` stops the whole test collapsing
   * toward zero; `recorder.ts` refuses to produce a recording shorter than it, so the clamp
   * can never turn a real dictation into a false rejection.
   */
  it('never asks for less audio than a full second of it, however short the clip claims to be', () => {
    const estimate = textTokenEstimate(promptChars)
    // A tenth of a second would otherwise demand 0.8 tokens — this must still be rejected.
    expect(audioArrived(estimate + 4, promptChars, 0.1)).toBe(false)
    expect(audioArrived(estimate + 4, promptChars, 0.5)).toBe(false)
    expect(audioArrived(estimate + AUDIO_TOKENS_FLOOR * MIN_RECORDING_SECONDS, promptChars, 0.1)).toBe(true)
  })

  it('still accepts a real one-second dictation at the measured rate — the clamp is not a false rejection', () => {
    // ≈24 audio tokens/second measured; one second is the shortest recording `recorder.ts`
    // will hand up at all.
    const estimate = textTokenEstimate(promptChars)
    expect(audioArrived(estimate + 24, promptChars, MIN_RECORDING_SECONDS)).toBe(true)
  })

  it('treats MISSING usage as a failure, not a pass', () => {
    expect(audioArrived(undefined, promptChars, 5)).toBe(false)
    expect(audioArrived(Number.NaN, promptChars, 5)).toBe(false)
  })

  it('over-estimates the text side, so the error direction is a false rejection not a fabrication', () => {
    // 4.0 chars/token still over-estimates real English prose, so the gate stays strict and a
    // borderline call fails toward "try again". It was 3.5 until the first live call showed
    // that over-estimating by ~70 tokens swamped a 31-token threshold and refused a correct
    // transcript — the estimate's error must stay small relative to the floor.
    expect(textTokenEstimate(350)).toBe(88)
    expect(textTokenEstimate(0)).toBe(0)
  })
  it('does not reject the real transcription measured live on 2026-09-08', () => {
    // The exact numbers from the first live call: promptTokens 380, prompt 1229 chars, 3.91 s.
    // At the original 3.5 chars/token this returned false and refused a correct transcript.
    expect(audioArrived(380, 1229, 3.91)).toBe(true)
  })

  it('still refuses the same prompt when NO audio was billed', () => {
    // Same prompt, audio absent: the model bills only the text (~282 tokens at the observed rate).
    expect(audioArrived(282, 1229, 3.91)).toBe(false)
  })
})
