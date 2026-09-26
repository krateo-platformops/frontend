/**
 * The provider's answers to a person authoring a chart: START a chart, and RENDER the held chart.
 *
 * The rules, each a defect it closes:
 *   - A start HOLDS the tree before anything is rendered and never arms it. Seeding through the
 *     render (as the agent's path does) would lose the person's chart whenever the render failed or
 *     the render service was not configured.
 *   - A start is REFUSED while a draft is held, and says so — seeding over one discards unpublished
 *     work, and a silent refusal reads as a dead button.
 *   - A render LINTS FIRST: a lint-dirty chart sends nothing anywhere and is disarmed.
 *   - A render goes through the `blueprint-render` RESTAction over snowplow /call ONLY, under the
 *     person's own credential. Never the direct render-service fallback the agent's verb keeps for old
 *     installs: that is a browser fetch outside /call, which builder surfaces must not make.
 *   - A render ARMS only on success, and only if the draft is still the one it rendered — an edit that
 *     lands while the request is on the wire makes the result stale, and nothing is armed.
 *   - Every outcome is answered, by id, on the render-result bus; nothing opens the drawer. The
 *     surface that asked shows the result itself — a drawer opening over the composer is the failure
 *     the kind-aware preview claim exists to prevent.
 */
import { useCallback, useEffect } from 'react'

import type { Config } from '../../context/ConfigContext'

import { draftDisplayName } from './blueprintDraft'
import type { BlueprintDraftStore } from './blueprintDraftStore'
import type { BlueprintGate } from './blueprintGate'
import { buildBlueprintPreviewPayload } from './blueprintPreviewPayload'
import { clearComposeRefusals } from './composeRequest'
import { draftHistory } from './draftHistory'
import { callBlueprintRenderRA } from './previewBridge'
import { type DraftRenderResultDetail, emitDraftRenderResult, onChartStart, onDraftRenderRequest } from './previewDraftRender'
import { lintHeldDraft } from './proposedChart'
import { heldDraftIdentity } from './publishCompile'

export const RENDER_NOT_CONFIGURED = 'This portal has no chart render configured (the blueprint-render RESTAction needs the snowplow URL and the frontend namespace), so the chart cannot be previewed here. It is still held.'

export const useBlueprintAuthoringBuses = (
  store: BlueprintDraftStore,
  gate: Pick<BlueprintGate, 'forget' | 'recordPreview'>,
  config: Config | undefined,
): void => {
  const render = useCallback(async (id: string): Promise<void> => {
    // Read at request time, not at mount: the provider mounts before the config is complete.
    const snowplowBaseUrl = config?.api.SNOWPLOW_API_BASE_URL
    const frontendNamespace = config?.params.FRONTEND_NAMESPACE
    const answer = (detail: Omit<DraftRenderResultDetail, 'id'>): void => emitDraftRenderResult({ id, ...detail })
    const held = store.get()
    if (!held || held.kind !== 'blueprint') {
      answer({ message: 'No chart draft is open to preview.', outcome: 'refused' })
      return
    }
    const identity = heldDraftIdentity(held)
    const problems = lintHeldDraft(held.files, held.kind)
    if (problems.length) {
      gate.forget(identity)
      answer({ message: 'Fix these files before previewing — nothing was sent to the cluster.', outcome: 'refused', problems })
      return
    }
    if (!snowplowBaseUrl || !frontendNamespace) {
      gate.forget(identity)
      answer({ message: RENDER_NOT_CONFIGURED, outcome: 'unavailable' })
      return
    }
    const rendered = await callBlueprintRenderRA(snowplowBaseUrl, frontendNamespace, { rawTemplates: held.files })
    if (store.get() !== held) {
      answer({ message: 'The chart changed while it was rendering — preview it again.', outcome: 'stale' })
      return
    }
    const payload = buildBlueprintPreviewPayload({ held: true, name: draftDisplayName(held.files), rawTemplates: held.files, rendered })
    if (rendered.error) {
      gate.forget(identity)
      answer({ message: 'The chart did not render, so it cannot be published yet.', outcome: 'failed', payload })
      return
    }
    gate.recordPreview(identity)
    answer({ message: null, outcome: 'rendered', payload })
  }, [config, gate, store])

  useEffect(() => onDraftRenderRequest(({ id }) => { void render(id) }), [render])

  useEffect(() => onChartStart(({ files, id }) => {
    if (store.get()) {
      emitDraftRenderResult({ id, message: 'A draft is already open in this thread — discard it before starting another.', outcome: 'refused' })
      return
    }
    // A new chart is not answerable for the last draft's refusals or undo steps — nor for an arming
    // some earlier chart earned under the same name: a start never arms.
    clearComposeRefusals()
    draftHistory.clear()
    gate.forget(draftDisplayName(files))
    const set = store.set(files, 'blueprint')
    if (!set.ok) {
      emitDraftRenderResult({ id, message: set.error, outcome: 'refused' })
      return
    }
    void render(id)
  }), [gate, render, store])
}
