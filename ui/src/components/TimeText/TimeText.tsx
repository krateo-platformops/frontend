import { Tooltip } from 'antd'
import { type CSSProperties, type ReactNode, useState } from 'react'

import { formatFull, formatTime, type TimeForm, type TimeFormatOptions, toInstant } from '../../utils/dateFormat'

export interface TimeTextProps {
  /** What is shown; defaults to the value in `form`. A caller that already formatted it passes its text. */
  children?: ReactNode
  className?: string
  /** age ("7 weeks"), ago ("52 minutes ago"), moment ("4 Nov, 11:10") or date ("4 Nov"). */
  form: TimeForm
  /** Tests pin the clock and the zone; everyone else gets now and the viewer's zone. */
  options?: TimeFormatOptions
  style?: CSSProperties
  /** An ISO string, a Date or an epoch in milliseconds. */
  value: unknown
}

/**
 * A time, in one of the approved forms (utils/dateFormat), with the full date on hover AND focus:
 * "Wed 4 November 2026, 11:10:27 (UTC+1)" (approved design "Dates and ages", 2026-11-24). A `<time>`
 * whose `dateTime` is the instant, so the machine-readable moment rides with the words.
 *
 * Focus behaves as Table's cell tooltip does: keyboard focus only (a click has already opened it by
 * hover), and Escape closes it where focus stays (WCAG 1.4.13). A value that names no time is shown as
 * it came, with no tooltip and no tab stop.
 */
const TimeText = ({ children, className, form, options, style, value }: TimeTextProps) => {
  const [byFocus, setByFocus] = useState(false)
  const [byHover, setByHover] = useState(false)
  const instant = toInstant(value)
  const text = children ?? formatTime(value, form, options)
  if (!instant) {
    return <span className={className} style={style}>{text}</span>
  }
  const open = byFocus || byHover

  return (
    <Tooltip onOpenChange={setByHover} open={open} title={formatFull(value, options)}>
      {/* C8 exception: not a control. A focusable time whose only key is Escape, to close the date it
          discloses. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <time
        className={className}
        dateTime={instant.toISOString()}
        onBlur={() => { setByFocus(false) }}
        onFocus={(event) => { setByFocus(event.currentTarget.matches(':focus-visible')) }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.stopPropagation()
            setByFocus(false)
            setByHover(false)
          }
        }}
        style={style}
        tabIndex={0}
      >
        {text}
      </time>
    </Tooltip>
  )
}

export default TimeText
