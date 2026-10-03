/**
 * PREVIEW-DATA TRAMPOLINE (frontend#442 D10, autopilot#147) — the provider half of previewRender.ts.
 *
 * After a LIVE previewPage of a page a specialist authored, the render is read back once it has
 * settled: the chip under the previewing turn says what it showed, the page context carries it
 * (`previewRender`), and a render with problems — a widget that failed to load, an empty table or
 * chart, a chart missing the field it plots — runs ONE hidden follow-up turn naming them, so the
 * agent sends them back to the specialist and previews again. The loop is bounded per user request
 * (createPreviewDataLoop: at most MAX_PREVIEW_FOLLOW_UPS, and it stops on the same problems twice).
 *
 * The check is detached from finalize: the render takes seconds and the turn's answer is complete.
 * It drives nothing itself — the follow-up is a turn like the other trampolines', and every write it
 * leads to is the agent's next preview, through the same UI verb.
 */

import { type MutableRefObject, useCallback, useRef } from 'react'

import { getUserInfo } from '../../utils/getUserInfo'

import { draftOwner } from './draftRecord'
import { setPreviewRender } from './previewBus'
import {
  awaitSettledPreview,
  createPreviewDataLoop,
  endpointParams,
  previewFollowUpPrompt,
  previewRenderChipLabel,
  previewWidgetNames,
  problemLine,
  type RenderedWidgetState,
  summarizePreviewRender,
} from './previewRender'
import { redactValue } from './redact'
import type { AutopilotMessage, EvidenceEntry, TurnModality } from './types'

type Send = (text: string, opts?: { modality?: TurnModality; recovery?: boolean }) => void

interface PreviewDataLoopDeps {
  readRenderedWidgets: () => RenderedWidgetState[]
  /** The sandbox the live preview renders in; absent, there is no live preview to read. */
  sandboxNamespace: string | undefined
  sendRef: MutableRefObject<Send | undefined>
  setMessages: (update: (prev: AutopilotMessage[]) => AutopilotMessage[]) => void
}

export const usePreviewDataLoop = ({ readRenderedWidgets, sandboxNamespace, sendRef, setMessages }: PreviewDataLoopDeps) => {
  const loopRef = useRef(createPreviewDataLoop())
  // Counts REAL user turns: a check that settles after the person has moved on drops its follow-up.
  const userTurnRef = useRef(0)
  // Whether this request delegated — the previewed page is then a specialist's.
  const delegatedRef = useRef(false)

  /** A new request (or thread): a fresh budget, and a pending check no longer speaks for it. */
  const reset = useCallback(() => {
    userTurnRef.current += 1
    loopRef.current.reset()
    delegatedRef.current = false
  }, [])

  /**
   * Every finalized turn of the request, the follow-ups included, reports its evidence here BEFORE it
   * runs its actions, and gets back the request it belongs to: applying a preview takes seconds, and
   * the person may have asked something else by the time it is live.
   */
  const beginRun = useCallback((evidence: readonly EvidenceEntry[]): number => {
    if (evidence.some((entry) => entry.kind === 'delegation')) {
      delegatedRef.current = true
    }
    return userTurnRef.current
  }, [])

  /**
   * A previewPage went live in turn `assistantId`, of the request `userTurn` (beginRun); `since` is
   * when that turn's actions began.
   */
  const checkLivePreview = useCallback((assistantId: string, userTurn: number, widgets: Record<string, unknown>[], since: number, modality: TurnModality) => {
    if (!sandboxNamespace || userTurnRef.current !== userTurn || !delegatedRef.current) {
      return
    }
    const names = previewWidgetNames(widgets, draftOwner(getUserInfo().username))
    const isPreviewWidget = ({ endpoint }: RenderedWidgetState) => {
      const { name, namespace } = endpointParams(endpoint)
      return namespace === sandboxNamespace && name !== undefined && names.has(name)
    }
    void (async () => {
      const { states, timedOut } = await awaitSettledPreview(readRenderedWidgets, isPreviewWidget, { since })
      if (userTurnRef.current !== userTurn) {
        return
      }
      const summary = summarizePreviewRender(states, names, sandboxNamespace, timedOut)
      setPreviewRender({ problems: summary.problems.map(problemLine), rendered: summary.rendered })
      setMessages((prev) => prev.map((message) => (
        message.id === assistantId
          ? { ...message, actions: [...(message.actions ?? []), { label: previewRenderChipLabel(summary), readOnly: true, verb: 'previewPage' }] }
          : message
      )))
      const step = loopRef.current.next(summary.problems)
      if (step) {
        // The follow-up is typed text, not the envelope, so it is scrubbed here: a RESTAction's
        // error can quote whatever its request carried.
        sendRef.current?.(redactValue(previewFollowUpPrompt(summary, step)) as string, { modality, recovery: true })
      }
    })()
  }, [readRenderedWidgets, sandboxNamespace, sendRef, setMessages])

  return { beginRun, checkLivePreview, reset }
}
