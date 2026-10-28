/**
 * The composer's two questions to the provider — START this chart, PREVIEW the held one — and
 * what came back.
 *
 * THE PROVIDER DOES THE WORK; THIS ONLY ASKS AND LISTENS. Both go out on the S3a buses with a
 * correlation id and are answered, by id, on the one render-result bus. The composer fetches
 * nothing itself: the render is the `blueprint-render` RESTAction over snowplow `/call` under the
 * person's own credential, run by the provider, and a lint-dirty chart is refused before anything
 * leaves the browser. An answer that is not to OUR latest question is ignored — another surface's,
 * or an older question of ours overtaken by a newer one.
 *
 * WHAT A START'S ANSWER MEANS. A start holds the chart before it renders it, so every outcome but
 * `refused` means the chart IS held (the draft broadcast shows it) and the answer is its first
 * preview. A refusal held nothing — a draft was already open, or the tree broke a cap — and belongs
 * to the Start modal, where the person can act on it.
 *
 * THE LAST RENDER is what the Source tab shows: the objects (or the error) of the most recent
 * preview of the held chart, whoever asked for it. The agent's previewBlueprint of the held draft
 * arrives on the preview bus instead, and the composer hands it to `adopt` — the drawer defers that
 * preview to this page while it is mounted, so if this page did not show it nobody would. The agent's
 * previewRestDef of a held controller arrives on the render-result bus under an agent id
 * (AGENT_RENDER_ID_PREFIX), and its render is adopted the same way.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { DraftKind } from '../../components/Autopilot/blueprintDraftStore'
import {
  AGENT_RENDER_ID_PREFIX,
  emitChartStart,
  emitDraftRenderRequest,
  onDraftRenderResult,
  type DraftRenderResultDetail,
} from '../../components/Autopilot/previewDraftRender'

import { lastRenderOf, type LastRender } from './heldBlueprintPayload'

type Question = 'start' | 'preview'

const newId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2)}`

export interface ChartRequests {
  /** What is on the wire, if anything. */
  pending: Question | null
  /** The answer to the last preview (or the non-refused answer to a start), until dismissed. */
  outcome: DraftRenderResultDetail | null
  /** The provider's refusal of the last start. */
  startRefusal: DraftRenderResultDetail | null
  lastRender: LastRender | null
  /** Start a draft of these files — a blueprint chart unless another draft kind is named. */
  start: (files: Record<string, string>, kind?: DraftKind) => void
  preview: () => void
  adopt: (render: LastRender) => void
  dismiss: () => void
  /** Forget everything — the draft was discarded, and none of this describes what is held now. */
  reset: () => void
}

export const useChartRequests = (): ChartRequests => {
  const [pending, setPending] = useState<Question | null>(null)
  const [outcome, setOutcome] = useState<DraftRenderResultDetail | null>(null)
  const [startRefusal, setStartRefusal] = useState<DraftRenderResultDetail | null>(null)
  const [lastRender, setLastRender] = useState<LastRender | null>(null)
  const asked = useRef<{ id: string; question: Question } | null>(null)

  useEffect(() => onDraftRenderResult((detail) => {
    const mine = asked.current
    // The AGENT's preview of the held draft (controllerVerbs.ts) renders the same draft this page
    // shows, so its render is shown too — the Source tab is "the last render of the held draft,
    // whoever asked". Its outcome is the agent's chip, not this page's alert.
    if (detail.id.startsWith(AGENT_RENDER_ID_PREFIX) && detail.payload) {
      setLastRender(lastRenderOf(detail.payload))
      return
    }
    if (!mine || mine.id !== detail.id) {
      return
    }
    asked.current = null
    setPending(null)
    if (mine.question === 'start' && detail.outcome === 'refused') {
      setStartRefusal(detail)
      return
    }
    setOutcome(detail)
    // A refusal, an unavailable render or a stale one carries no payload: the last render stands
    // (and the Source caption says it is old). Rendered and failed replace it.
    if (detail.payload) {
      setLastRender(lastRenderOf(detail.payload))
    }
  }), [])

  const ask = useCallback((question: Question): string => {
    const id = newId()
    asked.current = { id, question }
    setPending(question)
    setOutcome(null)
    return id
  }, [])

  const start = useCallback((files: Record<string, string>, kind?: DraftKind) => {
    setStartRefusal(null)
    emitChartStart({ files, id: ask('start'), ...(kind ? { kind } : {}) })
  }, [ask])

  const preview = useCallback(() => {
    emitDraftRenderRequest({ id: ask('preview') })
  }, [ask])

  const dismiss = useCallback(() => setOutcome(null), [])

  const reset = useCallback(() => {
    asked.current = null
    setPending(null)
    setOutcome(null)
    setStartRefusal(null)
    setLastRender(null)
  }, [])

  return {
    adopt: setLastRender,
    dismiss,
    lastRender,
    outcome,
    pending,
    preview,
    reset,
    start,
    startRefusal,
  }
}
