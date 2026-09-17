/**
 * The docked Autopilot rail (component 1/3/7/8/10/11). Read-only Q&A MVP:
 *   head    — spark+title, live/idle pill, new-thread, collapse
 *   body    — context strip (what it SEES), transcript, per-turn suggestions
 *   composer— textarea + send + the drive-via-real-controls trust note
 *
 * Renders nothing unless Autopilot is `enabled`. The width animates 0 → `railWidth`
 * (384 by default, drag-resizable from its left edge and persisted across sessions —
 * see RAIL_DEFAULT_WIDTH/getStoredRailWidth) so the shell reflows (it never overlays);
 * toggling session history (`.apMain`'s `HistoryColumn`) widens it further by a fixed
 * HISTORY_EXTRA_WIDTH, to dock the thread list beside the transcript instead of
 * covering it. A separate "full width" toggle takes it to 100% of the shell viewport
 * instead — still a plain width reflow, not the browser Fullscreen API. All
 * driving/HITL surfaces are Phase 2/3.
 */

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { ClipboardEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { CopyToClipboard } from 'react-copy-to-clipboard-ts'
import { default as ReactMarkdown } from 'react-markdown'

import { useConfigContext } from '../../context/ConfigContext'

import type { ApprovalPause } from './approval'
import { useAutopilot } from './AutopilotProvider'
import styles from './AutopilotRail.module.css'
import AutopilotTour from './AutopilotTour'
import { autopilotComposerDraftStore } from './composerDraftStore'
import { describeArgs, deriveSessionsBase, fetchDelegationEvidence, serializeEvidence, summarizeEvidence } from './evidence'
import { useRailFocusTrap } from './focusTrap'
import { CheckIcon, CollapseIcon, CopyIcon, EvidenceIcon, ExpandIcon, EyeIcon, HistoryIcon, LinkIcon, PlusIcon, SendIcon, ShrinkIcon, SparkIcon, StopIcon } from './icons'
import { looksLikeOpenApiDocument } from './oasAttachment'
import { relativeTime, type ThreadSummary } from './sessionHistoryStore'
import { a2aAuthHeader } from './transport'
import type { AutopilotMessage, EvidenceEntry } from './types'
import { useComposerAutoGrow } from './useComposerAutoGrow'
import { SpeakBackStatus, SpeakBackToggle } from './voice/speak/SpeakBackControls'
import { autopilotSpeakBackStore } from './voice/speak/speakBackStore'
import { useVoiceBusy, VoiceButton, VoiceStatus } from './voice/VoiceControl'
import { autopilotVoiceStore } from './voice/voiceStore'
import { escapeInterruptsVoice, useVoiceWiring } from './voiceWiring'

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
 * Session history (item P, split-view iteration). A persistent column docked beside
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
 *
 * The search box is a local, in-memory filter over `rows` (title substring match) — not
 * PageSearch's `?q=`-bound pattern, since this list isn't URL-addressable state — and the
 * query resets on close so reopening the column never lands on a stale filter. Every
 * tabbable element here also gets `tabIndex={-1}` while closed: the column keeps rendering
 * at width:0 rather than unmounting (see the rail's own convention), and without it Tab would
 * still walk through search + rows that are invisible and `aria-hidden`.
 */
const HistoryColumn = ({ currentSessionId, onSwitch, open, sessions }: {
  currentSessionId: string
  onSwitch: (sessionId: string) => void
  open: boolean
  sessions: () => ThreadSummary[]
}) => {
  const [rows, setRows] = useState<ThreadSummary[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (open) {
      setRows(sessions())
    } else {
      setQuery('')
    }
  }, [sessions, currentSessionId, open])

  const trimmedQuery = query.trim()
  const filteredRows = trimmedQuery
    ? rows.filter((row) => row.title.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : rows

  let listContent: React.ReactNode
  if (rows.length === 0) {
    listContent = <div className={styles.apHistoryEmpty}>No past conversations yet. Your threads are saved here when you start a new one.</div>
  } else if (filteredRows.length === 0) {
    listContent = <div className={styles.apHistoryEmpty}>No conversations match &quot;{trimmedQuery}&quot;.</div>
  } else {
    listContent = filteredRows.map((row) => (
      <button
        className={`${styles.apHistoryRow} ${row.sessionId === currentSessionId ? styles.apHistoryRowActive : ''}`}
        key={row.sessionId}
        onClick={() => onSwitch(row.sessionId)}
        tabIndex={open ? 0 : -1}
        type='button'
      >
        <span className={styles.apHistoryTitle}>{row.title}</span>
        <span className={styles.apHistoryMeta}>{relativeTime(row.updatedAt)} · {row.messageCount} msg{row.messageCount === 1 ? '' : 's'}</span>
      </button>
    ))
  }

  return (
    <div aria-hidden={!open} className={`${styles.apHistoryCol} ${open ? styles.apHistoryColOpen : ''}`} data-testid='autopilot-history-panel'>
      <div className={styles.apHistoryHead}>Conversations</div>
      {rows.length > 0 ? (
        <div className={styles.apHistorySearchWrap}>
          <EvidenceIcon className={styles.apHistorySearchIcon} size={11} />
          <input
            aria-label='Search conversations'
            className={styles.apHistorySearchInput}
            data-testid='autopilot-history-search'
            onChange={(event) => setQuery(event.target.value)}
            placeholder='Search…'
            tabIndex={open ? 0 : -1}
            type='text'
            value={query}
          />
        </div>
      ) : null}
      <div className={styles.apHistoryList}>{listContent}</div>
    </div>
  )
}

// User-resizable base width (the docked width before the history split's fixed +256px extra —
// see HISTORY_EXTRA_WIDTH below — or the full-width override). Persisted across sessions the same
// way ThemeModeContext persists its mode: read once at mount, written on drag-end only (not on
// every pointermove, to avoid hammering localStorage mid-drag).
const RAIL_WIDTH_STORAGE_KEY = 'krateo-autopilot-rail-width'
const RAIL_MIN_WIDTH = 320
const RAIL_MAX_WIDTH = 720
const RAIL_DEFAULT_WIDTH = 384
// Kept equal to 640 - 384, the pre-resize .apRail.open.split delta, so a never-resized rail is
// byte-identical to the old fixed-width behavior.
const HISTORY_EXTRA_WIDTH = 256

const clampRailWidth = (value: number) => Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, value))

