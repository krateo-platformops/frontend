/**
 * SPEAKABLE — the pure, local, synchronous transform from an assistant message into the
 * words a synthesiser says. Voice spec §3.3/§3.4, FR 68 / 70 / 71 / 72.
 *
 * THE INVARIANT (FR 68, and the reason this file has no dependencies worth speaking of):
 * the spoken text is a RENDERING OF THE EXACT STRING ALREADY WRITTEN IN THE CHAT —
 * `message.text` after finalize. It is never a separately generated spoken summary and
 * there is never a second model call on this path. Agentiko proposes changes against
 * live clusters: a user who HEARS one account of what the agent found while the
 * transcript RECORDS another has no way to know which one the agent will act on, and the
 * written record is what an incident review reads afterwards. Everything here is
 * deterministic — same input, same output, no clock, no network, no randomness.
 *
 * THE RULE THAT DECIDES EVERY CASE BELOW: a construct that conveys SHAPE rather than
 * PROSE is SKIPPED — not recited, and no longer announced either. Reading an indented
 * YAML manifest aloud character by character is not a degraded experience, it is an
 * actively hostile one; a linearised table is noise. Prose — paragraphs, headings, list
 * items, inline code, resource names — is spoken as written. Everything else is silent.
 *
 * WHAT CHANGED, AND WHY IT IS A REVERSAL. This file used to ANNOUNCE the shapes it skipped
 * ("Code block, 12 lines of YAML, shown in the chat") and to append an action sentence
 * ("This answer proposes an action: X. Confirm it in the chat."), the latter documented as
 * FR 71's one permitted addition, on the argument that a listener hearing only prose would
 * never learn the answer proposes a change.
 *
 * In use that argument lost to a simpler one: the additions made the voice read things the
 * user had not asked it to read, on every reply carrying a manifest — which is most of
 * them. The narration competed with the answer. Reported directly: "it reads too much. It
 * should read only the text chat, not the proposed action or other stuff."
 *
 * The honesty concern FR 71 protected is real, but it is already carried visually: the
 * action chip renders in the chat, unmissable, and nothing is applied without pressing it.
 * Speech was never the confirmation surface — the chip is. So the spoken rendering is now
 * strictly a SUBSET of the written text: prose, in order, nothing added.
 *
 * ONE EXCEPTION SURVIVES — the FR 72 truncation tail. A capped answer that simply stops
 * mid-thought is not "less narration", it is a listener believing they heard all of it.
 * That is a comprehension failure rather than chattiness, so the tail stays.
 */

import type { AgentikoActionChip } from '../../types'

/** Voice spec FR 72: speak at most this much, cut at a sentence boundary. */
export const SPEAK_CAP_CHARS = 1200

/** FR 72: the fixed tail after a capped answer. The written answer is never abridged. */
export const SPEAK_TRUNCATION_TAIL = 'The rest of the answer is in the chat.'

/** FR 74: Chromium stalls on long utterances; the queue is chunked at sentence boundaries. */
export const SPEAK_CHUNK_CHARS = 200

/**
 * The declared pronunciation map (FR 70). LEXICAL ONLY: it may change HOW a token is
 * pronounced, never WHICH words are said, and it never touches the written text. Every
 * entry is a respelling of the same term for a synthesiser that would otherwise spell it
 * out or mangle it. Whole-token matches only — `kubectlx` is left alone.
 *
 * Deliberately tiny. Every addition is a chance to say a different word than the chat
 * shows, so the bar is "the synthesiser demonstrably mangles this and the respelling is
 * unambiguously the same term".
 */
export const SPOKEN_PRONUNCIATIONS: Readonly<Record<string, string>> = Object.freeze({
  CI: 'C I',
  CLI: 'C L I',
  CRD: 'C R D',
  CRDs: 'C R Ds',
  RBAC: 'R B A C',
  YAML: 'yamel',
  kubectl: 'kube control',
})

