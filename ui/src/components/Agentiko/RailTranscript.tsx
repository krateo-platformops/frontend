/**
 * How ONE turn renders in the rail: the message bubble, and above an assistant answer its run
 * timeline (RunTimeline.tsx) — what the agent did, live and after, including a kagent HITL approval
 * as a step of the turn that asked for it.
 *
 * Split out of AgentikoRail.tsx, which owns the rail shell (head / body / composer) and
 * the width behaviour. Everything here is presentational and prop-driven.
 */

import { default as ReactMarkdown } from 'react-markdown'

import { isRefusedChip } from './actionBridge'
import styles from './AgentikoRail.module.css'
import { ClaimNotice } from './ClaimNotice'
import { CheckIcon, RefusedIcon } from './icons'
import type { RunApproval } from './RunTimeline'
import { RunTimeline } from './RunTimeline'
import type { AgentikoMessage } from './types'

export interface MessageBubbleProps {
  message: AgentikoMessage
  onRetryClaims: (messageId: string) => void
  streaming: boolean
  /** The pending approval, on the one turn that paused for it. */
  approval?: RunApproval
  /** The decision recorded after this turn's approval, if it paused for one earlier. */
  approvalOutcome?: string
  /** Stop this turn and ask its question again (the run timeline's stall state). */
  onAskAgain?: () => void
}

export const MessageBubble = ({ approval, approvalOutcome, message, onAskAgain, onRetryClaims, streaming }: MessageBubbleProps) => {
  if (message.role === 'user') {
    return <div className={`${styles.apMsg} ${styles.apMsgUser}`}>{message.text}</div>
  }
  const hasRun = Boolean(message.streaming || message.evidence || message.approvalAt)
  return (
    <div className={`${styles.apMsg} ${styles.apMsgBot} ${hasRun ? styles.apMsgBotRun : ''}`}>
      {/* The work leads into the answer: one card above it, folded once the answer has landed. */}
      {hasRun ? <RunTimeline approval={approval} approvalOutcome={approvalOutcome} message={message} onAskAgain={onAskAgain} /> : null}
      {/* Render the assistant's markdown properly (bold / lists / headings / inline code). The old
          renderInline only handled `code` spans, so everything else (**bold**, `-` lists, `##`) showed
          as RAW markdown characters. react-markdown emits NO raw HTML by default, and sanitizeChatText
          has already stripped any code/YAML blocks the agent shouldn't show. */}
      <div className={styles.apMd}><ReactMarkdown>{message.text}</ReactMarkdown></div>
      {message.actions?.map((action, index) => (
        <div className={styles.apAct} data-outcome={isRefusedChip(action) ? 'refused' : 'applied'} key={`act-${index}`}>
          {/* A refusal never wears the applied check: it would read as success when nothing ran. */}
          {isRefusedChip(action)
            ? <RefusedIcon className={styles.apActRefused} />
            : <CheckIcon className={styles.apActCheck} />}
          {action.url
            ? <a className={`${styles.apEvLink} ${styles.apActLabel}`} href={action.url} rel='noreferrer' target='_blank'>{action.label}</a>
            : <span className={styles.apActLabel}>{action.label}</span>}
          {action.readOnly ? <span className={styles.apActRo}>read-only</span> : null}
        </div>
      ))}
      <ClaimNotice disabled={streaming} message={message} onRetry={onRetryClaims} />
    </div>
  )
}
