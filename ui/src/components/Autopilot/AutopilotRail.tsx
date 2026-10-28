/**
 * The docked Autopilot rail (component 1/3/7/8/10/11). Read-only Q&A MVP:
 *   head    — spark+title, live/idle pill, new-thread, collapse
 *   body    — context strip (what it SEES), transcript, per-turn suggestions
 *   composer— textarea + send + the drive-via-real-controls trust note
 *
 * Renders nothing unless Autopilot is `enabled`. The width animates 0 → `railWidth`
 * (384 by default, drag-resizable from its left edge and persisted across sessions —
 * see railWidth.ts) so the shell reflows (it never overlays);
 * toggling session history (`.apMain`'s `HistoryColumn`) widens it further by a fixed
 * HISTORY_EXTRA_WIDTH, to dock the thread list beside the transcript instead of
 * covering it. A separate "full width" toggle takes it to 100% of the shell viewport
 * instead — still a plain width reflow, not the browser Fullscreen API. All
 * driving/HITL surfaces are Phase 2/3.
 */

import { type ClipboardEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { useConfigContext } from '../../context/ConfigContext'

import { useAutopilot } from './AutopilotProvider'
import styles from './AutopilotRail.module.css'
import AutopilotTour from './AutopilotTour'
import { autopilotComposerDraftStore } from './composerDraftStore'
import { AUTOPILOT_UNAVAILABLE } from './copy'
import { useRailFocusTrap } from './focusTrap'
import { CollapseIcon, ExpandIcon, EyeIcon, HistoryIcon, LinkIcon, PlusIcon, SendIcon, ShrinkIcon, SparkIcon, StopIcon } from './icons'
import { looksLikeOpenApiDocument } from './oasAttachment'
import { HistoryColumn } from './RailHistory'
import { ApprovalCard, MessageBubble } from './RailTranscript'
import { clampRailWidth, getStoredRailWidth, HISTORY_EXTRA_WIDTH, maxDockableWidth, RAIL_WIDTH_STORAGE_KEY } from './railWidth'
import { useComposerAutoGrow } from './useComposerAutoGrow'
import { SpeakBackStatus, SpeakBackToggle } from './voice/speak/SpeakBackControls'
import { autopilotSpeakBackStore } from './voice/speak/speakBackStore'
import { useVoiceBusy, VoiceButton, VoiceStatus } from './voice/VoiceControl'
import { autopilotVoiceStore } from './voice/voiceStore'
import { escapeInterruptsVoice, useVoiceWiring } from './voiceWiring'

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
  const { approvePending, attachOasDocument, clearOasAttachment, collect, denyPending, enabled, messages, newThread, oasAttachment, open, pendingApproval, reachable, restored, retryClaims, send, sessionId, sessions, setOpen, stop, streaming, switchToThread } = useAutopilot()
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
    // C8 exception: the rail's keyboard shortcuts, delegated from the controls inside it; the <aside> itself is not a control.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
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
                      <button className={styles.apSg} disabled={!reachable} key={`starter-${index}`} onClick={() => send(prompt)} type='button'>
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((message) => <MessageBubble key={message.id} message={message} onRetryClaims={retryClaims} streaming={streaming} />)
              )}

              {pendingApproval ? (
                <ApprovalCard onApprove={approvePending} onDeny={denyPending} pause={pendingApproval} />
              ) : null}

              {lastSuggestions?.length ? (
                <div className={styles.apSuggest}>
                  {lastSuggestions.map((suggestion, index) => (
                    <button className={styles.apSg} disabled={!reachable} key={`sg-${index}`} onClick={() => send(suggestion)} type='button'>
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className={styles.apComposer}>
              {/* A disabled <button> swallows pointer events, so the toggle's tooltip cannot
                  reach anyone inside the rail. Dead controls with no stated reason are worse
                  than an explanation, so the rail says it in text. Same sentence as the
                  toggle, from one constant. */}
              {reachable ? null : (
                <div className={styles.apNote} data-testid='autopilot-unavailable'>{AUTOPILOT_UNAVAILABLE}</div>
              )}
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
                  disabled={!reachable}
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
                  <button aria-busy={voiceBusy} aria-label='Send' className={styles.apSend} disabled={!reachable || !draft.trim() || voiceBusy} onClick={submit} type='button'>
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
