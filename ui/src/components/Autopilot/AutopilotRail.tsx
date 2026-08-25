/**
 * The docked Autopilot rail (component 1/3/7/8/10/11). Read-only Q&A MVP:
 *   head    — spark+title, live/idle pill, new-thread, collapse
 *   body    — context strip (what it SEES), transcript, per-turn suggestions
 *   composer— textarea + send + the drive-via-real-controls trust note
 *
 * Renders nothing unless Autopilot is `enabled`. The width animates 0 → 384 so the
 * shell reflows (it never overlays). All driving/HITL surfaces are Phase 2/3.
 */

import { useEffect, useId, useRef, useState } from 'react'
import type { ClipboardEvent, KeyboardEvent } from 'react'
import { default as ReactMarkdown } from 'react-markdown'

import { useConfigContext } from '../../context/ConfigContext'

import type { ApprovalPause } from './approval'
import { useAutopilot } from './AutopilotProvider'
import styles from './AutopilotRail.module.css'
import AutopilotTour from './AutopilotTour'
import { describeArgs, deriveSessionsBase, fetchDelegationEvidence, summarizeEvidence } from './evidence'
import { CheckIcon, CollapseIcon, EvidenceIcon, EyeIcon, LinkIcon, PlusIcon, SendIcon, SparkIcon, StopIcon } from './icons'
import { looksLikeOpenApiDocument } from './oasAttachment'
import { a2aAuthHeader } from './transport'
import type { AutopilotMessage, EvidenceEntry } from './types'

/** What the agent looked up, never what it read back. */
const EvidenceRow = ({ entry }: { entry: EvidenceEntry }) => {
  const { source } = entry
  const meta = source
    ? `${source.org ? `${source.org}/` : ''}${source.repo}${source.ref ? ` @ ${source.ref}` : ''}`
    : describeArgs(entry)
  return (
    <div className={styles.apEvRow}>
      <span className={styles.apEvTool}>{entry.tool}</span>
      <span className={styles.apEvMeta}>
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

/** A delegated hop: the specialist's own calls are not on this stream, so they are fetched from
 *  the session its response named. */
const DelegationRow = ({ entry }: { entry: EvidenceEntry }) => {
  const { config } = useConfigContext()
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{ children?: EvidenceEntry[]; error?: boolean; loading?: boolean }>({})
  const expand = () => {
    setOpen((prev) => !prev)
    const base = config?.api.AUTOPILOT_API_BASE_URL
    if (!base || !entry.sessionId || state.children || state.loading) {
      return
    }
    setState({ loading: true })
    fetchDelegationEvidence(deriveSessionsBase(base), entry, a2aAuthHeader())
      .then((children) => setState({ children }))
      .catch(() => setState({ error: true }))
  }
  return (
    <div className={styles.apEvGroup}>
      <button aria-controls={panelId} aria-expanded={open} className={styles.apEvRow} onClick={expand} type='button'>
        <span className={styles.apEvTool}>{open ? '▾' : '▸'} {entry.agent}</span>
        <span className={styles.apEvMeta}>specialist{state.children ? ` · ${state.children.length} lookups` : ''}</span>
      </button>
      {open ? (
        <div className={styles.apEvNested} id={panelId}>
          {state.loading ? <div className={styles.apEvMeta}>loading…</div> : null}
          {state.error ? <div className={styles.apEvMeta}>its activity is not readable from here</div> : null}
          {state.children?.length === 0 ? <div className={styles.apEvMeta}>no tool calls recorded</div> : null}
          {state.children?.map((child) => <EvidenceRow entry={child} key={child.id} />)}
        </div>
      ) : null}
    </div>
  )
}

/** The tool calls behind an answer, so it can be checked rather than trusted. A turn that used no
 *  tools says so. */
const EvidencePanel = ({ evidence }: { evidence: EvidenceEntry[] }) => {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button aria-controls={panelId} aria-expanded={open} className={styles.apEvBtn} onClick={() => setOpen((prev) => !prev)} type='button'>
        <EvidenceIcon />
        Evidence{evidence.length ? ` · ${evidence.length}` : ''}
      </button>
      {open ? (
        <div className={styles.apEv} data-testid='autopilot-evidence' id={panelId}>
          <div className={styles.apEvHead}>{summarizeEvidence(evidence)}</div>
          {evidence.map((entry) => (entry.agent
            ? <DelegationRow entry={entry} key={entry.id} />
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
          <span>{action.label}</span>
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

const AutopilotRail = () => {
  const { approvePending, attachOasDocument, clearOasAttachment, collect, denyPending, enabled, messages, newThread, oasAttachment, open, pendingApproval, send, setOpen, stop, streaming } = useAutopilot()
  const [draft, setDraft] = useState('')
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
    <aside className={`${styles.apRail} ${open ? styles.open : ''}`}>
      <div className={styles.apRailInner}>
        <div className={styles.apHead}>
          <span className={styles.apTitle}><SparkIcon className={styles.apSpark} />Autopilot</span>
          <span className={`${styles.apLive} ${streaming ? '' : styles.idle}`}>
            <span className={styles.apLiveDot} />{streaming ? 'streaming' : 'live'}
          </span>
          <span className={styles.apSpacer} />
          <button aria-label='New thread' className={styles.apIc} onClick={newThread} title='New thread' type='button'>
            <PlusIcon />
          </button>
          <button aria-label='Collapse rail' className={styles.apIc} onClick={() => setOpen(false)} title='Collapse rail' type='button'>
            <CollapseIcon />
          </button>
        </div>

        <div className={styles.apBody} onScroll={onBodyScroll} ref={bodyRef}>
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