// Responsive guard: on a narrow viewport, a persisted-wide `railWidth` (dragged on a bigger
// screen) or the history split's fixed +256 must not crush `main` to nothing. Mirrors the
// max-width backstop in AutopilotRail.module.css (which wins regardless, even before this
// runs) but also keeps the drag itself from fighting that CSS clamp mid-gesture — without it,
// the handle would visually detach from the cursor once the box hit its CSS max-width while
// `railWidth` kept climbing underneath. ABSOLUTE_MIN_DOCK is the floor even on a tiny viewport,
// matching the CSS backstop's own floor (never squeeze the rail into something unusable).
const ABSOLUTE_MIN_DOCK = 240
const NARROW_VIEWPORT = 640
const maxDockableWidth = (viewportWidth: number) => Math.max(ABSOLUTE_MIN_DOCK, viewportWidth - (viewportWidth <= NARROW_VIEWPORT ? 64 : 200))

const getStoredRailWidth = (): number => {
  const stored = Number(localStorage.getItem(RAIL_WIDTH_STORAGE_KEY))
  return Number.isFinite(stored) && stored > 0 ? clampRailWidth(stored) : RAIL_DEFAULT_WIDTH
}

const AutopilotRail = () => {
  const { approvePending, attachOasDocument, clearOasAttachment, collect, denyPending, enabled, messages, newThread, oasAttachment, open, pendingApproval, restored, send, sessionId, sessions, setOpen, stop, streaming, switchToThread } = useAutopilot()
  const { config } = useConfigContext()
  // The composer draft + its PROVENANCE (purely dictated vs touched by the keyboard) live in
  // a module-level store, not `useState`: a routerVersion remount used to wipe a half-written
  // question, and speak-back's whole trigger is a property of HOW the draft was composed, so
  // it has to survive the remount alongside the text. See composerDraftStore.ts.
  const { text: draft } = useSyncExternalStore(autopilotComposerDraftStore.subscribe, autopilotComposerDraftStore.getSnapshot)
  // FR 25: Send (and the microphone) are held while a transcription is in flight.
  const voiceBusy = useVoiceBusy()
  // Session history (item P, split-view iteration): widens the rail to dock a thread
  // list beside the transcript (see .apRail.split). Local to the rail — not lifted into the
  // provider — because this component is also the SOLE owner of the `--autopilot-rail-width`
  // CSS var below (body-portalled overlays like the Filters Drawer inset off it); keeping both
  // in one place avoids two effects racing to set the same DOM property.
  const [historyOpen, setHistoryOpen] = useState(false)
  // Full-width mode: widens the rail to the whole shell viewport (NOT the browser Fullscreen
  // API — no chrome takeover, just the same width-only reflow the rail already does at
  // 384/640px, carried to 100%). Local to the rail for the same reason as `historyOpen`.
  const [fullWidth, setFullWidth] = useState(false)
  // Drag-to-resize: the user-chosen base width (see RAIL_DEFAULT_WIDTH/getStoredRailWidth above).
  // `resizing` only disables the width transition for the drag's duration — dragging with the
  // transition still on feels laggy (the rail visibly trails the cursor).
  const [railWidth, setRailWidth] = useState(getStoredRailWidth)
  const [resizing, setResizing] = useState(false)
  const railElRef = useRef<HTMLElement>(null)
  // Live viewport width, for the resize/history-split clamp above — see maxDockableWidth.
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // W4 KOG (FE-K2): the over-cap paste rejection note (cleared on the next successful attach).
  const [oasError, setOasError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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

  useComposerAutoGrow(textareaRef, draft)

  // Publish the rail's actual width as a :root CSS var so body-portalled overlays (the
  // Filters Drawer) can inset their right edge and never sit over the rail — 0 when
  // closed/disabled, `railWidth` (user-resizable, defaults 384) open, +HISTORY_EXTRA_WIDTH
  // when the history split view widens it further, 100% in full-width mode.
  useEffect(() => {
    const rawWidth = enabled && open ? railWidth + (historyOpen ? HISTORY_EXTRA_WIDTH : 0) : 0
    const dockedWidth = Math.min(rawWidth, maxDockableWidth(viewportWidth))
    const width = enabled && open && fullWidth ? '100%' : `${dockedWidth}px`
    document.documentElement.style.setProperty('--autopilot-rail-width', width)
    return () => { document.documentElement.style.setProperty('--autopilot-rail-width', '0px') }
  }, [enabled, open, historyOpen, fullWidth, railWidth, viewportWidth])

  // Keyboard nav: Tab cycles within the rail while it's open (see focusTrap.ts). Autofocus
  // lands in the composer on open, mirroring CommandPalette's own autofocus-on-open.
  //
  // ESCAPE IS LAYERED, and this is the rail's ONLY Escape handler. The trap listens
  // NATIVELY on the rail container and stops propagation, and React 19 delegates from the
  // ROOT — above that container — so an `onKeyDown` Escape branch on the composer can never
  // run. Every Escape meaning therefore has to be decided here, innermost first:
  //
  //   1. a spoken answer is playing  → stop the voice, leave the rail open (FR 75);
  //   2. the microphone is live      → cancel dictation, draft untouched (FR 13);
  //   3. otherwise                   → collapse, as the "Collapse rail" button does.
  //
  // Innermost-first is what makes Escape usable in conversation mode: the gesture that
  // interrupts a voice reading an answer must not also close the rail it was read from. A
  // pending approval is untouched at every layer; only its own dismiss/deny/5-minute
  // governor resolves it.
  useRailFocusTrap(open, railElRef, () => {
    if (!escapeInterruptsVoice()) {
      setOpen(false)
    }
  })
  useEffect(() => {
    if (open) {
      textareaRef.current?.focus()
    }
  }, [open])

  // Speak-back (voice spec §3). Three wires, all of them one-way into the store:
  //  - the operator kill-switch (AUTOPILOT_VOICE_SPEAK_BACK: "off") removes the feature and
  //    its control entirely, re-read whenever config loads;
  //  - collapsing the rail stops speech (FR 75) — the answer is out of sight, so a voice
  //    still reading it has nothing on screen to stop it;
  //  - opening an unavailable rail says once, in the console, why nothing will be spoken
  //    (FR 79) — the same courtesy the capture half owes an insecure context.
  useEffect(() => {
    autopilotSpeakBackStore.setConfigValue(config?.api.AUTOPILOT_VOICE_SPEAK_BACK)
  }, [config])
  useEffect(() => {
    if (open) {
      autopilotSpeakBackStore.logUnavailableOnce()
    } else {
      autopilotSpeakBackStore.cancel()
    }
  }, [open])

  // Drag-to-resize the rail from its left edge. The handle sits at x=0 inside `.apRail` (see
  // .apResizeHandle), so the rail's right edge — captured once at drag start — stays fixed for
  // the drag's duration and `anchorRight - clientX` is the new total width directly; the
  // HISTORY_EXTRA_WIDTH the split view adds is subtracted back out so `railWidth` always holds
  // just the resizable base (consistent with the CSS-var effect above and RAIL_DEFAULT_WIDTH).
  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const anchorRight = railElRef.current?.getBoundingClientRect().right ?? window.innerWidth
    const extra = historyOpen ? HISTORY_EXTRA_WIDTH : 0
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent) => {
      const next = clampRailWidth(anchorRight - moveEvent.clientX - extra)
      // Floor at 200 even when `extra` (the history split) leaves less room than that on a
      // narrow viewport — a small-but-usable drag range beats railWidth going negative.
      const viewportMax = Math.max(200, maxDockableWidth(window.innerWidth) - extra)
      setRailWidth(Math.min(next, viewportMax))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setResizing(false)
      setRailWidth((current) => {
        localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, String(current))
        return current
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Live page-context snapshot for the "seeing …" strip (real cache, not memory).
  // Cheap (a synchronous map over the widget cache); recomputed each render so it
  // tracks navigation and new turns without a stale memo. Computed ABOVE the `enabled`
  // guard so the dictation hook below it stays unconditional.
  const context = enabled && open ? collect() : null

  const submit = () => {
    // Read the draft from the STORE, not the `draft` render value. Conversation mode calls
    // this straight out of the voice store's commit, in the same tick the transcript was
    // appended — before React has re-rendered — so the render value is one segment stale
    // there and would send the question without its last words.
    const text = autopilotComposerDraftStore.getSnapshot().text.trim()
    // FR 25's hold on Send belongs HERE, not only on the button: Enter is the habitual send
    // gesture, and pressing it mid-transcription would send the typed half of a question —
    // "restart the payments deployment in" — then clear the draft, so the words still
    // arriving would land in an empty composer and, if sent next, be stamped `voice`.
    if (!text || streaming || autopilotVoiceStore.getSnapshot().phase === 'transcribing') {
      return
    }
    // Read the draft's provenance BEFORE clearing it: `voice` only when every word came from
    // dictation. That stamp rides with the turn and is what decides, at finalize, whether the
    // answer is also spoken (voice spec FR 67, with the owner's single-trigger override).
    const modality = autopilotComposerDraftStore.turnModality()
    autopilotComposerDraftStore.clear()
    send(text, { modality })
  }

  // Dictation (voice spec §2), wired one directory outside `voice/` — the ESLint fence
  // keeps the voice modules away from the transport and `send`, so the bearer, the
  // rate-limit detector and the session resume are injected from the permitted side.
  // The spoken turn sends itself (voice spec FR 11, revised): the store reports a completed
  // purely-dictated draft, the rail submits it, and the turn is stamped `voice`, so the
  // answer is spoken back AND written to the transcript like any other turn.
  useVoiceWiring(enabled && open, context, submit)

  if (!enabled) {
    return null
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      // ENTER WHILE LISTENING ENDS THE UTTERANCE, it does not submit here (voice spec FR
      // 10). There is nothing in the composer yet to send — the audio has not been
      // transcribed. Stopping capture is what starts that, and in conversation mode the
      // finished transcript sends itself, so Enter still reads as "I'm done talking".
      if (autopilotVoiceStore.getSnapshot().phase === 'listening') {
        autopilotVoiceStore.stop()
        return
      }
      submit()
    }
    // NO ESCAPE BRANCH HERE, deliberately. The focus trap takes Escape natively on the rail
    // container and stops propagation before React's root dispatcher sees it, so a branch
    // here would be dead code that reads like live behaviour. Escape's layers (stop the
    // spoken answer / cancel dictation / collapse) all live in the trap's handler above.
  }

  // FR 57: matched on `event.code`, so macOS does not insert "µ" into the textarea, and
  // only with Alt alone — a chord that happens to include Alt belongs to someone else.
  const onRailKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // The `open` test is load-bearing: A COLLAPSED RAIL IS STILL FOCUSABLE. `.apRail` closes
    // with `width: 0; overflow: hidden`, not `display: none`, so the body — including the
    // Collapse button just pressed — keeps receiving keys. Opening the microphone here would
    // clip the meter, timer and Cancel to zero width: a live mic with no visible way to stop
    // it, which is what FR 44's collapse teardown exists to prevent.
    if (open && event.altKey && event.code === 'KeyM' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault()
      autopilotVoiceStore.toggle()
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

  const dockedWidth = Math.min(railWidth + (historyOpen ? HISTORY_EXTRA_WIDTH : 0), maxDockableWidth(viewportWidth))

  return (
    <aside
      className={`${styles.apRail} ${open ? styles.open : ''} ${open && historyOpen ? styles.split : ''} ${open && fullWidth ? styles.full : ''} ${resizing ? styles.resizing : ''}`}
      onKeyDown={onRailKeyDown}
      ref={railElRef}
      style={open ? { width: fullWidth ? '100%' : `${dockedWidth}px` } : undefined}
    >
      {open && !fullWidth ? (
        <div
          aria-hidden='true'
          className={styles.apResizeHandle}
          data-testid='autopilot-resize-handle'
          onPointerDown={onResizeStart}
        />
      ) : null}
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
          <SpeakBackToggle />
          <button
            aria-label={fullWidth ? 'Restore width' : 'Expand to full width'}
            aria-pressed={fullWidth}
            className={`${styles.apIc} ${fullWidth ? styles.apIcActive : ''}`}
            data-testid='autopilot-fullwidth-toggle'
            onClick={() => setFullWidth((prev) => !prev)}
            title={fullWidth ? 'Restore width' : 'Expand to full width'}
            type='button'
          >
            {fullWidth ? <ShrinkIcon /> : <ExpandIcon />}
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
              <SpeakBackStatus />
              <VoiceStatus />
              <div className={styles.apInput}>
                <textarea
                  className={styles.apTextarea}
                  onChange={(event) => {
                    // Typing stops a spoken answer immediately (FR 75) and marks the draft
                    // keyboard-touched for good — one character is enough to make this a
                    // typed turn, which is never spoken back. It also clears a previous
                    // dictation error (FR 22): the user has moved on.
                    autopilotSpeakBackStore.cancel()
                    autopilotVoiceStore.dismissError()
                    autopilotComposerDraftStore.setTypedDraft(event.target.value)
                  }}
                  onKeyDown={onKeyDown}
                  onPaste={onPaste}
                  placeholder='Ask Autopilot to do something…'
                  ref={textareaRef}
                  rows={1}
                  value={draft}
                />
                <VoiceButton />
                {streaming ? (
                  <button aria-label='Stop' className={styles.apSend} onClick={stop} title='Stop generating' type='button'>
                    <StopIcon />
                  </button>
                ) : (
                  // FR 25: Send is held while a transcription is in flight — the words that
                  // are about to arrive belong in the question being sent.
                  <button aria-busy={voiceBusy} aria-label='Send' className={styles.apSend} disabled={!draft.trim() || voiceBusy} onClick={submit} type='button'>
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
