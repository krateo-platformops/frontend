import { Fragment, type ReactNode } from 'react'

import { type TimeForm, toInstant } from '../../utils/dateFormat'

import TimeText from './TimeText'

/**
 * A time token in widget TEXT: `{ago:2026-11-04T10:10:27Z}`, `{age:…}`, `{moment:…}` or `{date:…}`, an ISO
 * (RFC3339) time the RESTAction writes inside a sentence ("CompositionDefinition · ns · created
 * {ago:2026-11-04T10:10:27Z}"). The browser writes it in that form (utils/dateFormat), in the viewer's zone,
 * full date on hover and focus.
 *
 * It is a token, never prose reparsed: the RESTAction says what is a time and in which form. And it is the
 * browser's, like {localTimeOfDay} (utils/localTokens): snowplow caches a widget's rendered output with `now`
 * frozen, so an age computed in jq ("3d ago") is stale for as long as the cache lives.
 */
export const TIME_TOKEN_RE = /\{(age|ago|moment|date):(\d{4}-\d{2}-\d{2}(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?)\}/gi

/**
 * Text with its time tokens written as times. Text without one comes back as the very string it was, so a
 * widget whose text has none renders exactly as before. A token whose time does not parse stays as written.
 */
export const withTimeTokens = (text: string | undefined): ReactNode => {
  if (typeof text !== 'string' || !text.includes('{')) { return text }
  const pieces: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(TIME_TOKEN_RE)) {
    const [token, form, value] = match
    if (!toInstant(value)) { continue }
    pieces.push(text.slice(last, match.index))
    pieces.push(<TimeText form={form.toLowerCase() as TimeForm} key={match.index} value={value} />)
    last = match.index + token.length
  }
  if (!pieces.length) { return text }
  pieces.push(text.slice(last))
  return <>{pieces.map((piece, index) => (typeof piece === 'string' ? <Fragment key={`t${index}`}>{piece}</Fragment> : piece))}</>
}
