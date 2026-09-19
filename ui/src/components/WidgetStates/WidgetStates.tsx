import { Button, Empty, Result, Skeleton } from 'antd'
import type { ReactNode } from 'react'

import styles from './WidgetStates.module.css'

/** Shared loading state for a widget (skeleton). */
export const WidgetLoading = () => (
  <div className={styles.loading} data-widget-renderer>
    <Skeleton active />
  </div>
)

/**
 * Shared empty state for list/data widgets — and for a page with nothing in it yet (C14).
 *
 * `children` is the ACTION slot, and it is why this now covers more than widgets. An empty state
 * that can only describe a void sends the reader away to find the thing that fills it; the one
 * place a "start something" control belongs is inside the emptiness it resolves. Without the slot,
 * a surface needing that control had to hand-roll its own `<Empty>` — which is exactly the drift
 * C14 exists to prevent, and the Page Composer had already drifted that way.
 *
 * Optional, so every existing caller is unchanged and renders the same markup as before.
 */
export const WidgetEmpty = ({ children, description }: { children?: ReactNode; description?: ReactNode }) => (
  <div className={styles.empty}>
    <Empty description={description} image={Empty.PRESENTED_IMAGE_SIMPLE}>
      {children}
    </Empty>
  </div>
)

/** Shared error state for a widget. Optional `children` render extra detail; `onRetry` adds a Retry button. */
export const WidgetError = ({ children, onRetry, subtitle }: { children?: ReactNode; onRetry?: () => void; subtitle: string }) => (
  <div className={styles.message} data-testid='widget-error'>
    <Result
      extra={onRetry ? <Button onClick={onRetry} type='primary'>Retry</Button> : undefined}
      status='error'
      subTitle={subtitle}
      title='Error while rendering widget'
    >
      {children}
    </Result>
  </div>
)

/**
 * Distinct, CALM timeout state — the server is reachable but slow / still working
 * (a request deadline, a cancelled fetch, or a 503/504 gateway timeout), as opposed
 * to a hard render error (`WidgetError`, red cross). Copy is reassuring, not alarming,
 * and offers a Retry. Rendered by WidgetRenderer when `isTimeoutError` classifies the
 * failure as transient-slow rather than a genuine error.
 */
export const WidgetTimeout = ({ onRetry, subtitle }: { onRetry?: () => void; subtitle?: string }) => (
  <div className={styles.timeout} data-testid='widget-timeout'>
    <Result
      extra={onRetry ? <Button onClick={onRetry} type='primary'>Retry</Button> : undefined}
      status='info'
      subTitle={subtitle ?? 'The server is taking longer than expected. This can happen while it warms up or under load.'}
      title='Still waiting on the server'
    />
  </div>
)

/**
 * Distinct, CALM permission state — the server answered, and the answer was "no".
 *
 * A 403 is not a malfunction: the platform scopes reads per user by design, so "you may not see
 * this" is a legitimate, expected outcome that a red error cross actively misdescribes. Before
 * this, every non-401 failure collapsed into `WidgetError` and a denial was indistinguishable
 * from a 500 except by an HTTP status buried in a free-text sentence.
 *
 * No Retry: retrying a denial changes nothing, and offering it implies the failure is transient.
 */
export const WidgetForbidden = ({ subtitle }: { subtitle?: string }) => (
  <div className={styles.timeout} data-testid='widget-forbidden'>
    <Result
      status='info'
      subTitle={subtitle ?? 'Your account does not have permission to read this. Ask an administrator if you need access.'}
      title='Not available to you'
    />
  </div>
)

/**
 * Distinct NOT-FOUND state. The server answered and the object is not there — a deleted
 * composition, a stale link, a renamed resource. Also not a malfunction, and also not retryable.
 */
export const WidgetNotFound = ({ subtitle }: { subtitle?: string }) => (
  <div className={styles.timeout} data-testid='widget-notfound'>
    <Result
      status='info'
      subTitle={subtitle ?? 'This resource no longer exists, or it was never here.'}
      title='Not found'
    />
  </div>
)

/**
 * Classify a fetch failure as a TIMEOUT (calm, retryable) vs a hard error. True for
 * request deadlines, cancelled/aborted fetches, and 503/504 gateway timeouts —
 * detected from the HTTP status when present, otherwise from the message class. Pure
 * so it can be unit-tested and reused by WidgetRenderer.
 */
export const isTimeoutError = (error: unknown): boolean => {
  const status = (error as { status?: number } | null)?.status
  if (status === 503 || status === 504) { return true }

  let rawMessage = ''
  if (error instanceof Error) {
    rawMessage = error.message
  } else if (typeof error === 'string') {
    rawMessage = error
  }
  const message = rawMessage.toLowerCase()
  if (!message) { return false }

  return (
    message.includes('deadline')
    || message.includes('timeout')
    || message.includes('timed out')
    || message.includes('canceled')
    || message.includes('cancelled')
    || message.includes('aborted')
    || message.includes('503')
    || message.includes('504')
  )
}
