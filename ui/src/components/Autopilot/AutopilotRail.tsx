/**
 * The docked Autopilot rail (component 1/3/7/8/10/11). Read-only Q&A MVP:
 *   head    — spark+title, live/idle pill, new-thread, collapse
 *   body    — context strip (what it SEES), transcript, per-turn suggestions
 *   composer— textarea + send + the drive-via-real-controls trust note
 *
 * Renders nothing unless Autopilot is `enabled`. The width animates 0 → 384 so the
 * shell reflows (it never overlays); toggling session history (`.apMain`'s
 * `HistoryColumn`) widens it further, 384 → 640, to dock the thread list beside the
 * transcript instead of covering it. All driving/HITL surfaces are Phase 2/3.
 */

import { useEffect, useId, useRef, useState } from 'react'
import type { ClipboardEvent, KeyboardEvent } from 'react'
import { CopyToClipboard } from 'react-copy-to-clipboard-ts'
import { default as ReactMarkdown } from 'react-markdown'

import { useConfigContext } from '../../context/ConfigContext'

import type { ApprovalPause } from './approval'
import { useAutopilot } from './AutopilotProvider'
import styles from './AutopilotRail.module.css'
import AutopilotTour from './AutopilotTour'
import { describeArgs, deriveSessionsBase, fetchDelegationEvidence, serializeEvidence, summarizeEvidence } from './evidence'
import { CheckIcon, CollapseIcon, CopyIcon, EvidenceIcon, EyeIcon, HistoryIcon, LinkIcon, PlusIcon, SendIcon, SparkIcon, StopIcon } from './icons'
import { looksLikeOpenApiDocument } from './oasAttachment'
import { relativeTime, type ThreadSummary } from './sessionHistoryStore'
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

/** The lazily-resolved sub-evidence of one delegated hop, keyed by the specialist's session. */
type DelegationState = { children?: EvidenceEntry[]; error?: boolean; loading?: boolean }

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
          {state?.error ? <div className={styles.apEvMeta}>its activity is not readable from here</div> : null}
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
        .catch(() => setDelegations((prev) => ({ ...prev, [sid]: { error: true } })))
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
            ? <DelegationRow entry={entry} key={entry.id} state={entry.sessionId ? delegations[entry.sessionId] : undefined} />
            : <EvidenceRow entry={entry} key={entry.id} />))}
        </div>
      ) : null}
    </>
  )
}

