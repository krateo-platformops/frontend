/**
 * A PART SNOWPLOW COULD NOT LOAD, SHOWN IN ITS OWN SLOT (approved mockup
 * https://claude.ai/artifact/1yZY3r6QkbzfD78XjdyhTq).
 *
 * snowplow >= 1.12.75 reports a referenced part it could not load as `allowed: false` WITH an `error`
 * (a k8s-style Status), where earlier it vanished. Hiding it like a permission denial left a hole the
 * reader could not tell from an empty slot. A plain denial (no `error`) is NOT shown: a denial reads as
 * absence (X2). Two treatments:
 *   transient  the cluster did not answer (discovery failed): the message and Try again
 *   permanent  the type is not installed, or the apiVersion is invalid: the message and who can fix
 *              it, and no retry, which could not succeed
 * The message is snowplow's, verbatim: built from the ref's coordinates only.
 */
import { ExclamationCircleOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons'
import { Button, Tooltip, Typography } from 'antd'
import { useContext } from 'react'

import { ParentRefetchContext } from '../../context/ParentRefetchContext'
import type { RefFailure } from '../../types/Widget'

import styles from './FailedPart.module.css'

export type FailureKind = 'permanent' | 'transient'

const PERMANENT_CAUSES = new Set(['APIVersionInvalid', 'TypeNotInstalled'])

/**
 * Which treatment a failure gets, keyed on snowplow's structured cause, never its message text (not a
 * contract). A missing type or an invalid apiVersion cannot be fixed by retrying; a cluster that did not
 * answer can. snowplow 1.12.75 names only TypeNotInstalled (424); an invalid apiVersion and a discovery
 * that failed without a code are both a bare 500 with no cause, so a bare 500 is TRANSIENT (a retry is
 * harmless) until snowplow #1576 adds APIVersionInvalid / DiscoveryFailed to every class.
 */
export const failureKind = (failure: RefFailure): FailureKind => {
  const causes = failure.details?.causes ?? []
  if (failure.code === 424 || causes.some((cause) => cause.reason && PERMANENT_CAUSES.has(cause.reason))) { return 'permanent' }
  return 'transient'
}

/** Who can act on a permanent failure, in the reader's words. */
const whoFixes = (failure: RefFailure): string =>
  (failure.code === 424 || failure.details?.causes?.some((cause) => cause.reason === 'TypeNotInstalled')
    ? 'ask a platform admin to install it'
    : 'the page\'s author can fix it')

const FailedPart = ({ density = 'block', failure, title }: { density?: 'block' | 'inline'; failure: RefFailure; title?: string }) => {
  const refetch = useContext(ParentRefetchContext)
  const kind = failureKind(failure)
  const message = failure.message || 'This part could not be loaded.'

  if (density === 'inline') {
    return (
      <Tooltip title={message}>
        <Typography.Text data-failed-part={kind} type={kind === 'permanent' ? 'danger' : 'warning'}>
          {kind === 'permanent' ? <ExclamationCircleOutlined /> : <WarningOutlined />}
        </Typography.Text>
      </Tooltip>
    )
  }

  return (
    <div className={styles.failedPart} data-failed-part={kind} role='status'>
      <Typography.Text className={styles.head} strong type={kind === 'permanent' ? 'danger' : 'warning'}>
        {kind === 'permanent' ? <ExclamationCircleOutlined /> : <WarningOutlined />}
        {' '}
        {title ?? 'Couldn\u2019t load this part'}
      </Typography.Text>
      <Typography.Text type='secondary'>{message}</Typography.Text>
      {kind === 'permanent'
        ? <Typography.Text className={styles.facts} type='secondary'>{[failure.code, whoFixes(failure)].filter(Boolean).join(' · ')}</Typography.Text>
        : refetch && <Button icon={<ReloadOutlined />} onClick={() => { refetch() }} size='small'>Try again</Button>}
    </div>
  )
}

export default FailedPart
