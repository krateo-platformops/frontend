/**
 * How ONE turn renders in the rail: the message bubble, the evidence disclosure under it
 * (what the agent looked up — never what it read back), and the HITL approval card.
 *
 * Split out of AutopilotRail.tsx, which owns the rail shell (head / body / composer) and
 * the width behaviour. Everything here is presentational and prop-driven; the one piece of
 * I/O is the delegated-evidence fetch a DelegationRow makes when a reader expands it.
 */

import { useEffect, useId, useState } from 'react'
import { CopyToClipboard } from 'react-copy-to-clipboard-ts'
import { default as ReactMarkdown } from 'react-markdown'

import { useConfigContext } from '../../context/ConfigContext'

import { isRefusedChip } from './actionBridge'
import type { ApprovalPause } from './approval'
import styles from './AutopilotRail.module.css'
import { ClaimNotice } from './ClaimNotice'
import { deriveSessionsBase, describeArgs, fetchDelegationEvidence, NO_DELEGATION_SESSION, serializeEvidence, summarizeEvidence } from './evidence'
import { CheckIcon, CopyIcon, EvidenceIcon, RefusedIcon } from './icons'
import { LiveActivity } from './liveActivity'
import { a2aAuthHeader } from './transport'
import type { AutopilotMessage, EvidenceEntry } from './types'

/** What the agent looked up, never what it read back. */
const EvidenceRow = ({ entry }: { entry: EvidenceEntry }) => {
  const { source } = entry
  const meta = source
    ? `${source.org ? `${source.org}/` : ''}${source.repo}${source.ref ? ` @ ${source.ref}` : ''}`
    : describeArgs(entry)
  // Full, uncapped args for the hover title, so a value clamped in the inline display is still
  // fully readable on hover (redaction still applies). Only meaningful for the no-source shape.
  const metaFull = source ? undefined : describeArgs(entry, { full: true })
  return (
    <div className={styles.apEvRow}>
      <span className={styles.apEvTool}>{entry.tool}</span>
      <span className={styles.apEvMeta} title={metaFull && metaFull !== meta ? metaFull : undefined}>
        {meta}{entry.note ? ` · ${entry.note}` : ''}{entry.failed ? ' · failed' : ''}
      </span>
      {source?.path ? (
        <span>
          {entry.url
            ? <a className={styles.apEvLink} href={entry.url} rel='noreferrer' target='_blank'>{source.path}</a>
            : source.path}
        </span>
      ) : null}
    </div>
  )
}

/** Sub-evidence of one delegated hop. `error` carries the REASON, not a boolean (frontend#181) —
 * see evidence.ts, which words each failure. */
type DelegationState = { children?: EvidenceEntry[]; error?: string; loading?: boolean }

/** A delegated hop: the specialist's own calls are not on this stream, so they are resolved from the
 *  session its response named. The fetch is lifted to EvidencePanel (which resolves every delegation
 *  eagerly on open, so Copy captures the nested calls too); this row just renders the shared state. */
const DelegationRow = ({ entry, state }: { entry: EvidenceEntry; state?: DelegationState }) => {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const children = state?.children
  return (
    <div className={styles.apEvGroup}>
      <button aria-controls={panelId} aria-expanded={open} className={styles.apEvRow} onClick={() => setOpen((prev) => !prev)} type='button'>
        <span className={styles.apEvTool}>{open ? '▾' : '▸'} {entry.agent}</span>
        <span className={styles.apEvMeta}>specialist{children ? ` · ${children.length} lookups` : ''}</span>
      </button>
      {open ? (
        <div className={styles.apEvNested} id={panelId}>
          {state?.loading ? <div className={styles.apEvMeta}>loading…</div> : null}
          {state?.error ? <div className={styles.apEvMeta}>couldn&rsquo;t read its activity — {state.error}</div> : null}
          {children?.length === 0 ? <div className={styles.apEvMeta}>no tool calls recorded</div> : null}
          {children?.map((child) => <EvidenceRow entry={child} key={child.id} />)}
        </div>
      ) : null}
    </div>
  )
}

/** The tool calls behind an answer, so it can be checked rather than trusted. A turn that used no
 *  tools says so. */
