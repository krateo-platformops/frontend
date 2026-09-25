/**
 * A Preview's answer, in the person's words. Pure.
 *
 * ONLY THE SIGNALS THAT EXIST. The mockup's preview screen (11) shows a verdict of four gate checks —
 * helm lint, schema validation, kube-linter, a server dry run. That verdict is the agent gate's, and
 * the portal cannot see it yet; inventing it here would be pills that say "passed" about checks
 * nobody ran. What the portal does know is the LINT (it refuses before anything is sent) and the
 * RENDER (the blueprint-render RESTAction's answer), so the outcome says exactly those.
 */
import type { DraftRenderResultDetail } from '../../components/Autopilot/previewDraftRender'

import { counted } from './architectureView'

export interface OutcomeCopy {
  type: 'success' | 'info' | 'warning' | 'error'
  title: string
  /** Lines under the title — the lint problems of a refusal. */
  lines?: string[]
}

/** The stale answer, verbatim across every surface that reports it. */
export const STALE_OUTCOME = 'The chart changed while it rendered — preview again.'

const COPY: Record<DraftRenderResultDetail['outcome'], (detail: DraftRenderResultDetail) => OutcomeCopy> = {
  failed: (detail) => ({
    title: `${detail.message ?? 'The chart did not render, so it cannot be published yet.'} The render error is in Source.`,
    type: 'error',
  }),
  refused: (detail) => ({
    lines: detail.problems,
    title: detail.message ?? 'Nothing was sent to the cluster.',
    type: 'warning',
  }),
  rendered: (detail) => ({
    title: `Rendered ${counted(detail.payload?.objects?.length ?? 0, 'object')} — read them in Source. Publish is on until the chart changes.`,
    type: 'success',
  }),
  stale: () => ({ title: STALE_OUTCOME, type: 'info' }),
  unavailable: (detail) => ({
    title: detail.message ?? 'This portal cannot render charts, so the chart cannot be previewed here. It is still held.',
    type: 'warning',
  }),
}

export const renderOutcomeCopy = (detail: DraftRenderResultDetail): OutcomeCopy => COPY[detail.outcome](detail)
