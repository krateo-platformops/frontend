import { Button, Result, Typography } from 'antd'
import { Link } from 'react-router'

import styles from './NavigationUnavailable.module.css'
import type { RouteSourceFailure } from './routeSource'

/**
 * The PAGE-level state for a navigation that could not load (approved mockup "When the sidebar menu
 * cannot load", S2–S6). A signed-in page opens only through the menu's routes, so when the menu's read
 * fails this replaces the loading skeleton that never ended. One state per kind of failure, in the
 * same terms as the widget states (WidgetStates):
 *
 *   dependency (424, or 404 before snowplow 1.12.55)  info, snowplow's own words, "Check again"
 *   forbidden (403)                                    info, who can fix it, NO button: asking again changes nothing
 *   timeout (503/504, a deadline)                      calm "still waiting", Retry
 *   error (anything else, or the server unreachable)   error tone, the server's detail, Retry
 *
 * No automatic retry: a person decides. While a retry runs the message stays and only the button shows
 * progress. Profile and Sign out are static routes that never depended on the menu, so every state
 * offers them as the way out.
 */
const COPY: Record<RouteSourceFailure['kind'], { title: string; body: string; action?: string; busy?: string; status: 'info' | 'error' }> = {
  dependency: {
    action: 'Check again',
    body: "Pages open through the sidebar navigation, so this page can't open until it loads. Something the navigation needs is not available on this cluster:",
    busy: 'Checking…',
    status: 'info',
    title: 'The navigation could not load',
  },
  error: {
    action: 'Retry',
    body: "Pages open through the sidebar navigation, so this page can't open until it loads. The server answered with an error; trying again may work.",
    busy: 'Retrying…',
    status: 'error',
    title: 'The navigation failed to load',
  },
  forbidden: {
    body: "Pages open through the sidebar navigation, and your account may not read it. Ask an administrator for access to the portal's navigation.",
    status: 'info',
    title: "The navigation isn't available to you",
  },
  timeout: {
    action: 'Retry',
    body: 'Pages open through the sidebar navigation, and the server is taking longer than expected to send it. This can happen while it warms up or under load.',
    busy: 'Retrying…',
    status: 'info',
    title: 'Still waiting for the navigation',
  },
}

export const NavigationUnavailable = ({ failure, onRetry, retrying }: { failure: RouteSourceFailure; onRetry: () => void; retrying: boolean }) => {
  const copy = COPY[failure.kind]
  // The timeout state says what happened in its body; the others show the server's own words.
  const detail = failure.kind === 'timeout' || failure.kind === 'forbidden' ? undefined : failure.detail
  const reference = ['menus', failure.object, failure.status ? `HTTP ${failure.status}` : undefined].filter(Boolean).join(' · ')
  return (
    <div className={styles.frame} data-testid={`navigation-unavailable-${failure.kind}`}>
      <Result
        extra={(
          <div className={styles.actions}>
            {copy.action ? (
              <Button disabled={retrying} loading={retrying} onClick={onRetry} type='primary'>
                {retrying ? copy.busy : copy.action}
              </Button>
            ) : null}
            <Link to='/profile'>Profile</Link>
            <Link to='/logout'>Sign out</Link>
          </div>
        )}
        status={copy.status}
        subTitle={copy.body}
        title={copy.title}
      >
        {detail ? (
          <div className={failure.kind === 'error' ? `${styles.detail} ${styles.detailError}` : styles.detail}>
            {detail}
          </div>
        ) : null}
        <Typography.Text className={styles.reference}>{reference}</Typography.Text>
      </Result>
    </div>
  )
}

export default NavigationUnavailable
