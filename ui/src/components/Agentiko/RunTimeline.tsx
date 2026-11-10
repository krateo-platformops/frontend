/**
 * THE RUN TIMELINE: one card per assistant turn, the same object while it runs and after.
 *
 * It replaces two views that told one story two ways. A live strip showed the last four steps as raw
 * tool names and vanished when the answer landed; a collapsed "Evidence · N" then appeared under the
 * answer in different words ("1 lookup · 1 specialist"). Now the card fills in while the turn
 * streams, folds to one line above the answer when it is done ("✓ Checked 7 things · with
 * core-provider-agent · 0:41"), and opens back into the same tree.
 *
 * Its rules (the approved mockup, 2026-11-10):
 *   - verb + object, never a bare tool name (stepLabels.ts); the raw name stays in the hover title
 *     and in "Copy steps";
 *   - consecutive same-kind calls fold into one line with a count (runSteps.ts);
 *   - each specialist is a lane under its hand-off, filled in when it replies, from the session
 *     store (fetchDelegationEvidence) — no polling;
 *   - a clock on the step in flight, a duration on finished ones, the total in the header;
 *   - honest about silence: two minutes with no event says so; a turn that stopped without an
 *     answer says "didn't finish" instead of looking alive;
 *   - a kagent HITL approval is a step of the turn that asked for it, behaviour unchanged.
 *
 * Its own module because AgentikoRail and AgentikoProvider are both at the repo's code-line cap.
 */
import { Button, ConfigProvider, Timeline } from 'antd'
import type { ThemeConfig, TimelineItemProps } from 'antd'
import { type ReactNode, useEffect, useId, useMemo, useState } from 'react'
import { CopyToClipboard } from 'react-copy-to-clipboard-ts'

import { agentikoConfig } from '../../context/agentikoConfig'
import { useConfigContext } from '../../context/ConfigContext'
import { spacing } from '../../theme/tokens'

import railStyles from './AgentikoRail.module.css'
import type { ApprovalPause } from './approval'
import { deriveSessionsBase, describeArgs, fetchDelegationEvidence, NO_DELEGATION_SESSION, serializeEvidence } from './evidence'
import { CheckIcon, CopyIcon } from './icons'
import type { RunStep, StepStatus } from './runSteps'
import { countRun, formatAgo, formatClock, formatDuration, groupSteps, isRunUnfinished, lastEventAt, plural, STALL_MS } from './runSteps'
import styles from './RunTimeline.module.css'
import { approvalIntent } from './stepLabels'
import { a2aAuthHeader } from './transport'
import type { AgentikoMessage, EvidenceEntry } from './types'

type Tone = 'running' | 'ok' | 'bad' | 'warn' | 'idle'

const TONE: Record<StepStatus, Tone> = { done: 'ok', failed: 'bad', paused: 'warn', running: 'running', unfinished: 'idle' }

/** The word that goes with each mark, for a reader who cannot see its shape or colour. */
const STATUS_WORD: Record<Tone, string> = { bad: 'Failed', idle: 'Did not return', ok: 'Done', running: 'Running', warn: 'Needs attention' }

/** The status mark's box, the approved mockup's 14px: `.mark` in RunTimeline.module.css, and Timeline's dot size. */
const MARK_SIZE = 14

const MARK: Record<Tone, string> = { bad: '✕', idle: '', ok: '✓', running: '', warn: '!' }

/** The kagent HITL pause this turn is waiting on, with the provider's decision paths. */
export interface RunApproval {
  pause: ApprovalPause
  onApprove: () => void
  onDeny: () => void
}

/** Sub-steps of one hand-off. `error` carries the REASON, worded by evidence.ts (frontend#181). */
interface DelegationState {
  children?: EvidenceEntry[]
  error?: string
  loading?: boolean
}

/** A clock that ticks once a second while `ticking`; otherwise the time of the last tick. */
const useNow = (ticking: boolean): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) {
      return undefined
    }
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [ticking])
  return ticking ? now : Date.now()
}

const Mark = ({ tone }: { tone: Tone }) => (
  <span aria-hidden className={styles.mark} data-tone={tone}>{MARK[tone]}</span>
)

/** The raw tool name and its full arguments, for the hover title — nothing is lost to the words. */
const rawTitle = (entries: EvidenceEntry[]): string => entries.map((entry) => {
  const args = entry.agent ? '' : describeArgs(entry, { full: true })
  return `${entry.tool}${args ? ` · ${args}` : ''}`
}).join('\n')

