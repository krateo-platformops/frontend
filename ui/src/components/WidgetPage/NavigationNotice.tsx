import styles from './NavigationNotice.module.css'
import type { RouteSourceFailure } from './routeSource'

/**
 * The SIDER's line for a navigation that could not load (approved mockup, S2–S5). The sider is a
 * narrow column on a black ground: the full widget error card (a 72px icon, a title, a button) does
 * not fit there and repeats what the page area now says in full (NavigationUnavailable). One muted
 * line names the state; the page beside it explains and offers the way out.
 */
const LINE: Record<RouteSourceFailure['kind'], string> = {
  dependency: 'Navigation unavailable',
  error: 'Navigation failed to load',
  forbidden: 'Navigation not available to you',
  timeout: 'Navigation still loading',
}

const ICON: Record<RouteSourceFailure['kind'], string> = {
  dependency: 'M12 8v5M12 16.5v.5',
  error: 'M9 9l6 6M15 9l-6 6',
  forbidden: 'M12 8v5M12 16.5v.5',
  timeout: 'M12 7v5l3 2',
}

export const NavigationNotice = ({ failure }: { failure: RouteSourceFailure }) => (
  <div className={styles.notice} data-testid={`navigation-notice-${failure.kind}`} role='status'>
    <svg aria-hidden='true' className={failure.kind === 'error' ? `${styles.icon} ${styles.iconError}` : styles.icon} fill='none' height='16' strokeLinecap='round' strokeWidth='2' viewBox='0 0 24 24' width='16'>
      <circle cx='12' cy='12' r='9' />
      <path d={ICON[failure.kind]} />
    </svg>
    <span>{LINE[failure.kind]}</span>
  </div>
)

export default NavigationNotice