const MessageBubble = ({ message }: { message: AutopilotMessage }) => {
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
      {message.streaming ? <span className={styles.apCaret} /> : null}
      {message.actions?.map((action, index) => (
        <div className={styles.apAct} key={`act-${index}`}>
          <CheckIcon className={styles.apActCheck} />
          {action.url
            ? <a className={styles.apEvLink} href={action.url} rel='noreferrer' target='_blank'>{action.label}</a>
            : <span>{action.label}</span>}
          {action.readOnly ? <span className={styles.apActRo}>read-only</span> : null}
        </div>
      ))}
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
const ApprovalCard = ({ onApprove, onDeny, pause }: { onApprove: () => void; onDeny: () => void; pause: ApprovalPause }) => (
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

// Curated starter prompts shown in the empty rail (before turn 1), so a zero-knowledge user
// has an obvious first move instead of a blank box. These are universal conversation openers —
// the model answers each grounded on the live page context. Deliberately generic (not data), so
// they're valid on any route; per-turn suggestions (from the model) take over after the first reply.
const STARTER_PROMPTS = [
  'Show me around',
  'How do I create my first resource?',
  "What's on this page?",
]

/**
 * Session history (Vincenzo item P, split-view iteration). A persistent column docked beside
 * the transcript — NOT a popover — so past threads stay browsable while the live conversation
 * remains visible.
 *
 * ALWAYS mounted (same convention as the rail itself, which never unmounts and instead
 * animates `.apRail`'s width 0→384): `open` drives a width-only CSS transition, 0→220,
 * in sync with the rail's own 384→640 `.split` transition (same duration/easing). Mounting it
 * only on `historyOpen` used to make it pop in at its full 220px width WHILE the rail was still
 * narrow — an instant hard squeeze of the transcript before the rail's own width caught up a
 * moment later. Animating both widths together keeps the transcript's width monotonic (it only
 * grows when opening, only shrinks when closing) instead of squeeze-then-grow.
 *
 * Re-reads the archive when it opens, and again whenever the active thread changes (a switch or
 * a new thread both change `currentSessionId`) — keeping the list in sync without a live
 * localStorage subscription. `aria-hidden` while closed, matching its zero width.
 */
const HistoryColumn = ({ currentSessionId, onSwitch, open, sessions }: {
  currentSessionId: string
  onSwitch: (sessionId: string) => void
  open: boolean
  sessions: () => ThreadSummary[]
}) => {
  const [rows, setRows] = useState<ThreadSummary[]>([])

  useEffect(() => {
    if (open) {
      setRows(sessions())
    }
  }, [sessions, currentSessionId, open])

  return (
    <div aria-hidden={!open} className={`${styles.apHistoryCol} ${open ? styles.apHistoryColOpen : ''}`} data-testid='autopilot-history-panel'>
      <div className={styles.apHistoryHead}>Conversations</div>
      <div className={styles.apHistoryList}>
        {rows.length === 0 ? (
          <div className={styles.apHistoryEmpty}>No past conversations yet. Your threads are saved here when you start a new one.</div>
        ) : (
          rows.map((row) => (
            <button
              className={`${styles.apHistoryRow} ${row.sessionId === currentSessionId ? styles.apHistoryRowActive : ''}`}
              key={row.sessionId}
              onClick={() => onSwitch(row.sessionId)}
              type='button'
            >
              <span className={styles.apHistoryTitle}>{row.title}</span>
              <span className={styles.apHistoryMeta}>{relativeTime(row.updatedAt)} · {row.messageCount} msg{row.messageCount === 1 ? '' : 's'}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

const AutopilotRail = () => {
  const { approvePending, attachOasDocument, clearOasAttachment, collect, denyPending, enabled, messages, newThread, oasAttachment, open, pendingApproval, restored, send, sessionId, sessions, setOpen, stop, streaming, switchToThread } = useAutopilot()
  const [draft, setDraft] = useState('')
  // Session history (Vincenzo item P, split-view iteration): widens the rail to dock a thread
  // list beside the transcript (see .apRail.split). Local to the rail — not lifted into the
  // provider — because this component is also the SOLE owner of the `--autopilot-rail-width`
  // CSS var below (body-portalled overlays like the Filters Drawer inset off it); keeping both
  // in one place avoids two effects racing to set the same DOM property.
  const [historyOpen, setHistoryOpen] = useState(false)
  // W4 KOG (FE-K2): the over-cap paste rejection note (cleared on the next successful attach).
  const [oasError, setOasError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // Auto-scroll the transcript to the latest content as it streams — but only when the user is
  // already near the bottom, so scrolling up to re-read a long reply isn't yanked back down. Each
  // streamed chunk produces a NEW `messages` array (immutable update in the provider), so this
  // effect fires per token; the ref is updated by the body's onScroll handler below.
  const stickToBottomRef = useRef(true)
  useEffect(() => {
    const el = bodyRef.current
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, streaming, pendingApproval])

  // Publish the rail's actual width as a :root CSS var so body-portalled overlays (the
  // Filters Drawer) can inset their right edge and never sit over the rail — 0 when
  // closed/disabled, 384px open, 640px when the history split view widens it further.
  // Kept in sync with `.apRail.open` / `.apRail.open.split` in AutopilotRail.module.css.
  useEffect(() => {
    const openWidth = enabled && open ? '384px' : '0px'
    const width = enabled && open && historyOpen ? '640px' : openWidth
    document.documentElement.style.setProperty('--autopilot-rail-width', width)
    return () => { document.documentElement.style.setProperty('--autopilot-rail-width', '0px') }
  }, [enabled, open, historyOpen])

  if (!enabled) {
    return null
  }

  // Live page-context snapshot for the "seeing …" strip (real cache, not memory).
  // Cheap (a synchronous map over the widget cache); recomputed each render so it
  // tracks navigation and new turns without a stale memo.
  const context = open ? collect() : null

  const submit = () => {
    const text = draft.trim()
    if (!text || streaming) {
      return
    }
    send(text)
    setDraft('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  // W4 KOG (FE-K2): capture a pasted OpenAPI document as a HELD attachment. The paste
  // still lands in the textarea (the model reads the doc in-context ONCE to propose the
  // mapping) — but the held copy is what publish substitutes for {"$oasAttachment":true},
  // so the document bytes go user → cluster verbatim, never model-reproduced. Over the
  // 512 KiB cap nothing is held and the note tells the user to host it (URL path).
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text/plain')
    if (!looksLikeOpenApiDocument(text)) {
      return
    }
    const result = attachOasDocument(text)
    setOasError(result.ok ? null : result.error)
  }

  // Pin/unpin auto-scroll: "stuck" while within ~80px of the bottom, released once the user scrolls up.
  const onBodyScroll = () => {
    const el = bodyRef.current
    if (el) {
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
  }

  const ctxStatus = context?.extras?.status
  const lastSuggestions = messages.length ? messages[messages.length - 1].suggestions : undefined

  return (
    <aside className={`${styles.apRail} ${open ? styles.open : ''} ${open && historyOpen ? styles.split : ''}`}>
      <div className={styles.apRailInner}>
        <div className={styles.apHead}>
          <span className={styles.apTitle}><SparkIcon className={styles.apSpark} />Autopilot</span>
          <span className={`${styles.apLive} ${streaming ? '' : styles.idle}`}>
            <span className={styles.apLiveDot} />{streaming ? 'streaming' : 'live'}
          </span>
          <span className={styles.apSpacer} />
          <button
            aria-label='Conversation history'
            aria-pressed={historyOpen}
            className={`${styles.apIc} ${historyOpen ? styles.apIcActive : ''}`}
            data-testid='autopilot-history-toggle'
            onClick={() => setHistoryOpen((prev) => !prev)}
            title='Conversation history'
            type='button'
          >
            <HistoryIcon />
          </button>
          <button aria-label='New thread' className={styles.apIc} onClick={newThread} title='New thread' type='button'>
            <PlusIcon />
          </button>
          <button aria-label='Collapse rail' className={styles.apIc} onClick={() => setOpen(false)} title='Collapse rail' type='button'>
            <CollapseIcon />
          </button>
        </div>

        <div className={styles.apMain}>
          <HistoryColumn currentSessionId={sessionId} onSwitch={switchToThread} open={historyOpen} sessions={sessions} />
          {/* The chat column: transcript + composer share this width, so the composer never
              spans under the history column when the split view is open. */}
          <div className={styles.apChatCol}>
            <div className={styles.apBody} onScroll={onBodyScroll} ref={bodyRef}>
              {restored ? (
                <div className={styles.apRestored} data-testid='autopilot-restored-hint'>
                  Viewing a past conversation. You can read it here; sending a new message continues in a fresh session.
                </div>
              ) : null}
              {context ? (
                <div className={styles.apCtx}>
                  <EyeIcon className={styles.apCtxIcon} />
                  seeing&nbsp;·&nbsp;<b>{context.focus}</b>&nbsp;· {context.widgets.length} widgets
                  {ctxStatus ? <>&nbsp;· {ctxStatus}</> : null}
                  {context.identity?.username ? <>&nbsp;· {context.identity.username}</> : null}
                </div>
              ) : null}

              {messages.length === 0 ? (
                <div className={styles.apEmpty}>
                  <div className={styles.apEmptyTitle}>Ask Autopilot</div>
                  It can see what&apos;s on your screen and answer questions about your
                  compositions, blueprints, and platform — grounded on the live page.
                  <div className={styles.apSuggest}>
                    {STARTER_PROMPTS.map((prompt, index) => (
                      <button className={styles.apSg} key={`starter-${index}`} onClick={() => send(prompt)} type='button'>
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((message) => <MessageBubble key={message.id} message={message} />)
              )}

              {pendingApproval ? (
                <ApprovalCard onApprove={approvePending} onDeny={denyPending} pause={pendingApproval} />
              ) : null}

              {lastSuggestions?.length ? (
                <div className={styles.apSuggest}>
                  {lastSuggestions.map((suggestion, index) => (
                    <button className={styles.apSg} key={`sg-${index}`} onClick={() => send(suggestion)} type='button'>
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className={styles.apComposer}>
              {oasAttachment ? (
                <div className={styles.apOas} data-testid='autopilot-oas-attachment'>
                  <span>OpenAPI attached · {Math.max(1, Math.ceil(oasAttachment.bytes / 1024))} KiB — held in the portal, substituted at publish</span>
                  <button
                    aria-label='Remove the OpenAPI attachment'
                    className={styles.apIc}
                    onClick={() => {
                      clearOasAttachment()
                      setOasError(null)
                    }}
                    title='Remove the OpenAPI attachment'
                    type='button'
                  >×</button>
                </div>
              ) : null}
              {oasError ? <div className={styles.apOasError}>{oasError}</div> : null}
              <div className={styles.apInput}>
                <textarea
                  className={styles.apTextarea}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onKeyDown}
                  onPaste={onPaste}
                  placeholder='Ask Autopilot to do something…'
                  rows={1}
                  value={draft}
                />
                {streaming ? (
                  <button aria-label='Stop' className={styles.apSend} onClick={stop} title='Stop generating' type='button'>
                    <StopIcon />
                  </button>
                ) : (
                  <button aria-label='Send' className={styles.apSend} disabled={!draft.trim()} onClick={submit} type='button'>
                    <SendIcon />
                  </button>
                )}
              </div>
              <div className={styles.apNote}>
                <LinkIcon className={styles.apNoteIcon} />
                Autopilot drives the portal — it never bypasses the UI. Docked &amp; collapsible, not an overlay.
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

export default AutopilotRail

/**
 * Reflow container: wraps the app shell so the rail docks side-by-side. When the
 * rail opens, its width animates 0 → 384 and the main column (`flex:1`) shrinks —
 * the page reflows rather than being overlaid. With Autopilot disabled the rail
 * renders null and main takes the full width.
 */
export const AutopilotShell = ({ children }: { children: React.ReactNode }) => (
  <div className={styles.shellViewport}>
    <div className={styles.shellMain}>{children}</div>
    <AutopilotRail />
    <AutopilotTour />
  </div>
)
