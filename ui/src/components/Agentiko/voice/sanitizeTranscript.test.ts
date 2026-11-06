/**
 * The sanitiser. Small, pure, and one of its rules is load-bearing: a result longer than
 * a minute of speech can produce is the model ANSWERING rather than transcribing, and it
 * is rejected outright rather than trimmed — a truncated fabrication is still one.
 */
import { describe, expect, it } from 'vitest'

import { sanitizeTranscript, TRANSCRIPT_MAX_CHARS } from './sanitizeTranscript'

const ok = (raw: string): string => {
  const result = sanitizeTranscript(raw)
  if (!result.ok) {
    throw new Error(`expected a transcript, got ${result.reason}`)
  }
  return result.text
}

describe('sanitizeTranscript', () => {
  it('trims and collapses whitespace', () => {
    expect(ok('  scale   payments\n\nto three  ')).toBe('scale payments to three')
  })

  it('strips a label the prompt already forbade', () => {
    expect(ok('Transcript: scale payments')).toBe('scale payments')
    expect(ok('Transcription:  scale payments')).toBe('scale payments')
  })

  it('unwraps one pair of quotes, straight or curly', () => {
    expect(ok('"scale payments"')).toBe('scale payments')
    expect(ok('“scale payments”')).toBe('scale payments')
  })

  it('handles the label and the quotes nested in either order', () => {
    expect(ok('Transcript: "scale payments"')).toBe('scale payments')
    expect(ok('"Transcript: scale payments"')).toBe('scale payments')
  })

  it('leaves quotes the user actually said in the middle of a sentence alone', () => {
    expect(ok('he said "scale it" and left')).toBe('he said "scale it" and left')
  })

  it('normalises the product name in every casing it is misheard as (FR 15)', () => {
    expect(ok('open the crateo portal')).toBe('open the Krateo portal')
    expect(ok('Cratio compositions')).toBe('Krateo compositions')
  })

  it('does not rewrite an unrelated word that merely looks similar', () => {
    expect(ok('create a composition')).toBe('create a composition')
    expect(ok('crateomania')).toBe('crateomania')
  })

  it('reports an empty result rather than returning one', () => {
    expect(sanitizeTranscript('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(sanitizeTranscript(undefined)).toEqual({ ok: false, reason: 'empty' })
    expect(sanitizeTranscript('""')).toEqual({ ok: false, reason: 'empty' })
  })

  it('REJECTS a result longer than a minute of speech can produce — that is the model answering', () => {
    const essay = 'a'.repeat(TRANSCRIPT_MAX_CHARS + 1)
    expect(sanitizeTranscript(essay)).toEqual({ ok: false, reason: 'too-long' })
    // And it is a rejection, not a trim: no truncated prose comes back.
    expect(sanitizeTranscript(essay)).not.toHaveProperty('text')
  })

  it('accepts a long but plausible dictation right up to the cap', () => {
    expect(ok('b'.repeat(TRANSCRIPT_MAX_CHARS))).toHaveLength(TRANSCRIPT_MAX_CHARS)
  })
})
