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
 *     installs: that is a browser fetch outside /call, which builder surfaces must not make. A
 *     CONTROLLER renders the same way through its Builder's `controller-render-draft` (T9,
 *     frontend#413; pages/ControllerComposer/controllerRender.ts), and has no fallback at all.
 *   - A controller START with no Kind placed renders nothing — there is nothing to generate yet — and
 *     says what to do next instead of sending an empty draft to be refused.
 *   - A render ARMS only on success, and only if the draft is still the one it rendered — an edit that
 *     lands while the request is on the wire makes the result stale, and nothing is armed.
 *   - Every outcome is answered, by id, on the render-result bus; nothing opens the drawer. The
 *     surface that asked shows the result itself — a drawer opening over the composer is the failure
 *     the kind-aware preview claim exists to prevent.
 */
import { useCallback, useEffect } from 'react'

import { findBuilderOf } from '../../builders/builderRegistry'
import type { Config } from '../../context/ConfigContext'
import { readController } from '../../pages/ControllerComposer/controllerChart'
import { controllerPreviewPayload } from '../../pages/ControllerComposer/controllerPreviewPayload'
import { renderController } from '../../pages/ControllerComposer/controllerRender'

import { draftDisplayName } from './blueprintDraft'
import type { BlueprintDraftHeld, BlueprintDraftStore } from './blueprintDraftStore'
import type { BlueprintGate } from './blueprintGate'
import { buildBlueprintPreviewPayload } from './blueprintPreviewPayload'
import { renderBlueprint, type SandboxWriter } from './blueprintRenderSandbox'
import { clearComposeRefusals } from './composeRequest'
import { draftHistory } from './draftHistory'
import { type DraftRenderResultDetail, emitDraftRenderResult, onChartStart, onDraftRenderRequest } from './previewDraftRender'
import { lintHeldDraft } from './proposedChart'
import { heldDraftIdentity } from './publishCompile'
import type { DraftAutosave } from './useDraftAutosave'

/**
 * A controller renders through the RESTAction its Builder names (controller-render-draft, portal#277)
 * over snowplow /call, from a ConfigMap written into the preview sandbox — so it needs all three. An
 * install missing any of them says so, and nothing is armed.
 */
export const CONTROLLER_RENDER_NOT_CONFIGURED = 'This portal has no controller preview configured (the controller-render-draft RESTAction needs the snowplow URL, the frontend namespace and the preview sandbox), so the controller cannot be previewed here. It is still held; Publish stays off.'

/** The answer to a controller start with no Kind yet: held, and what Preview needs first. */
export const CONTROLLER_STARTED = 'The controller is held and saved as you edit it. Place a Kind from the palette, then press Preview — oasgen-render generates its CRD. Publish stays off until a preview has rendered the controller.'

export const CONTROLLER_RENDER_FAILED = 'The controller did not render, so it cannot be published yet.'

export const RENDER_NOT_CONFIGURED = 'This portal has no chart render configured (the blueprint-render RESTAction needs the snowplow URL and the frontend namespace), so the chart cannot be previewed here. It is still held.'

