import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { ReactNode } from 'react'

import styles from './DrawerHeader.module.css'

/**
 * #86 §0.10: the shared drawer-header title content. Rendered INTO antd `Drawer`'s `title` slot so
 * every drawer gets ONE typographic treatment (previously each of the three antd drawers hand-rolled
 * its own). Two emphasis tiers keep a deliberate hierarchy: `default` (16px — the generic widget
 * Drawer + the Agentiko preview) and `prominent` (18px — Notifications).
 *
 * Renders NO close button: antd injects the Drawer's own X (its placement is standardised once via
 * `drawerCloseProps` below). The Agentiko rail is a docked `<aside>`, NOT a Drawer, so it keeps its
 * own collapse control and does not use this component.
 */
export interface DrawerHeaderProps {
  title: ReactNode
  icon?: IconProp
  emphasis?: 'default' | 'prominent'
}

export const DrawerHeader = ({ emphasis = 'default', icon, title }: DrawerHeaderProps) => (
  <div className={styles.head}>
    {icon ? <FontAwesomeIcon className={styles.icon} icon={icon} /> : null}
    <span className={emphasis === 'prominent' ? styles.titleProminent : styles.title}>{title}</span>
  </div>
)

/**
 * The house-style close-button placement (#80: the X sits at the END, right of the title). Spread
 * onto every antd `Drawer` (`<Drawer {...drawerCloseProps} />`) so the placement decision lives in
 * ONE place instead of each drawer re-declaring `closable`.
 */
export const drawerCloseProps = { closable: { placement: 'end' as const } }

export default DrawerHeader
