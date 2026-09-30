/**
 * The provider's half of the claim check (claimCheck.ts): it WATCHES what a turn does, and after
 * `finalize` stamps any claim the turn did not back on the assistant message.
 *
 * Watching, not instrumenting. Every portal action a turn runs goes through the bridge's `apply` —
 * the preview verbs, the compose and chart verbs, and the publish/applyResourceSet write sets alike —
 * so `track(apply)` hands `finalize` an `apply` that also records each chip it returned (on itself,
 * so a turn that returns early through a trampoline leaves nothing behind).
 * What `finalize` produces WITHOUT calling `apply` is read off the chips after the fact: a host-side
 * denial (the preview gates, the publish compile) and a prefillForm draft. A proposal the one-action
 * cap left out arrived but never ran (`dropped`); a HITL continuation's decision is noted by
 * `noteDecision`, because an approved write tool is what makes that turn's "I applied it" true.
 *
 * Retry is here too: a hidden re-ask (no user bubble — the person did not type the nudge), at most
 * once per flagged reply, and only for a claim with nothing behind it (`isRetryable`).
 */
import { useCallback, useRef } from 'react'
import type { MutableRefObject } from 'react'

import type { PortalActionProposal } from './actionBridge'
import type { ActionOutcome, TurnAction } from './claimCheck'
import { checkClaims, chipOutcome, claimRetryNudge, denialOutcome, isRetryable } from './claimCheck'
import { recordUnbackedClaims } from './claimTelemetry'
import type { AutopilotActionChip, AutopilotMessage, EvidenceEntry, TurnModality } from './types'

/** What the rail can do about a flagged reply. */
export interface ClaimRetryApi {
  /** The claim notice's Retry: re-ask, once, for the action a reply claimed but never emitted. */
  retryClaims: (messageId: string) => void
}

type Apply<Rest extends unknown[]> = (proposal: PortalActionProposal, ...rest: Rest) => Promise<AutopilotActionChip | null>
type Tracked = { chip: AutopilotActionChip | null; outcome: ActionOutcome; verb: string }[]
/** A turn's `apply`, carrying the record of what it ran — so the record lives and dies with the turn. */
export type TrackedApply<Rest extends unknown[]> = Apply<Rest> & { ran: Tracked }

/** A chip `apply` returned, as an outcome. A null from a write set is A18's sliver — a scoping reject
 * OR the person declining the blast-radius confirm; either way nothing landed, and `declined` is the
 * kinder reading (the notice then says "was not confirmed"). */
export const appliedOutcome = (verb: string, chip: AutopilotActionChip | null): ActionOutcome => {
  if (!chip) {
    return verb === 'applyResourceSet' ? 'declined' : 'refused'
  }
  return chipOutcome(chip)
}

/** Everything a finalized turn did, in one list — the kernel's second argument. */
export const collectTurnActions = ({ chips, decision, proposals, toRun, tracked }: {
  chips: readonly AutopilotActionChip[]
  decision?: 'approve' | 'reject'
  proposals: readonly PortalActionProposal[]
  toRun: readonly PortalActionProposal[]
  tracked: Readonly<Tracked>
}): TurnAction[] => {
  const seen = new Set(tracked.map((entry) => entry.chip))
  const untracked = chips.filter((chip) => !seen.has(chip)).flatMap((chip): TurnAction[] => {
    if (chip.verb === 'prefillForm') { return [{ outcome: 'applied', verb: 'prefillForm' }] }
    // finalize's own denial chips (preview gates, publish compile) never reached `apply`.
    if (chip.verb === 'applyResourceSet') { return [{ outcome: denialOutcome(chip.label), verb: 'applyResourceSet' }] }
    return []
  })
  return [
    ...tracked.map(({ outcome, verb }) => ({ outcome, verb })),
    ...untracked,
    ...proposals.filter((proposal) => !toRun.includes(proposal)).map((proposal): TurnAction => ({ outcome: 'dropped', verb: proposal.verb })),
    ...(decision ? [{ outcome: decision === 'approve' ? 'applied' : 'declined', verb: 'approval' } as TurnAction] : []),
  ]
}

interface Deps {
  messages: AutopilotMessage[]
  sendRef: MutableRefObject<((text: string, opts?: { modality?: TurnModality; recovery?: boolean }) => void) | undefined>
  sessionId: string
  setMessages: (updater: (prev: AutopilotMessage[]) => AutopilotMessage[]) => void
  streaming: boolean
}

export const useClaimCheck = ({ messages, sendRef, sessionId, setMessages, streaming }: Deps) => {
  const decisionsRef = useRef(new Map<string, 'approve' | 'reject'>())

  const track = useCallback(<Rest extends unknown[]>(apply: Apply<Rest>): TrackedApply<Rest> => {
    const ran: Tracked = []
    const tracked = async (proposal: PortalActionProposal, ...rest: Rest) => {
      const chip = await apply(proposal, ...rest)
      ran.push({ chip, outcome: appliedOutcome(proposal.verb, chip), verb: proposal.verb })
      return chip
    }
    return Object.assign(tracked, { ran })
  }, [])

  const noteDecision = useCallback((assistantId: string, decision: 'approve' | 'reject') => {
    decisionsRef.current.set(assistantId, decision)
  }, [])

  /** After finalize: the reply's claims against the turn's record. The TEXT is never touched. */
  const flag = useCallback((assistantId: string, text: string, turn: { applied: { ran: Tracked }; chips: AutopilotActionChip[]; evidence: EvidenceEntry[]; proposals: PortalActionProposal[]; toRun: PortalActionProposal[] }) => {
    const actions = collectTurnActions({ ...turn, decision: decisionsRef.current.get(assistantId), tracked: turn.applied.ran })
    decisionsRef.current.delete(assistantId)
    const claims = checkClaims(text, actions, turn.evidence)
    if (!claims.length) {
      return
    }
    setMessages((prev) => prev.map((message) => (message.id === assistantId ? { ...message, claims } : message)))
    recordUnbackedClaims(claims, sessionId)
  }, [sessionId, setMessages])

  const retryClaims = useCallback((messageId: string) => {
    const message = messages.find((candidate) => candidate.id === messageId)
    const retryable = message?.claims?.filter(isRetryable) ?? []
    // A recovery send is allowed mid-stream (the trampolines need that), so the guard is here.
    if (streaming || !message || message.claimRetried || !retryable.length) {
      return
    }
    setMessages((prev) => prev.map((candidate) => (candidate.id === messageId ? { ...candidate, claimRetried: true } : candidate)))
    // Recovery: no user bubble, and the person's audited prompt (lastUserTextRef) stays theirs.
    sendRef.current?.(claimRetryNudge(retryable), { modality: 'text', recovery: true })
  }, [messages, sendRef, setMessages, streaming])

  return { flag, noteDecision, retryClaims, track }
}