/** Fence open/close for a code block, capturing the info string (the language, when given). */
const FENCE_LINE = /^\s{0,3}(?:```|~~~)\s*([A-Za-z0-9+#._-]*)/
/** A markdown table's separator row: only pipes, dashes, colons and spaces. */
const TABLE_SEPARATOR = /^[|\-: ]+$/
/** ATX heading markers. */
const HEADING = /^\s{0,3}#{1,6}\s+/
/** A thematic break — pure shape, spoken as nothing. */
const THEMATIC_BREAK = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
/** Unordered list marker. */
const BULLET = /^\s*[-*+]\s+/
/** Ordered list marker (the number is re-derived, so a mis-numbered source still counts up). */
const ORDERED = /^\s*(\d{1,3})[.)]\s+/
/** Blockquote marker (possibly nested). */
const QUOTE = /^\s*>+\s?/
/** An indented prose line: a list item's wrapped continuation, not a new paragraph. */
const CONTINUATION_INDENT = /^\s{2,}\S/

/** The warning glyph the provider prepends on an `error` frame — spoken as a word. */
const WARNING_GLYPH = /\u26A0\uFE0F?/g
/** Everything else pictographic: unpronounceable, so dropped rather than described. */
const PICTOGRAPHIC = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu

const isTableRow = (line: string): boolean => line.includes('|')

const isTableSeparator = (line: string): boolean => {
  const trimmed = line.trim()
  return trimmed.includes('|') && trimmed.includes('-') && TABLE_SEPARATOR.test(trimmed)
}

/**
 * Inline markdown → words. Order matters: images before links (both use `](`), links
 * before bare-URL removal, inline code unwrapped before emphasis so a backticked
 * `**literal**` is not stripped.
 *
 * Bare URLs are DROPPED, not read: a spoken URL is unusable and very long, and the §3.4
 * table already says the URL half of a link is not spoken. `_underscore_` emphasis is
 * deliberately NOT stripped — in this product an underscore is far more often part of a
 * resource or field name (`spec.forProvider.region_name`) than an italic marker, and
 * fidelity says the resource name is the words.
 */
const inlineToWords = (input: string): string => input
  // HTML → text kept, markers dropped. The leading tag-name character is load-bearing: a
  // bare `<…>` match also eats ordinary prose between a less-than and a greater-than
  // ("keep replicas < 3 and > 1" → "keep replicas 1"), which INVERTS a threshold the chat
  // shows in full. Micromark does not treat `< 3` as HTML either, so this now agrees with
  // what the reader sees.
  .replace(/<\/?[A-Za-z][^<>\n]{0,200}>/g, '')
  // ![alt](url) → alt
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  // [text](url) → text
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  // Reference-style links: [text][ref] → text
  .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
  // Bare URLs carry no speakable words.
  .replace(/\b(?:https?|ftp):\/\/\S+/gi, '')
  // Inline code → its contents, read as words (usually a short resource or field name).
  .replace(/`([^`]*)`/g, '$1')
  // Emphasis / strikethrough markers.
  .replace(/(\*\*|__|~~)/g, '')
  .replace(/\*([^*\n]+)\*/g, '$1')
  .replace(WARNING_GLYPH, ' Warning. ')
  .replace(PICTOGRAPHIC, '')

/** Give a block a sentence pause so the synthesiser does not run two paragraphs together. */
const asSentence = (text: string): string => {
  const trimmed = text.trim()
  if (!trimmed) {
    return ''
  }
  return /[.!?:;]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/**
 * A fenced block is SILENT — not its contents (hostile to recite) and no longer an
 * announcement either. The parameters are kept so the call sites still read as a
 * deliberate skip rather than a dropped branch, and so restoring the announcement is a
 * one-line change if it is ever wanted back.
 */
const describeCodeBlock = (_lines: number, _language: string): string => ''

/** A table is SILENT, for the same reason: column structure does not survive speech. */
const describeTable = (_rows: number): string => ''

/** Whole-token pronunciation respelling (FR 70). Never changes WHICH words are spoken. */
const applyPronunciations = (text: string): string => {
  const tokens = Object.keys(SPOKEN_PRONUNCIATIONS)
  if (!tokens.length) {
    return text
  }
  const pattern = new RegExp(`(?<![\\w-])(${tokens.join('|')})(?![\\w-])`, 'g')
  return text.replace(pattern, (match) => SPOKEN_PRONUNCIATIONS[match] ?? match)
}

/** Walk the markdown block by block. Fences and tables are consumed whole and NAMED. */
const renderBlocks = (markdown: string): string[] => {
  const lines = markdown.split(/\r?\n/)
  const out: string[] = []
  let paragraph: string[] = []
  let ordinal = 0

  const flushParagraph = (): void => {
    if (paragraph.length) {
      out.push(asSentence(inlineToWords(paragraph.join(' '))))
      paragraph = []
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fence = FENCE_LINE.exec(line)
    if (fence) {
      flushParagraph()
      ordinal = 0
      const language = fence[1] ?? ''
      let body = 0
      index += 1
      while (index < lines.length && !FENCE_LINE.test(lines[index])) {
        body += 1
        index += 1
      }
      out.push(describeCodeBlock(body, language))
      continue
    }
    if (isTableRow(line) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushParagraph()
      ordinal = 0
      index += 2
      let rows = 0
      while (index < lines.length && isTableRow(lines[index]) && lines[index].trim()) {
        rows += 1
        index += 1
      }
      index -= 1
      out.push(describeTable(rows))
      continue
    }
    // A BLANK LINE DOES NOT RESTART THE NUMBERING. Blank-line-separated ("loose") ordered
    // lists are the normal shape of a written remediation plan, and `<ReactMarkdown>`
    // renders one as a single <ol> numbered 1, 2, 3 — so resetting here made the listener
    // hear every step called step one while the chat showed an ordered plan, precisely
    // where the order carries the meaning. The counter is reset by the next block that is
    // not part of the list (below), not by the whitespace inside it.
    if (!line.trim()) {
      flushParagraph()
      continue
    }
    if (THEMATIC_BREAK.test(line)) {
      flushParagraph()
      ordinal = 0
      continue
    }
    const unquoted = line.replace(QUOTE, '')
    if (HEADING.test(unquoted)) {
      flushParagraph()
      ordinal = 0
      out.push(asSentence(inlineToWords(unquoted.replace(HEADING, ''))))
      continue
    }
    const ordered = ORDERED.exec(unquoted)
    if (ordered) {
      flushParagraph()
      ordinal += 1
      out.push(`${ordinal}. ${asSentence(inlineToWords(unquoted.replace(ORDERED, '')))}`)
      continue
    }
    if (BULLET.test(unquoted)) {
      flushParagraph()
      ordinal = 0
      out.push(asSentence(inlineToWords(unquoted.replace(BULLET, ''))))
      continue
    }
    // Prose at the LEFT MARGIN ends an ordered list, so a later list starts again at one.
    // An INDENTED line is a list item's own wrapped continuation and must leave the count
    // alone — otherwise the item after a two-line item is announced as step one again.
    if (!CONTINUATION_INDENT.test(line)) {
      ordinal = 0
    }
    paragraph.push(unquoted)
  }
  flushParagraph()
  return out.filter(Boolean)
}

/**
 * The §3.4 rendering: markdown → the words a synthesiser says. Pure and deterministic.
 * Never reads a code block, a table or a URL; keeps every other word the chat shows.
 */
export const speakableFromMarkdown = (markdown: string): string => {
  const spoken = applyPronunciations(renderBlocks(markdown ?? '').join(' '))
  return spoken.replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim()
}

/**
 * FR 72: cap at ~1,200 characters, cut at the LAST SENTENCE BOUNDARY at or before the cap
 * — never mid-thought. An uncapped RCA is a two-minute monologue nobody asked for, and a
 * sentence cut mid-word is its own species of misleading. Falls back to a word boundary
 * only when the whole window contains no sentence end at all.
 */
export const capSpeakable = (text: string, cap: number = SPEAK_CAP_CHARS): { text: string; truncated: boolean } => {
  if (text.length <= cap) {
    return { text, truncated: false }
  }
  const head = text.slice(0, cap)
  const boundary = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  if (boundary > 0) {
    return { text: head.slice(0, boundary + 1).trim(), truncated: true }
  }
  const space = head.lastIndexOf(' ')
  return { text: (space > 0 ? head.slice(0, space) : head).trim(), truncated: true }
}

/**
 * FR 71 REVERSED: no action sentence. This returned "This answer proposes an action: X.
 * Confirm it in the chat." — constant declared words, and still the single largest source
 * of speech the user did not ask for, on every reply that carries a chip.
 *
 * Kept as a function returning "" rather than deleted: speakableForMessage still composes
 * it, so the seam where an addition WOULD go stays visible and auditable, and the export
 * keeps its test surface. Anything reinstated here must clear the same bar FR 68 sets —
 * it has to already be in the written text, or it does not get spoken.
 */
export const actionSentence = (_actions?: AgentikoActionChip[]): string => ''

/** What speak-back reads: the finalized message text plus (only) its chip label. */
export interface SpeakableMessage {
  actions?: AgentikoActionChip[]
  text: string
}

/**
 * The whole rendering, in the order the requirements fix it: §3.4 prose, then the FR 72
 * cap and its tail, then the FR 71 action sentence.
 *
 * The action sentence sits AFTER the cap on purpose. It is the one addition FR 68 permits
 * precisely because a listener would otherwise never learn the answer proposes changing
 * something — so it is exactly the sentence that must not be the one the cap eats.
 */
export const speakableForMessage = (message: SpeakableMessage): string => {
  const { text: capped, truncated } = capSpeakable(speakableFromMarkdown(message.text))
  return [capped, truncated ? SPEAK_TRUNCATION_TAIL : '', actionSentence(message.actions)]
    .filter(Boolean)
    .join(' ')
    .trim()
}

/**
 * FR 74: split into utterances of ≤ `max` characters at sentence boundaries, because
 * Chromium stalls part-way through a long one. A single sentence longer than the cap is
 * split at word boundaries rather than mid-word.
 */
export const chunkForUtterances = (text: string, max: number = SPEAK_CHUNK_CHARS): string[] => {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? (text ? [text] : [])
  const chunks: string[] = []
  let current = ''
  const push = (): void => {
    const trimmed = current.trim()
    if (trimmed) {
      chunks.push(trimmed)
    }
    current = ''
  }
  for (const sentence of sentences) {
    if (sentence.trim().length > max) {
      push()
      let words = ''
      for (const word of sentence.split(/\s+/)) {
        if (words && `${words} ${word}`.length > max) {
          chunks.push(words)
          words = word
        } else {
          words = words ? `${words} ${word}` : word
        }
      }
      if (words.trim()) {
        chunks.push(words.trim())
      }
      continue
    }
    if (current && (current + sentence).trim().length > max) {
      push()
    }
    current += sentence
  }
  push()
  return chunks
}