export const useBlueprintAuthoringBuses = (
  store: BlueprintDraftStore,
  gate: Pick<BlueprintGate, 'forget' | 'recordPreview'>,
  config: Config | undefined,
  sandboxWriter?: SandboxWriter,
  /**
   * The draft-record autosave: flushed BEFORE the render writes anything (write-ahead — a tab killed
   * mid-Preview has already stored the chart), and told of a render that succeeded so the record
   * carries the hash Publish re-arms on after a Resume. Optional: absent, Preview is unchanged.
   * RESUME calls `seedFromRecord(body)` on it immediately before `store.set(body.files, body.kind)`,
   * so the record's renderedHash/state/publish/threadId survive the resume's first save.
   */
  autosave?: Pick<DraftAutosave, 'flush' | 'markRendered' | 'seedFromRecord'>,
): void => {
  /**
   * THE CONTROLLER'S PREVIEW (T9, frontend#413) — the same rules as a chart's: lint first, write-ahead
   * flush, the render over /call as the person, stale if the draft moved, and ARMED only by a positive
   * render with zero problems. The render is controllerRender.ts's: draft.json into the sandbox, the
   * Builder's preview RESTAction by name, the ConfigMap deleted. Every other answer forgets the arming.
   */
  const renderHeldController = useCallback(async (held: BlueprintDraftHeld, answer: (detail: Omit<DraftRenderResultDetail, 'id'>) => void): Promise<void> => {
    const snowplowBaseUrl = config?.api.SNOWPLOW_API_BASE_URL
    const frontendNamespace = config?.params.FRONTEND_NAMESPACE
    const identity = heldDraftIdentity(held)
    const problems = lintHeldDraft(held.files, held.kind)
    if (problems.length) {
      gate.forget(identity)
      answer({ message: 'Fix these before previewing — nothing was sent to the cluster.', outcome: 'refused', problems })
      return
    }
    const restActionRef = findBuilderOf(held.kind)?.preview.restActionRef
    if (!snowplowBaseUrl || !frontendNamespace || !sandboxWriter || !restActionRef) {
      gate.forget(identity)
      answer({ message: CONTROLLER_RENDER_NOT_CONFIGURED, outcome: 'unavailable' })
      return
    }
    await autosave?.flush()
    const model = readController(held.files)
    const name = model.name ?? draftDisplayName(held.files)
    const verdict = await renderController(
      held.files,
      { namespace: restActionRef.namespace ?? frontendNamespace, restAction: restActionRef.name, snowplowBaseUrl },
      sandboxWriter,
      name,
    )
    if (store.get() !== held) {
      answer({ message: 'The controller changed while it was rendering — preview it again.', outcome: 'stale' })
      return
    }
    if (verdict.outcome === 'refused') {
      gate.forget(identity)
      answer({ message: verdict.message, outcome: 'refused', problems: verdict.problems })
      return
    }
    if (verdict.outcome === 'unavailable') {
      gate.forget(identity)
      answer({ message: verdict.message, outcome: 'unavailable' })
      return
    }
    const payload = controllerPreviewPayload(held.files, model, name, {
      files: held.files,
      objects: verdict.render.objects,
      ...(verdict.render.problems.length ? { problems: verdict.render.problems } : {}),
      ...(verdict.render.warnings.length ? { renderedWarnings: verdict.render.warnings } : {}),
    })
    if (verdict.outcome === 'failed') {
      gate.forget(identity)
      answer({ message: CONTROLLER_RENDER_FAILED, outcome: 'failed', payload, problems: verdict.render.problems })
      return
    }
    gate.recordPreview(identity)
    void autosave?.markRendered(held)
    answer({ message: null, outcome: 'rendered', payload })
  }, [autosave, config, gate, sandboxWriter, store])

  const render = useCallback(async (id: string): Promise<void> => {
    // Read at request time, not at mount: the provider mounts before the config is complete.
    const snowplowBaseUrl = config?.api.SNOWPLOW_API_BASE_URL
    const frontendNamespace = config?.params.FRONTEND_NAMESPACE
    const answer = (detail: Omit<DraftRenderResultDetail, 'id'>): void => emitDraftRenderResult({ id, ...detail })
    const held = store.get()
    if (held?.kind === 'controller') {
      await renderHeldController(held, answer)
      return
    }
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
    await autosave?.flush()
    const rendered = await renderBlueprint(snowplowBaseUrl, frontendNamespace, { rawTemplates: held.files }, sandboxWriter)
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
    void autosave?.markRendered(held)
    answer({ message: null, outcome: 'rendered', payload })
  }, [autosave, config, gate, renderHeldController, sandboxWriter, store])

  useEffect(() => onDraftRenderRequest(({ id }) => { void render(id) }), [render])

  useEffect(() => onChartStart(({ files, id, kind = 'blueprint' }) => {
    if (store.get()) {
      emitDraftRenderResult({ id, message: 'A draft is already open in this thread — discard it before starting another.', outcome: 'refused' })
      return
    }
    // A new chart is not answerable for the last draft's refusals or undo steps — nor for an arming
    // some earlier chart earned under the same name: a start never arms.
    clearComposeRefusals()
    draftHistory.clear()
    gate.forget(draftDisplayName(files))
    const set = store.set(files, kind)
    if (!set.ok) {
      emitDraftRenderResult({ id, message: set.error, outcome: 'refused' })
      return
    }
    if (kind === 'controller' && !readController(files).kinds.length) {
      emitDraftRenderResult({ id, message: CONTROLLER_STARTED, outcome: 'unavailable' })
      return
    }
    void render(id)
  }), [gate, render, store])
}
