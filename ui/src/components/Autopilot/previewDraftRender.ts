/**
 * A PERSON starting a chart, and a person asking for the held chart to be rendered.
 *
 * WHY TWO BUSES THE AGENT DOES NOT USE. Until now a chart could be held and armed only through the
 * model: previewBlueprint ran inside the agent's turn and the provider held and armed what it
 * rendered. The Blueprint Composer is a person authoring a chart, so it needs the same two steps
 * without a model in the loop — start (hold a new tree) and preview (render what is held, and arm it
 * only if the render succeeded). Same idiom as the publish bus: the surface emits a request with a
 * correlation id, the provider does the work, and one result answers it.
 *
 * START NEVER ARMS, AND HOLDING NEVER DEPENDS ON THE RENDER. A start holds the tree first, then asks
 * for a render. A render that fails — or a render service that is not configured — leaves the
 * person's chart held and unarmed, never lost.
 */
import type { AutopilotPreviewPayload } from './previewBus'

export const AUTOPILOT_CHART_START_EVENT = 'autopilotChartStart'
export const AUTOPILOT_DRAFT_RENDER_REQUEST_EVENT = 'autopilotDraftRenderRequest'
export const AUTOPILOT_DRAFT_RENDER_RESULT_EVENT = 'autopilotDraftRenderResult'

/** Start a chart draft from these files (the composer's Start). Answered by a render result with the same id. */
export interface ChartStartDetail {
  id: string
  files: Record<string, string>
}

/** Render the held chart draft (the composer's Preview). Answered by a render result with the same id. */
export interface DraftRenderRequestDetail {
  id: string
}

/**
 * What happened, for the surface that asked — the only one that acts on it.
 *   rendered    — the chart rendered and is armed to publish
 *   failed      — it did not render; the payload carries the error; nothing is armed
 *   refused     — nothing was sent: no chart is held, a draft is already open, or the lint failed
 *   stale       — the draft changed while it rendered; nothing is armed, preview again
 *   unavailable — this install has no render transport; the chart stays held and unarmed
 */
export interface DraftRenderResultDetail {
  id: string
  outcome: 'rendered' | 'failed' | 'refused' | 'stale' | 'unavailable'
  /** Why, in the person's words. Null when the chart rendered. */
  message: string | null
  /** The lint problems behind a refusal, one line each. */
  problems?: string[]
  /** The preview to show — the held tree plus its render (rendered) or its error (failed). */
  payload?: AutopilotPreviewPayload
}

const on = <T extends { id: string }>(event: string, handler: (detail: T) => void): (() => void) => {
  const listener = (raw: Event): void => {
    const { detail } = raw as CustomEvent<T>
    if (detail && typeof detail.id === 'string') {
      handler(detail)
    }
  }
  window.addEventListener(event, listener)
  return () => window.removeEventListener(event, listener)
}

export const emitChartStart = (detail: ChartStartDetail): void => {
  window.dispatchEvent(new CustomEvent<ChartStartDetail>(AUTOPILOT_CHART_START_EVENT, { detail }))
}
export const onChartStart = (handler: (detail: ChartStartDetail) => void): (() => void) => on(AUTOPILOT_CHART_START_EVENT, handler)

export const emitDraftRenderRequest = (detail: DraftRenderRequestDetail): void => {
  window.dispatchEvent(new CustomEvent<DraftRenderRequestDetail>(AUTOPILOT_DRAFT_RENDER_REQUEST_EVENT, { detail }))
}
export const onDraftRenderRequest = (handler: (detail: DraftRenderRequestDetail) => void): (() => void) =>
  on(AUTOPILOT_DRAFT_RENDER_REQUEST_EVENT, handler)

export const emitDraftRenderResult = (detail: DraftRenderResultDetail): void => {
  window.dispatchEvent(new CustomEvent<DraftRenderResultDetail>(AUTOPILOT_DRAFT_RENDER_RESULT_EVENT, { detail }))
}
export const onDraftRenderResult = (handler: (detail: DraftRenderResultDetail) => void): (() => void) =>
  on(AUTOPILOT_DRAFT_RENDER_RESULT_EVENT, handler)