const stepTime = (step: RunStep, now: number): string => {
  if (step.status === 'running') {
    return step.startedAt === undefined ? '' : formatClock(now - step.startedAt)
  }
  if (step.startedAt !== undefined && step.endedAt !== undefined) {
    return formatDuration(step.endedAt - step.startedAt)
  }
  return ''
}

/** What an open step says about itself when nothing will complete it, or someone must act first. */
const openNote = (status: StepStatus, waitingOnYou: boolean): string | undefined => {
  if (status === 'paused') {
    return waitingOnYou ? 'waiting for your approval' : 'paused for approval'
  }
  return status === 'unfinished' ? 'didn’t return' : undefined
}

const stepNote = (step: RunStep, waitingOnYou: boolean): string | undefined =>
  (step.status === 'failed' ? step.reason ?? 'failed' : openNote(step.status, waitingOnYou))

const FullRequest = ({ request, separated }: { request: string; separated: boolean }) => {
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <>
      {separated ? ' · ' : null}
      <Button aria-controls={id} aria-expanded={open} className={styles.inlineBtn} onClick={() => setOpen((prev) => !prev)} size='small' type='link'>
        {open ? 'hide request' : 'full request'}
      </Button>
      {open ? <pre className={styles.request} id={id}>{request}</pre> : null}
    </>
  )
}

/** The content of one step's Timeline item: the words, the notes, and the clock or duration on the
 *  trailing edge. The status mark is the item's `icon`, so it is not repeated here. */
const StepBody = ({ now, stalled, step, waitingOnYou }: { now: number; stalled: boolean; step: RunStep; waitingOnYou: boolean }) => {
  const isStalled = stalled && step.status === 'running'
  const tone: Tone = isStalled ? 'warn' : TONE[step.status]
  const single = step.entries.length === 1 ? step.entries[0] : undefined
  const text = isStalled && step.delegation ? `${step.delegation.agent} hasn’t answered` : step.text
  // A hand-off that is open says why in its lane, right under it; saying it twice is noise.
  const laneSaysIt = Boolean(step.delegation) && (step.status === 'paused' || step.status === 'unfinished')
  let note = laneSaysIt ? undefined : stepNote(step, waitingOnYou)
  if (isStalled) {
    note = 'No reply yet. It may still be working, or the run stopped.'
  }
  return (
    <div className={styles.step} data-status={step.status} data-testid='agentiko-run-step' data-tone={tone} title={rawTitle(step.entries)}>
      <span className={styles.tx}>
        <span className={styles.srOnly}>{STATUS_WORD[tone]}: </span>
        {single?.url ? <a className={styles.link} href={single.url} rel='noreferrer' target='_blank'>{text}</a> : text}
        {step.detail || step.delegation?.request ? (
          <small>
            {step.detail}
            {step.delegation?.request ? <FullRequest request={step.delegation.request} separated={Boolean(step.detail)} /> : null}
          </small>
        ) : null}
        {note ? <small>{note}</small> : null}
      </span>
      <span aria-hidden className={styles.stepTime} data-clock>{stepTime(step, now)}</span>
    </div>
  )
}

const stepTone = (step: RunStep, stalled: boolean): Tone => (stalled && step.status === 'running' ? 'warn' : TONE[step.status])

/** One step as a Timeline item. `loading` is antd's own "in progress" state for the step in flight;
 *  the icon stays ours, so the spinner keeps its reduced-motion fallback. */
const stepItem = (step: RunStep, ctx: { now: number; stalled: boolean; waitingOnYou: boolean }, lane?: ReactNode): TimelineItemProps => ({
  content: <div className={styles.item}><StepBody now={ctx.now} stalled={ctx.stalled} step={step} waitingOnYou={ctx.waitingOnYou} />{lane}</div>,
  icon: <Mark tone={stepTone(step, ctx.stalled)} />,
  key: step.key,
  loading: step.status === 'running',
})

/**
 * The Timeline's layout, from the rail's own scale (theme/tokens.ts `spacing`), as antd tokens rather
 * than CSS over antd's classes. Timeline renders antd Steps (type "dot"), so:
 *   - the item rhythm is Steps': min-height is 1.5 × `controlHeight`, the gap below an item `paddingSM`
 *     (8px between steps, the mockup's 4px above and below each);
 *   - the icon box is Timeline's `dotSize` — EXCEPT on the current item (Timeline makes the last one
 *     current), where Steps applies its own `dotCurrentSize`, and that rule reaches every icon nested
 *     under it, a specialist's lane included. So Steps' `dotSize` and `dotCurrentSize` are the mark's
 *     size too, or the last step and its lane draw a 9px box around a 14px mark;
 *   - the rail is off: in the approved mockup a lane is a column of steps, and a specialist's lane is
 *     set apart by its own nest line.
 */
