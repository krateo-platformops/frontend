import { Fragment, type ReactNode } from 'react'

import { splitTimeTokens } from '../../utils/timeTokens'

import TimeText from './TimeText'

/**
 * Text with its time tokens (utils/timeTokens: `{ago:<ISO>}`, `{age:…}`, `{moment:…}`, `{date:…}`) written as
 * times, each with the full date on hover and focus. Text without one comes back as the very string it was,
 * so a widget whose text has none renders exactly as before. A token whose time does not parse stays as
 * written.
 */
export const withTimeTokens = (text: string | undefined): ReactNode => {
  if (typeof text !== 'string') { return text }
  const pieces = splitTimeTokens(text)
  if (pieces.length === 1 && typeof pieces[0] === 'string') { return text }
  return (
    <>
      {pieces.map((piece, index) => (typeof piece === 'string'
        ? <Fragment key={index}>{piece}</Fragment>
        : <TimeText form={piece.form} key={index} value={piece.value} />))}
    </>
  )
}
