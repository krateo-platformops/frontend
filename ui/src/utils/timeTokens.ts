import { formatTime, type TimeForm, toInstant } from './dateFormat'

/**
 * A time token in widget TEXT: `{ago:2026-11-04T10:10:27Z}`, `{age:…}`, `{moment:…}` or `{date:…}`, an ISO
 * (RFC3339) time the RESTAction writes inside a sentence ("CompositionDefinition · ns · created
 * {ago:2026-11-04T10:10:27Z}"). The browser writes it in that form (utils/dateFormat), in the viewer's zone.
 *
 * It is a token, never prose reparsed: the RESTAction says what is a time and in which form. And it is the
 * browser's, like {localTimeOfDay} (utils/localTokens): snowplow caches a widget's rendered output with `now`
 * frozen, so an age computed in jq ("3d ago") is stale for as long as the cache lives.
 *
 * This is the one tokenizer. Plain text (components/TimeText/withTimeTokens: Paragraph, PageHeader, Alert,
 * Tag, Card) and Markdown (widgets/Markdown/remarkTimeTokens) both split with it.
 */
export const TIME_TOKEN_RE = /\{(age|ago|moment|date):(\d{4}-\d{2}-\d{2}(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?)\}/gi

export interface TimeTokenPiece { form: TimeForm; value: string }

/**
 * Text as its pieces: plain strings and the times its tokens name, in order. A token whose time does not
 * parse stays in the text as written. Text without a token is one piece, the text itself.
 */
export const splitTimeTokens = (text: string): (string | TimeTokenPiece)[] => {
  if (!text.includes('{')) { return [text] }
  const pieces: (string | TimeTokenPiece)[] = []
  let last = 0
  for (const match of text.matchAll(TIME_TOKEN_RE)) {
    const [token, form, value] = match
    if (!toInstant(value)) { continue }
    if (match.index > last) { pieces.push(text.slice(last, match.index)) }
    pieces.push({ form: form.toLowerCase() as TimeForm, value })
    last = match.index + token.length
  }
  if (last === 0) { return [text] }
  if (last < text.length) { pieces.push(text.slice(last)) }
  return pieces
}

/** Whether the text holds a time token (one whose time parses). */
export const hasTimeTokens = (text: string | undefined): text is string => (
  typeof text === 'string' && splitTimeTokens(text).some((piece) => typeof piece !== 'string')
)

/**
 * The text with each token written as its words, for where only text goes (a copied or downloaded Markdown
 * source): "created 3 weeks ago", never "created {ago:2026-11-04T10:10:27Z}".
 */
export const timeTokensAsText = (text: string): string => splitTimeTokens(text)
  .map((piece) => (typeof piece === 'string' ? piece : formatTime(piece.value, piece.form)))
  .join('')
