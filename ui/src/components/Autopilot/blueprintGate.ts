/**
 * W4 BLUEPRINT-BUILDER (FE-BP2) — the blueprint PREVIEW GATE.
 *
 * THE RULE (the blueprint analogue of the KOG previewGate, see previewGate.ts): an
 * `applyResourceSet` that writes a blueprint PUBLISH resource — a git-write CR
 * (`gitrefs` / `repocontents` / `pullrequests` on github.krateo.io) or the REGISTER
 * `compositiondefinitions` (core.krateo.io) — is DENIED unless a `previewBlueprint`
 * of the SAME chart happened earlier in the SAME thread. This enforces
 * preview-before-publish deterministically on the host: the prompt teaches the
 * workflow, but prompts decay across a thread — the gate does not.
 *
 * WHY MATCH ON THE HELD DRAFT'S CHART NAME (not an in-payload identity like the KOG
 * gate does): a RestDefinition CR carries its own {kind, resourceGroup} identity in
 * its payload, but a blueprint publish is a heterogeneous set (git CRs + a
 * CompositionDefinition) whose payloads do NOT carry the Chart.yaml name in a single
 * reliable field. The held draft (blueprintDraftStore, FE-BP1) IS the source of the
 * published bytes, so its Chart.yaml name (blueprintDraft.draftDisplayName) is the
 * authoritative identity of what is being published. Matching the previewed name
 * against the currently-held draft therefore also guarantees published == previewed.
 *
 * Owned by AutopilotProvider (thread-scoped), evaluated BEFORE dispatch alongside the
 * KOG previewGate; reset on newThread. A denial produces the standard denied chip
 * (nothing dispatched). Defense-in-depth ON TOP of the blast-radius confirm.
 *
 * NOTE ON SCOPE: `compositiondefinitions` is also how a normal marketplace Install
 * writes — but that path is the FORM dispatcher (runRestSet via a Form action), which
 * never flows through AutopilotProvider.finalize, so this gate never sees it. In the
 * Autopilot applyResourceSet path a `compositiondefinitions` write IS a blueprint
 * register, so guarding it here is correct.
 *
 * Pure module: a tiny factory + pure detection. No React, no module state.
 */

import type { ApplyResourceSetOp } from './applyResourceSet'

/**
 * The op resources a blueprint publish writes — any set touching one is a publish:
 *   - compositiondefinitions (core.krateo.io) — the REGISTER write
 *   - gitrefs / repocontents / pullrequests (github.krateo.io) — the git-write set
 *     (builder branch, one RepoContent per chart file, the PR).
 */
export const BLUEPRINT_PUBLISH_RESOURCES: readonly string[] = [
  'compositiondefinitions',
  'gitrefs',
  'repocontents',
  'pullrequests',
  // The SCM-agnostic path (AUTOPILOT_PUBLISH_VIA_GIT_PROVIDER): one BuilderPublish claim replaces
  // the git-write set, so the gate must arm on it too — preview-before-publish holds either way.
  'builderpublishes',
]

/** True iff any op in the set writes a blueprint-publish resource (so the gate applies). */
export const opsArePublishSet = (ops: readonly ApplyResourceSetOp[] | undefined): boolean =>
  (ops ?? []).some((op) => BLUEPRINT_PUBLISH_RESOURCES.includes(op?.gvr?.resource ?? ''))

/** The gate's evaluation of one op set: allowed, or denied with the chip message. */
export type BlueprintGateVerdict =
  | { allowed: true }
  | { allowed: false; reason: string }

export interface BlueprintGate {
  /** Record a successfully previewed draft's chart name (called after previewBlueprint applies). */
  recordPreview: (chartName: string | null | undefined) => void
  /**
   * Evaluate an applyResourceSet's ops BEFORE dispatch. Sets that touch no
   * blueprint-publish resource always pass. A publish set passes ONLY when the
   * currently-held draft's chart name was previewed this thread.
   */
  evaluate: (
    ops: readonly ApplyResourceSetOp[] | undefined,
    heldChartName: string | null | undefined,
  ) => BlueprintGateVerdict
  /** Thread reset (newThread): every recorded preview is forgotten — deny again. */
  reset: () => void
}

/** The standard "preview first" denial copy (the chip label). */
export const blueprintPreviewFirstMessage = (chartName: string | null): string => (chartName
  ? `denied — preview first: run previewBlueprint for "${chartName}" before publishing it`
  : 'denied — preview first: no held blueprint draft to match a previewBlueprint against (draft + preview the chart before publishing)')

/**
 * Create a thread-scoped blueprint preview gate. Previews ACCUMULATE within a thread
 * (iterating on a draft re-previews the same chart name; previewing two charts allows
 * either) and are all forgotten on reset().
 */
export const createBlueprintGate = (): BlueprintGate => {
  let previewed = new Set<string>()
  return {
    evaluate: (ops, heldChartName) => {
      if (!opsArePublishSet(ops)) {
        return { allowed: true }
      }
      const name = typeof heldChartName === 'string' && heldChartName ? heldChartName : null
      if (!name || !previewed.has(name)) {
        return { allowed: false, reason: blueprintPreviewFirstMessage(name) }
      }
      return { allowed: true }
    },
    recordPreview: (chartName) => {
      if (typeof chartName === 'string' && chartName) {
        previewed.add(chartName)
      }
    },
    reset: () => {
      previewed = new Set<string>()
    },
  }
}
