import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button, Tooltip } from 'antd'
import type { ReactNode, Ref } from 'react'

import styles from './HeaderIconButton.module.css'

interface Props {
  /** For a button that opens and closes something (the phone navigation drawer): its state. */
  ariaExpanded?: boolean
  /** Required. The control is icon-only, so nothing else gives it an accessible name. */
  ariaLabel: string
  icon: IconProp
  onClick: () => void
  /** The button element, for a caller that hands focus back to it (the phone navigation drawer). */
  ref?: Ref<HTMLButtonElement>
  /** Shown on hover. Use it to convey what the action will DO when the icon cannot. */
  tooltip?: ReactNode
}

/**
 * The one header chrome control.
 *
 * #80 §0.7 asked for this by name — "a single shared 'header icon button' style would prevent
 * this" — after the header's controls were found to be a custom button, an antd circle button, and
 * an antd circle button wrapped in a badge span, with three different alignments.
 *
 * What made it worth building even though they had converged on 36×36: they agreed by COINCIDENCE.
 * `ThemeToggle` set `style={{ height: 36, width: 36 }}` inline in its TSX; `Notifications` set the
 * same numbers in a CSS module. Two people wrote 36 twice, and nothing kept them writing it. The
 * inline pair was also invisible to the token lint, which only reads `.module.css` — so the header
 * was the one place a hardcoded size could drift without any check noticing.
 *
 * Size comes from `layout.headerIconSize` via a CSS variable, so there is now one number.
 *
 * NOT a home for the search trigger: that is a labelled pill with an icon, a placeholder and a
 * keyboard hint, not an icon button. Forcing it in here would make this component a shape it is
 * not, which is how shared components stop being shared.
 */
const HeaderIconButton = ({ ariaExpanded, ariaLabel, icon, onClick, ref, tooltip }: Props) => {
  const button = (
    <Button
      aria-expanded={ariaExpanded}
      aria-label={ariaLabel}
      className={styles.headerIcon}
      icon={<FontAwesomeIcon icon={icon} />}
      onClick={onClick}
      ref={ref}
      shape='circle'
      type='text'
    />
  )

  return tooltip ? <Tooltip title={tooltip}>{button}</Tooltip> : button
}

export default HeaderIconButton
