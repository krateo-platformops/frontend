/**
 * The run timeline's model, kept pure so the rules are testable without a DOM: which state each
 * call is in, which consecutive calls fold into one line, what the header counts, and how time is
 * written. RunTimeline.tsx renders it; nothing here reads a clock it is not handed.
 */
import { labelStep } from './stepLabels'
import type { AgentikoMessage, EvidenceEntry } from './types'

/**
 * - running: in flight, on a turn that is still streaming.
 * - done / failed: the result frame arrived.
 * - paused: in flight when the turn stopped to ask for an approval — waiting on a person, not lost.
 * - unfinished: in flight when the turn stopped for any other reason. Nothing will complete it.
 */
export type StepStatus = 'running' | 'done' | 'failed' | 'paused' | 'unfinished'

export interface StepContext {
  live: boolean
  paused: boolean
}

export const entryStatus = (entry: EvidenceEntry, ctx: StepContext): StepStatus => {
  if (entry.failed) {
    return 'failed'
  }
  if (entry.done) {
    return 'done'
  }
  if (ctx.live) {
    return 'running'
  }
  return ctx.paused ? 'paused' : 'unfinished'
}

/** One line of the timeline: a single call, or a run of same-kind calls folded together. */
export interface RunStep {
  key: string
  entries: EvidenceEntry[]
  text: string
  detail?: string
  status: StepStatus
  reason?: string
  startedAt?: number
  endedAt?: number
  /** Set when the line is a hand-off; its specialist's steps nest under it. */
  delegation?: EvidenceEntry
}

const OBJECTS_MAX = 80

const joinObjects = (objects: string[]): string | undefined => {
  const unique = [...new Set(objects)]
  if (!unique.length) {
    return undefined
  }
  const text = unique.join(', ')
  return text.length > OBJECTS_MAX ? `${text.slice(0, OBJECTS_MAX - 1).trimEnd()}…` : text
}

/** The worst state wins for the folded line: still running, then stopped, then done. */
const groupStatus = (statuses: StepStatus[]): StepStatus => {
  for (const status of ['running', 'paused', 'unfinished'] as const) {
    if (statuses.includes(status)) {
      return status
    }
  }
  return 'done'
}

const minOf = (values: (number | undefined)[]): number | undefined => {
  const defined = values.filter((value): value is number => value !== undefined)
  return defined.length === values.length && defined.length ? Math.min(...defined) : undefined
}

const maxOf = (values: (number | undefined)[]): number | undefined => {
  const defined = values.filter((value): value is number => value !== undefined)
  return defined.length === values.length && defined.length ? Math.max(...defined) : undefined
}

/**
 * The lines of one lane. Consecutive calls of the same kind in the same namespace fold into one
 * line with a count ("Read 3 resources"). Two kinds of call never fold: a hand-off, because its
 * specialist's steps nest under it, and a failure, because a failure folded into "Read 3 resources"
 * is a failure nobody reads.
 */
export const groupSteps = (entries: EvidenceEntry[], ctx: StepContext): RunStep[] => {
  const runs: { entries: EvidenceEntry[]; groupKey?: string }[] = []
  for (const entry of entries) {
    const label = labelStep(entry)
    const groupable = !entry.agent && !entry.failed
    const previous = runs[runs.length - 1]
    if (groupable && previous?.groupKey === label.groupKey) {
      previous.entries.push(entry)
      continue
    }
    runs.push({ entries: [entry], ...(groupable ? { groupKey: label.groupKey } : {}) })
  }
  return runs.map(({ entries: members }) => {
    const [first] = members
    const statuses = members.map((member) => entryStatus(member, ctx))
    const status = members.length === 1 ? statuses[0] : groupStatus(statuses)
    const finished = status === 'done' || status === 'failed'
    const startedAt = minOf(members.map((member) => member.startedAt))
    const endedAt = finished ? maxOf(members.map((member) => member.endedAt)) : undefined
    const base = { entries: members, key: first.id, ...(startedAt === undefined ? {} : { startedAt }), ...(endedAt === undefined ? {} : { endedAt }) }
    if (members.length === 1) {
      const label = labelStep(first)
      return {
        ...base,
        ...(first.agent ? { delegation: first } : {}),
        ...(label.detail ? { detail: label.detail } : {}),
        ...(first.reason ? { reason: first.reason } : {}),
        status,
        text: label.text,
      }
    }
    const labels = members.map(labelStep)
    const [head] = labels
    const detail = [joinObjects(labels.flatMap((label) => (label.object ? [label.object] : []))), head.namespace].filter(Boolean).join(' · ')
    return {
      ...base,
      ...(detail ? { detail } : {}),
      status,
      text: head.noun ? `${head.verb} ${members.length} ${head.noun}` : `${head.text} · ${members.length} times`,
    }
  })
}