const RUN_TIMELINE_THEME: ThemeConfig = {
  components: {
    Steps: { controlHeight: spacing.smd, dotCurrentSize: MARK_SIZE, dotSize: MARK_SIZE, paddingSM: spacing.sm },
    Timeline: { dotBorderWidth: 0, dotSize: MARK_SIZE, tailWidth: 0 },
  },
}

const DelegationLane = ({ entry, onRetry, state, status, waitingOnYou }: {
  entry: EvidenceEntry
  onRetry: () => void
  state?: DelegationState
  status: StepStatus
  waitingOnYou: boolean
}) => {
  let body
  if (status === 'running') {
    body = <div className={styles.note}>its steps appear when it replies</div>
  } else if (status === 'paused') {
    body = <div className={styles.note}>{waitingOnYou ? 'it is waiting for your approval' : 'it paused for an approval'}</div>
  } else if (status === 'unfinished') {
    body = <div className={styles.note}>it never replied, so it has no steps to show</div>
  } else if (!entry.sessionId) {
    body = <div className={`${styles.note} ${styles.noteBad}`}>Couldn’t load its steps: {NO_DELEGATION_SESSION}</div>
  } else if (state?.error) {
    body = (
      <div className={`${styles.note} ${styles.noteBad}`} role='alert'>
        Couldn’t load its steps: {state.error}{' '}
        <Button className={styles.inlineBtn} onClick={onRetry} size='small' type='link'>Retry</Button>
      </div>
    )
  } else if (state?.children) {
    const ctx = { now: 0, stalled: false, waitingOnYou: false }
    body = state.children.length
      ? <Timeline items={groupSteps(state.children, { live: false, paused: false }).map((child) => stepItem(child, ctx))} />
      : <div className={styles.note}>it ran no tools</div>
  } else {
    body = <div className={styles.note}>loading its steps…</div>
  }
  return (
    <div className={styles.nest} data-testid='agentiko-run-lane'>
      <div className={styles.lane}>{entry.agent}</div>
      {body}
    </div>
  )
}

/**
 * The kagent HITL approval, as a step. BEHAVIOUR IS UNCHANGED from the card it replaces: Approve and
 * Deny call the provider's paths, dismissing denies, and the provider's governor self-denies an
 * unattended pause after 5 minutes. Same classes for the mono block and the buttons, so it keeps
 * BlastRadiusConfirm's calm decision language.
 */
const ApprovalStep = ({ approval }: { approval: RunApproval }) => {
  const { onApprove, onDeny, pause } = approval
  const [first] = pause.requests
  const who = first?.agentName ?? 'Agentiko'
  const what = pause.requests.length === 1 && first ? approvalIntent(first.toolName) : `run ${pause.requests.length} write tools`
  return (
    <div className={styles.approval} data-testid='agentiko-approval'>
      <div className={styles.step} data-tone='warn'>
        <span className={styles.tx}>
          <span className={styles.srOnly}>Needs your approval: </span>
          <b>{who}</b> wants to {what}
          <small>the agent wants to run a write tool</small>
        </span>
        <button aria-label='Dismiss (denies)' className={railStyles.apIc} onClick={onDeny} title='Dismiss (denies)' type='button'>×</button>
      </div>
      {pause.requests.map((request) => (
        <div key={request.requestId}>
          <div className={railStyles.apApprovalTool}>
            <span className={railStyles.apApprovalToolName}>{request.toolName}</span>
            {request.agentName ? <span className={railStyles.apApprovalAgent}>{request.agentName}</span> : null}
          </div>
          <pre className={railStyles.apApprovalCode}>{request.argumentsPreview}</pre>
        </div>
      ))}
      <div className={railStyles.apApprovalBtns}>
        <button className={railStyles.apBtnApprove} onClick={onApprove} type='button'>Approve</button>
        <button className={railStyles.apBtnDeny} onClick={onDeny} type='button'>Deny</button>
      </div>
      <div className={railStyles.apApprovalNote}>Deny is the default — dismissing, starting a new thread, or waiting 5 minutes denies.</div>
    </div>
  )
}

