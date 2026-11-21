import { CheckCircleFilled, ClockCircleFilled, CloseCircleFilled, ExclamationCircleFilled, PauseCircleFilled, QuestionCircleFilled } from '@ant-design/icons'
import { Tag as AntdTag } from 'antd'
import type { CSSProperties, ReactNode } from 'react'

import { getTagStyle } from '../../theme/palette'

import { stateFamily, type StateFamily } from './stateFamily'

/**
 * One antd filled glyph per state family (approved mockup, portal UX review): it takes the dot's
 * place and repeats the state's meaning by shape, so the pill does not rely on colour alone and two
 * states that share a colour (Paused, ReadyUnknown) no longer look alike.
 */
const GLYPH: Record<StateFamily, typeof CheckCircleFilled> = {
  drift: ExclamationCircleFilled,
  failed: CloseCircleFilled,
  healthy: CheckCircleFilled,
  paused: PauseCircleFilled,
  transitional: ClockCircleFilled,
  unknown: QuestionCircleFilled,
}

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
  const showMark = !!palette && !!label && !style?.fontSize
  // A Kubernetes state token carries its family's glyph in the dot's place; anything else keeps the
  // dot (stateFamily.ts says which tokens, and why the rest keep it).
  const family = showMark ? stateFamily(label) : undefined
  const Glyph = family ? GLYPH[family] : undefined

  return (
    <AntdTag {...rest} style={merged}>
      {Glyph && <Glyph aria-hidden data-state-family={family} style={{ color: palette?.color, fontSize: 'var(--krateo-text-caption)', marginRight: 'var(--spacing-xsm)', verticalAlign: '-0.125em' }} />}
      {showMark && !Glyph && (
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