/** Counts behind the header and the footer. `children` are specialists' calls, keyed by session. */
export interface RunCounts {
  /** Tool calls — hand-offs excluded, a specialist's own calls included. */
  calls: number
  /** Every line's worth of call, hand-offs and nested calls included ("3 steps"). */
  steps: number
  failed: number
  /** The specialists handed to, in order of first hand-off. */
  agents: string[]
}

export const countRun = (entries: EvidenceEntry[], children: Record<string, EvidenceEntry[]> = {}): RunCounts => {
  const nested = entries.flatMap((entry) => (entry.agent && entry.sessionId ? children[entry.sessionId] ?? [] : []))
  const all = [...entries, ...nested]
  return {
    agents: [...new Set(entries.flatMap((entry) => (entry.agent ? [entry.agent] : [])))],
    calls: all.filter((entry) => !entry.agent).length,
    failed: all.filter((entry) => entry.failed).length,
    steps: all.length,
  }
}

/** The newest moment this turn is known to have heard anything: a step starting or finishing,
 *  answer text arriving, an approval pause. The stall check measures silence from here. */
export const lastEventAt = (message: AgentikoMessage): number => Math.max(
  message.createdAt,
  message.lastEventAt ?? 0,
  message.approvalAt ?? 0,
  ...(message.evidence ?? []).flatMap((entry) => [entry.startedAt ?? 0, entry.endedAt ?? 0]),
)

/** No event for this long and the header says so. */
export const STALL_MS = 120_000

/**
 * A turn that is not streaming but whose last step never returned: reloaded mid-turn, stopped, or
 * cut off. It reads "didn't finish", never as still working. A turn paused for an approval is not
 * one — its open step is waiting on a person.
 */
export const isRunUnfinished = (message: AgentikoMessage): boolean => {
  if (message.streaming || message.approvalAt) {
    return false
  }
  const evidence = message.evidence ?? []
  const last = evidence[evidence.length - 1]
  return Boolean(last && !last.done)
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** A running clock: `0:07`, `2:14`, `1:02:09`. */
export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/** A finished step's duration: tenths under ten seconds (`0.4s`), a clock above. */
export const formatDuration = (ms: number): string =>
  (ms < 10_000 ? `${(Math.max(0, ms) / 1000).toFixed(1)}s` : formatClock(ms))

/** How long ago, for a run that has no live clock: `just now`, `3m ago`, `2h ago`, `4d ago`. */
export const formatAgo = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * The decision recorded for the approval a turn paused on: the provider stamps the turn that resumes
 * it with an `approval` chip ("approved k8s_apply_manifest", "denied …", "timed out — denied …").
 * Undefined when no decision followed — a reload while the card was open.
 */
export const approvalOutcome = (messages: AgentikoMessage[], index: number): string | undefined => {
  for (const message of messages.slice(index + 1)) {
    const chip = message.actions?.find((action) => action.verb === 'approval')
    if (chip) {
      return chip.label
    }
    if (message.approvalAt) {
      return undefined
    }
  }
  return undefined
}

/**
 * The turn a pending approval belongs to: the newest one the provider stamped when it paused. A
 * pause always arrives on a turn's own stream, so the stamp is there; the last assistant turn is
 * the fallback only so that a pause can never be left with nowhere to render its Approve/Deny.
 */
export const approvalOwnerId = (messages: AgentikoMessage[]): string | undefined => {
  const newestFirst = [...messages].reverse()
  return (newestFirst.find((message) => message.approvalAt) ?? newestFirst.find((message) => message.role === 'assistant'))?.id
}