/** A step that is not a tool call — the stall's "hasn't answered", a decided approval — as an item. */
const noteItem = (key: string, tone: Tone, text: string, note: string, testId?: string): TimelineItemProps => ({
  content: (
    <div className={`${styles.item} ${styles.step}`} data-testid={testId} data-tone={tone}>
      <span className={styles.tx}>
        <span className={styles.srOnly}>{STATUS_WORD[tone]}: </span>
        {text}
        <small>{note}</small>
      </span>
    </div>
  ),
  icon: <Mark tone={tone} />,
  key,
})

/** A past approval, read back: what was decided, from the decision chip on the turn that resumed it. */
const decidedItem = (outcome?: string): TimelineItemProps => {
  let tone: Tone = 'idle'
  if (outcome) {
    tone = outcome.startsWith('approved') ? 'ok' : 'warn'
  }
  return noteItem('approval-decided', tone, 'Asked for your approval', outcome ?? 'no decision was recorded', 'agentiko-approval-decided')
}

interface HeaderModel {
  tone: Tone
  word: string
  secondary?: string
  time: string
}

const doneHeader = (message: AgentikoMessage, children: Record<string, EvidenceEntry[]>): HeaderModel => {
  const entries = message.evidence ?? []
  const time = formatClock(lastEventAt(message) - message.createdAt)
  if (isRunUnfinished(message)) {
    return {
      secondary: message.text.trim() ? 'its last step never returned' : 'no answer was recorded',
      time: formatAgo(Date.now() - lastEventAt(message)),
      tone: 'idle',
      word: 'This run didn’t finish',
    }
  }
  if (!entries.length) {
    return { secondary: 'no tools used', time, tone: 'ok', word: 'Answered from the page context' }
  }
  const counts = countRun(entries, children)
  const withAgents = counts.agents.length ? `with ${counts.agents.join(', ')}` : undefined
  if (counts.failed) {
    return { secondary: withAgents, time, tone: 'warn', word: `Done · ${plural(counts.failed, 'step')} failed` }
  }
  if (!counts.calls) {
    return { time, tone: 'ok', word: `Asked ${counts.agents.join(', ')}` }
  }
  return { secondary: withAgents, time, tone: 'ok', word: `Checked ${plural(counts.calls, 'thing')}` }
}

export interface RunTimelineProps {
  message: AgentikoMessage
  /** Set on the ONE turn the pending approval belongs to. */
  approval?: RunApproval
  /** For a turn that paused on an approval earlier: the decision recorded after it. */
  approvalOutcome?: string
  /** Stop the stream and send the same question again — the stall state's way out. */
  onAskAgain?: () => void
}

