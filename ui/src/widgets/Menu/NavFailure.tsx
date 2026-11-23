/**
 * A sidebar entry snowplow could not CHECK (frontend#533, approved mockup
 * https://claude.ai/artifact/VXLAUaQyVuVW7BPCVnRpQp). It is not a denial, so it is never hidden: the
 * entry stays, keeps its link, and carries a mark. The page's own read still decides.
 *
 *   amber  it can pass on a retry (the cluster did not answer) or after signing in again
 *   red    it cannot: the type is not installed, the apiVersion is invalid, the lookup was refused
 *
 * The explanation is snowplow's message, verbatim. It is in the row's text for a screen reader, in a
 * tooltip beside the row on hover and focus, and in antd's own tooltip in the collapsed icon rail.
 * When NO entry was checked, one notice speaks for all of them instead of a mark on each.
 */
import { ExclamationCircleOutlined, LoginOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons'
import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button, Tooltip } from 'antd'
import { useContext } from 'react'

import { failureKind } from '../../components/RefChild/FailedPart'
import { ParentRefetchContext } from '../../context/ParentRefetchContext'
import { useWidgetTransport } from '../../transport/widgetTransport'
import type { RefFailure } from '../../types/Widget'

import styles from './NavFailure.module.css'

const toneOf = (failure: RefFailure) => (failureKind(failure) === 'permanent' ? 'broken' : 'unchecked')

const Mark = ({ failure }: { failure: RefFailure }) => (
  <span aria-hidden className={`${styles.mark} ${styles[toneOf(failure)]}`} data-nav-failure={toneOf(failure)}>
    {toneOf(failure) === 'broken' ? <ExclamationCircleOutlined /> : <WarningOutlined />}
  </span>
)

/** What follows the entry's name: the state, then snowplow's own message. */
const Explanation = ({ failure }: { failure: RefFailure }) => (
  <>
    {': access could not be checked. '}
    <br />
    {failure.message || 'This page could not be looked up.'}
  </>
)

/** The entry's icon, with a dot in the collapsed icon rail, where the row's mark has no room. */
export const FailedNavIcon = ({ className, failure, iconName }: { className?: string; failure: RefFailure; iconName?: string }) => (
  <span className={`${className ?? ''} ${styles.icon}`} data-tone={toneOf(failure)}>
    {iconName
      ? <FontAwesomeIcon className={styles.glyph} icon={iconName as IconProp} />
      : <Mark failure={failure} />}
  </span>
)

export const FailedNavLabel = ({ failure, label, open }: { failure: RefFailure; label: string; open: boolean }) => (
  <Tooltip open={open} placement='right' title={<>{label}<Explanation failure={failure} /></>}>
    <span className={styles.label}>
      <span className={styles.name}>{label}</span>
      <Mark failure={failure} />
      <span className={styles.why}>
        <Explanation failure={failure} />
      </span>
    </span>
  </Tooltip>
)

const NOTICE = 'Couldn’t check which pages you can open. Some may be refused.'

/**
 * Nothing in the sidebar was checked: every entry is listed and this says so once. `failures` is empty
 * when snowplow returned no refs at all. Try again re-reads the menu, and is offered only when a retry
 * can change the answer; a credential snowplow refused is offered Sign in again instead.
 */
export const NavUncheckedNotice = ({ failures }: { failures: readonly RefFailure[] }) => {
  const refetch = useContext(ParentRefetchContext)
  const { session } = useWidgetTransport()
  const kinds = failures.map(failureKind)
  const canRetry = !!refetch && (kinds.length === 0 || kinds.includes('transient'))
  const canSignIn = !canRetry && !!session && kinds.includes('signin')
  const signInAgain = async () => {
    if (await session?.resume() === 'resumed') { refetch?.() }
  }
  return (
    <div className={styles.notice} data-testid='nav-unchecked' role='status'>
      <Tooltip placement='right' title={NOTICE}>
        <WarningOutlined aria-hidden className={`${styles.noticeIcon} ${styles.unchecked}`} />
      </Tooltip>
      <span className={styles.noticeText}>{NOTICE}</span>
      {canRetry && <Button aria-label='Try again' className={styles.noticeAction} icon={<ReloadOutlined />} onClick={() => { refetch() }} size='small'><span className={styles.noticeText}>Try again</span></Button>}
      {canSignIn && <Button aria-label='Sign in again' className={styles.noticeAction} icon={<LoginOutlined />} onClick={() => { void signInAgain() }} size='small'><span className={styles.noticeText}>Sign in again</span></Button>}
    </div>
  )
}
