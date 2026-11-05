/**
 * TRANSCRIPT SANITISER — the last pure step before spoken words become composer text.
 * Voice spec FR 15, 52.
 *
 * It does four small things and one load-bearing one.
 *
 * Small: trim, collapse runs of whitespace, drop a `Transcript:` label the model was told
 * not to add, and unwrap a pair of quotes it was told not to add either. The prompt
 * forbids all of that (FR 53); this is the belt behind those braces, because a model that
 * ignores one instruction under load will ignore it in the composer.
 *
 * Load-bearing: THE LENGTH REJECTION. Sixty seconds of human speech is roughly 150–200
 * words — call it 1,200 characters with room to spare. A result past 1,500 characters is
 * not a long transcription; it is the model having answered the question in the audio
 * instead of transcribing it, or having explained what it heard. Either way it is prose
 * the user never said, so it is rejected outright rather than trimmed — a truncated
 * fabrication is still a fabrication.
 *
 * `Crateo → Krateo` (FR 15) is the one substitution allowed: the product name is the term
 * this audience says most and the one the model gets wrong most, and it is spelling, not
 * meaning. Nothing else here changes a word the user said.
 */

/** Above this, the result is the model answering rather than transcribing (FR 52). */
export const TRANSCRIPT_MAX_CHARS = 1500

/** `empty` means nothing was said; `too-long` means the model stopped transcribing. */
export type SanitizeTranscriptResult
  = { ok: false; reason: 'empty' | 'too-long' }
  | { ok: true; text: string }

/** A leading label the prompt forbids, in the two spellings models actually emit. */
const LABEL_PATTERN = /^(?:transcript|transcription)\s*:\s*/i

/** One matching pair of wrapping quotes — straight, curly, or guillemets. */
const QUOTE_PAIRS: readonly [string, string][] = Object.freeze([
  ['"', '"'],
  ['\'', '\''],
  ['“', '”'],
  ['‘', '’'],
  ['«', '»'],
])

const stripWrappingQuotes = (text: string): string => {
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(open.length, text.length - close.length).trim()
    }
  }
  return text
}

/** FR 15. Narrow on purpose — exactly the mishearings measured (Crateo / crateo / Cratio),
 *  not a fuzzy family that could rewrite an unrelated word the user really did say. The
 *  product name is always capitalised, so every casing maps to the one spelling. */
const normalizeProductName = (text: string): string => text.replace(/\bcrat[ei]o\b/gi, 'Krateo')

/**
 * Pure. Returns the text that may enter the draft, or the reason it may not.
 *
 * The label/quote strip runs twice because the two decorations nest in both orders —
 * `Transcript: "scale payments"` and `"Transcript: scale payments"` are both real model
 * output, and one pass leaves the inner one behind.
 */
export const sanitizeTranscript = (raw: string | undefined): SanitizeTranscriptResult => {
  let text = (raw ?? '').replace(/\s+/g, ' ').trim()
  for (let pass = 0; pass < 2; pass += 1) {
    text = stripWrappingQuotes(text.replace(LABEL_PATTERN, '').trim())
  }
  text = normalizeProductName(text).trim()
  if (!text) {
    return { ok: false, reason: 'empty' }
  }
  if (text.length > TRANSCRIPT_MAX_CHARS) {
    return { ok: false, reason: 'too-long' }
  }
  return { ok: true, text }
}