export const RunTimeline = ({ approval, approvalOutcome, message, onAskAgain }: RunTimelineProps) => {
  const { config } = useConfigContext()
  const base = agentikoConfig(config?.api, 'API_BASE_URL')
  const bodyId = useId()
  const live = Boolean(message.streaming)
  const paused = Boolean(message.approvalAt)
  const entries = useMemo(() => message.evidence ?? [], [message.evidence])
  const now = useNow(live || Boolean(approval))
  // "Keep waiting" re-arms the stall check from the moment it was pressed.
  const [keptWaitingAt, setKeptWaitingAt] = useState(0)
  const [override, setOverride] = useState<{ phase: string; open: boolean }>()
  const [delegations, setDelegations] = useState<Record<string, DelegationState>>({})
  const [copied, setCopied] = useState(false)

  const lastEvent = lastEventAt(message)
  const stalled = live && !approval && now - Math.max(lastEvent, keptWaitingAt) >= STALL_MS
  // Open while something is happening or someone must act; folded once it is over. A reader's own
  // toggle holds only within the phase it was made in — the answer arriving folds the card again.
  let phase: 'approval' | 'live' | 'done' = 'done'
  if (approval) {
    phase = 'approval'
  } else if (live) {
    phase = 'live'
  }
  const open = override?.phase === phase ? override.open : phase !== 'done'

  // A specialist's steps are filled in when it REPLIES: its hand-off is done and named a session. The
  // fetch runs only while the card is open — live, that is the moment the reply lands; for a turn
  // read back from history, it is when the reader opens it.
  useEffect(() => {
    if (!open || !base) {
      return
    }
    const pending = entries.filter((entry) => entry.agent && entry.done && entry.sessionId && !delegations[entry.sessionId])
    if (!pending.length) {
      return
    }
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
  }, [open, base, entries, delegations])

  if (!live && !message.evidence && !paused) {
    return null
  }

  const childrenBySession = Object.fromEntries(
    Object.entries(delegations).flatMap(([sid, state]) => (state.children ? [[sid, state.children]] : [])),
  )
  const counts = countRun(entries, childrenBySession)
  const steps = groupSteps(entries, { live, paused })
  const waitingOnYou = Boolean(approval)
  const busy = entries.filter((entry) => entry.agent && !entry.done).length

  let header: HeaderModel
  if (approval) {
    header = { time: formatClock(now - (message.approvalAt ?? message.createdAt)), tone: 'warn', word: 'Waiting for you' }
  } else if (stalled) {
    header = { time: formatClock(now - message.createdAt), tone: 'warn', word: `No reply for ${formatClock(now - lastEvent)}` }
  } else if (live) {
    header = {
      ...(busy ? { secondary: `${plural(busy, 'specialist')} busy` } : {}),
      time: formatClock(now - message.createdAt),
      tone: 'running',
      word: message.text ? 'Answering' : 'Working',
    }
  } else {
    header = doneHeader(message, childrenBySession)
  }

  const ctx = { now, stalled, waitingOnYou }
  const items: TimelineItemProps[] = steps.map((step) => stepItem(step, ctx, step.delegation ? (
    <DelegationLane
      entry={step.delegation}
      onRetry={() => setDelegations((prev) => Object.fromEntries(
        Object.entries(prev).filter(([sid]) => sid !== step.delegation?.sessionId),
      ))}
      state={step.delegation.sessionId ? delegations[step.delegation.sessionId] : undefined}
      status={step.status}
      waitingOnYou={waitingOnYou}
    />
  ) : undefined))
  if (stalled && !steps.some((step) => step.status === 'running')) {
    items.push(noteItem('stalled', 'warn', 'Agentiko hasn’t answered', 'It may still be working, or the run stopped.'))
  }
  if (approval) {
    items.push({ content: <div className={styles.item}><ApprovalStep approval={approval} /></div>, icon: <Mark tone='warn' />, key: 'approval' })
  } else if (paused) {
    items.push(decidedItem(approvalOutcome))
  }

  const collapsible = phase === 'done' && (entries.length > 0 || paused)
  const headInner = (
    <>
      {collapsible ? <span aria-hidden className={styles.chev}>{open ? '▾' : '▸'}</span> : null}
      <Mark tone={header.tone} />
      <span className={styles.word} data-tone={header.tone}>{header.word}</span>
      {header.secondary ? <span className={styles.secondary}>· {header.secondary}</span> : null}
      <span aria-hidden className={styles.time} data-clock>{header.time}</span>
    </>
  )
  const showBody = open && (steps.length > 0 || paused || stalled)
  const headClass = `${styles.head} ${showBody ? '' : styles.headFolded}`

  return (
    <ConfigProvider theme={RUN_TIMELINE_THEME}>
      <div aria-live='polite' className={styles.run} data-phase={phase} data-testid='agentiko-run'>
        {collapsible
          ? (
            <button
              aria-controls={bodyId}
              aria-expanded={open}
              className={headClass}
              data-testid='agentiko-run-head'
              onClick={() => setOverride({ open: !open, phase })}
              type='button'
            >
              {headInner}
            </button>
          )
          : <div className={headClass} data-testid='agentiko-run-head'>{headInner}</div>}
        {showBody ? (
          <div className={styles.body} id={bodyId}>
            {counts.agents.length ? <div className={styles.lane}><span className={styles.laneDot} />Agentiko</div> : null}
            <div className={styles.timeline}><Timeline items={items} /></div>
            {stalled ? (
              <div className={styles.actions}>
                <Button onClick={() => setKeptWaitingAt(Date.now())} size='small'>Keep waiting</Button>
                {onAskAgain ? <Button onClick={onAskAgain} size='small'>Stop and ask again</Button> : null}
              </div>
            ) : null}
            {phase === 'done' ? (
              <div className={styles.foot}>
                <span>{plural(counts.agents.length + 1, 'agent')} · {plural(counts.steps, 'step')}{counts.failed ? ` · ${counts.failed} failed` : ''}</span>
                <CopyToClipboard
                  onCopy={() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                  text={serializeEvidence(entries, childrenBySession)}
                >
                  <Button
                    aria-label='Copy steps to clipboard'
                    className={styles.copy}
                    icon={copied ? <CheckIcon size={11} /> : <CopyIcon />}
                    size='small'
                    title='Copy steps to clipboard'
                    type='text'
                  >
                    {copied ? 'Copied' : 'Copy steps'}
                  </Button>
                </CopyToClipboard>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </ConfigProvider>
  )
}