const EvidencePanel = ({ evidence }: { evidence: EvidenceEntry[] }) => {
  const { config } = useConfigContext()
  const panelId = useId()
  const [open, setOpen] = useState(false)
  // Copied-feedback flash. `react-copy-to-clipboard-ts` uses document.execCommand under the hood, so
  // it works over plain HTTP — unlike navigator.clipboard, which is undefined in a non-secure context
  // (the portal is often served over http://<LB-IP>).
  const [copied, setCopied] = useState(false)
  // Every delegation's sub-evidence, keyed by sessionId. Resolved EAGERLY when the panel opens (not
  // per-row on expand) so the Copy button captures the specialists' nested tool calls, not just the
  // top level — the reported bug. DelegationRow renders from this shared map (no per-row refetch),
  // and serializeEvidence nests it under each specialist line.
  const [delegations, setDelegations] = useState<Record<string, DelegationState>>({})
  const base = config?.api.AUTOPILOT_API_BASE_URL
  useEffect(() => {
    if (!open || !base) {
      return
    }
    const pending = evidence.filter((entry) => entry.agent && entry.sessionId && !delegations[entry.sessionId])
    if (!pending.length) {
      return
    }
    // Seed each pending session as in-flight in one update so the filter above stays idempotent on
    // the effect's re-run (it depends on `delegations`), then resolve each once.
    setDelegations((prev) => {
      const next = { ...prev }
      for (const entry of pending) {
        next[entry.sessionId as string] = { loading: true }
      }
      return next
    })
    for (const entry of pending) {
      const sid = entry.sessionId as string
      fetchDelegationEvidence(deriveSessionsBase(base), entry, a2aAuthHeader())
        .then((children) => setDelegations((prev) => ({ ...prev, [sid]: { children } })))
        .catch((err: unknown) => setDelegations((prev) => ({ ...prev, [sid]: { error: err instanceof Error ? err.message : String(err) } })))
    }
  }, [open, base, evidence, delegations])
  // The resolved children only (loading/error hops fall back to their bare specialist line in copy).
  const childrenBySession = Object.fromEntries(
    Object.entries(delegations).flatMap(([sid, state]) => (state.children ? [[sid, state.children]] : [])),
  )
  return (
    <>
      <button aria-controls={panelId} aria-expanded={open} className={styles.apEvBtn} onClick={() => setOpen((prev) => !prev)} type='button'>
        <EvidenceIcon />
        Evidence{evidence.length ? ` · ${evidence.length}` : ''}
      </button>
      {open ? (
        <div className={styles.apEv} data-testid='autopilot-evidence' id={panelId}>
          <div className={styles.apEvHead}>
            <span>{summarizeEvidence(evidence)}</span>
            <CopyToClipboard
              onCopy={() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              text={serializeEvidence(evidence, childrenBySession)}
            >
              <button aria-label='Copy evidence to clipboard' className={styles.apEvCopy} title='Copy evidence to clipboard' type='button'>
                {copied ? <CheckIcon size={11} /> : <CopyIcon />}{copied ? 'Copied' : 'Copy'}
              </button>
            </CopyToClipboard>
          </div>
          {evidence.map((entry) => (entry.agent
            ? <DelegationRow entry={entry} key={entry.id} state={entry.sessionId ? delegations[entry.sessionId] : { error: NO_DELEGATION_SESSION }} />
            : <EvidenceRow entry={entry} key={entry.id} />))}
        </div>
      ) : null}
    </>
  )
}

export const MessageBubble = ({ message, onRetryClaims, streaming }: { message: AutopilotMessage; onRetryClaims: (messageId: string) => void; streaming: boolean }) => {
  if (message.role === 'user') {
    return <div className={`${styles.apMsg} ${styles.apMsgUser}`}>{message.text}</div>
  }
  return (
    <div className={`${styles.apMsg} ${styles.apMsgBot}`}>
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
      {message.streaming ? <LiveActivity answering={message.text.length > 0} evidence={message.evidence ?? []} /> : null}
      {message.evidence && !message.streaming ? <EvidencePanel evidence={message.evidence} /> : null}
    </div>
  )
}

/**
 * The kagent HITL approval card (Phase 2) — the calm decision surface for a paused
 * `requireApproval` tool call. BlastRadiusConfirm's language: an amber APPROVAL chip,
 * the tool + owning agent as plain facts, the arguments (the manifest, for
 * k8s_apply_manifest) as a mono block the human actually reads, then Approve (amber) /
 * Deny. DENY-BY-DEFAULT: dismissing the card denies, and an unattended card self-denies
 * after 5 minutes (the provider's governor).
 */
export const ApprovalCard = ({ onApprove, onDeny, pause }: { onApprove: () => void; onDeny: () => void; pause: ApprovalPause }) => (
  <div className={styles.apApproval} data-testid='autopilot-approval'>
    <div className={styles.apApprovalHead}>
      <span className={styles.apApprovalChip}>approval</span>
      <span className={styles.apApprovalIntent}>the agent wants to run a write tool</span>
      <span className={styles.apSpacer} />
      <button aria-label='Dismiss (denies)' className={styles.apIc} onClick={onDeny} title='Dismiss (denies)' type='button'>×</button>
    </div>
    {pause.requests.map((request) => (
      <div className={styles.apApprovalReq} key={request.requestId}>
        <div className={styles.apApprovalTool}>
          <span className={styles.apApprovalToolName}>{request.toolName}</span>
          {request.agentName ? <span className={styles.apApprovalAgent}>{request.agentName}</span> : null}
        </div>
        <pre className={styles.apApprovalCode}>{request.argumentsPreview}</pre>
      </div>
    ))}
    <div className={styles.apApprovalBtns}>
      <button className={styles.apBtnApprove} onClick={onApprove} type='button'>Approve</button>
      <button className={styles.apBtnDeny} onClick={onDeny} type='button'>Deny</button>
    </div>
    <div className={styles.apApprovalNote}>Deny is the default — dismissing, starting a new thread, or waiting 5 minutes denies.</div>
  </div>
)
