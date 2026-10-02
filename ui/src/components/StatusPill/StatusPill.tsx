import { Tag as AntdTag } from 'antd'
import type { CSSProperties, ReactNode } from 'react'

import { getTagStyle } from '../../theme/palette'

/**
 * One status pill, drawn one way.
 *
 * This markup used to live only inside the `Tag` WIDGET. `PageHeader` then grew a native `tags`
 * array and rendered it with a bare antd `Tag` — same palette hex, same word, no dot. The two
 * pills were a few pixels apart on a detail page and did not match, and nothing caught it: no
 * test asserts the dot, and a missing 6px circle does not fail a schema.
 *
 * That mattered more than one page's polish, because `PageHeader.tags` is the route every detail
 * page's status pill is migrating onto — blueprint, cluster, component and composition detail all
 * pair a title Paragraph with a status Tag today. Had this shipped, all four would have quietly
 * lost their dot on the way in.
 *
 * So the dot lives here now and both call sites use it.
 */
type StatusPillProps = {
  color?: string
  label?: ReactNode
  style?: CSSProperties
  // Everything else the Tag CR carries (`variant`, and the `watch` the widget layer adds) is
  // forwarded to antd untouched, exactly as the Tag widget did before this was extracted. Dropping
  // an unrecognised prop here would be a silent behaviour change dressed up as a refactor.
  [key: string]: unknown
}

const StatusPill = ({ color, label, style, ...rest }: StatusPillProps) => {
  const palette = color ? getTagStyle(color) : undefined
  const merged = palette ? { ...palette, ...style } : style

  // Show the dot ONLY for coloured pills that don't set their own fontSize: the sized delta pills
  // ("5 new", "96%") carry a number, not a status, so a dot there would be noise.
  //
  // And only when there is a LABEL. A dot with no word carries its meaning by colour alone —
  // invisible to a screen reader, to a colourblind reader, and gone the moment the page is
  // printed or screenshotted into a ticket. Every state that matters has a word.
  const showDot = !!palette && !!label && !style?.fontSize

  return (
    <AntdTag {...rest} style={merged}>
      {showDot && (
        <span
          style={{
            background: palette?.color,
            borderRadius: '50%',
            display: 'inline-block',
            height: 6,
            marginRight: 'var(--spacing-xsm)',
            verticalAlign: 'middle',
            width: 6,
          }}
        />
      )}
      {label}
    </AntdTag>
  )
}

export default StatusPill
