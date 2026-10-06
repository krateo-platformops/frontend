import type { ReactNode } from 'react'

import styles from './ScreenHeader.module.css'

/**
 * THE HEADER OF A SCREEN THE APP BUILDS ITSELF — the in-app twin of the PageHeader widget, which
 * does the same job for pages authored as CRs. Same shape: the title on the left; on the SAME row,
 * on the trailing edge, the status and then the actions (P26); the subtitle under that row.
 *
 * What it does not have is the point (P27, P2):
 *   - no eyebrow or crumb slot. The shell renders the page's breadcrumb above every page; a second
 *     one in the header is how the composers came to show "Controller Builder / Compose" twice;
 *   - no alignment prop. The Page composer once put its actions under the description, on the left,
 *     with a stylesheet rule saying so on purpose, while the Controller Builder put the same buttons
 *     top-right. One component, one place for them.
 *
 * `children` are what belongs under the header (notices, alerts), not more header.
 */
interface Props {
  /** Buttons, in reading order: the primary goes last, nearest the edge. */
  actions?: ReactNode
  children?: ReactNode
  /** A muted fact on the title's line (a version, an identifier). */
  meta?: ReactNode
  /** Saved · 23:00, a file count, an exception pill: sits immediately before the actions. */
  status?: ReactNode
  subtitle?: ReactNode
  title: ReactNode
}

const ScreenHeader = ({ actions, children, meta, status, subtitle, title }: Props) => (
  <header className={styles.header}>
    <div className={styles.row}>
      <h1 className={styles.title}>
        {title}
        {/* The space is the accessible name's: "name 0.1.0", not "name0.1.0". */}
        {meta ? <>{' '}<span className={styles.meta}>{meta}</span></> : null}
      </h1>
      {status || actions
        ? (
          <div className={styles.trailing} data-screen-header='trailing'>
            {status}
            {actions}
          </div>
        )
        : null}
    </div>
    {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
    {children}
  </header>
)

export default ScreenHeader
