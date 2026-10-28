/**
 * The claim notice — one line under an assistant reply that said it did something this turn did not
 * do (claimCheck.ts). The reply's own text is rendered above it UNCHANGED: the notice adds the truth,
 * it never edits or hides what the model said, so the person can see both and judge.
 *
 * antd `Alert type='warning'`, like the rail's other notices (useDraftResume's resume banner,
 * DraftProblemsAlert), so it inherits the theme in both modes rather than wearing a hand-built amber.
 * `role='status'`: it is a correction to read, not an interruption to announce.
 *
 * Retry appears only for a claim with NOTHING behind it (isRetryable) and only until pressed once —
 * a refused, failed or declined action already has its answer on the chip above.
 */
import { Alert, Button } from 'antd'

import styles from './AutopilotRail.module.css'
import { claimNotice, isRetryable } from './claimCheck'
import type { AutopilotMessage } from './types'

export const ClaimNotice = ({ disabled, message, onRetry }: { disabled: boolean; message: AutopilotMessage; onRetry: (messageId: string) => void }) => {
  const claims = message.claims ?? []
  if (!claims.length) {
    return null
  }
  const retryable = claims.some(isRetryable) && !message.claimRetried
  return (
    <div className={styles.apClaim} data-testid='autopilot-claim-check'>
      {claims.map((claim) => (
        <Alert
          action={retryable && isRetryable(claim)
            ? <Button disabled={disabled} onClick={() => onRetry(message.id)} size='small'>Retry</Button>
            : undefined}
          key={claim.family}
          role='status'
          showIcon
          title={claimNotice(claim)}
          type='warning'
        />
      ))}
    </div>
  )
}
