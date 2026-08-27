/**
 * UI-NATIVE BLUEPRINT BUILDER (item C, blueprint slice) — the publish-wiring seam.
 *
 * This is the blueprint analogue of kogBuilderPublish.ts. Where the KOG builder AUTHORS a
 * RestDefinition from structured fields, the blueprint builder is an IMPORT/publish surface: the
 * user brings their OWN Helm chart tree (via Upload/paste) and this module publishes it VERBATIM
 * through the EXACT same git-write path the Autopilot `publishBlueprint` branch uses. NOTHING here
 * is reimplemented — it only orders the reused pieces and maps their failures to a denial.
 *
 * Two surfaces (mirroring kogBuilderPublish.ts):
 *   1. compileBlueprintBuilderPublish (PURE) — the imported `{path: content}` tree + repo coords →
 *      the ORDERED git-write op set, or a denial. It REUSES the Autopilot machinery in the same
 *      order the `publishBlueprint` branch runs it:
 *        - createBlueprintDraft   → the SAME 512 KiB held-tree cap + empty-tree refusal;
 *        - draftDisplayName       → the SAME Chart.yaml `name:` identity (branch/PR derive from it);
 *        - buildBlueprintPublishOps → the SAME gitref + per-file repocontents + pullrequest fan-out;
 *        - substituteFileContent (base64) → the SAME $fileContent → base64 substitution the publish
 *          pipeline runs (compilePublishOps), so published bytes == the imported bytes;
 *        - isApplySetAllowed      → the SAME defense-in-depth scoping kernel (≤10 ops, Krateo groups).
 *      A blueprint must LOOK like a chart (carry a `Chart.yaml`) — a page tree (no Chart.yaml) is
 *      refused here so it never publishes to the blueprints repo by mistake.
 *   2. useBlueprintBuilderPublish (HOOK) — dispatches the compiled set through the SAME
 *      applyResourceSet → handleActionSet → runRestSet path, so the whole set rides the identical
 *      aggregated blast-radius confirm + git PR (nothing lands live; a human merges). Origin is
 *      `{actor:'human'}` (a hand-imported write, not agent-originated).
 *
 * NOTE ON AUTHORSHIP: like kogBuilderPublish, the UI-native path does NOT run stampAuthorship (which
 * hard-stamps `authored-by: autopilot`) — this is a HUMAN import; the `{actor:'human'}` origin at the
 * runRestSet layer is the correct provenance. The $fileContent substitution IS run (the Autopilot
 * publishBlueprint ops carry tokens, not bytes), so the imported chart lands base64-encoded exactly
 * as GitHub's create-file API requires.
 */

import { useCallback } from 'react'

import { useHandleAction } from '../../hooks/useHandleActions'

import {
  applyResourceSet,
  isApplySetAllowed,
  MAX_APPLY_SET_OPS,
  type ApplyResourceSetChip,
  type ApplyResourceSetOp,
} from './applyResourceSet'
import { draftDisplayName } from './blueprintDraft'
import { createBlueprintDraft, substituteFileContent } from './blueprintDraftStore'
import { BLUEPRINTS_REPO_DEFAULTS, buildBlueprintPublishOps, type BlueprintPublishRequest } from './blueprintPublish'

/** The publish destination + optional PR metadata the form collects (repo coords are config-defaulted). */
export type BlueprintBuilderPublishCoords = BlueprintPublishRequest

/** A compiled, ready-to-dispatch publish, or the first denial (nothing to dispatch). */
export type BlueprintBuilderCompileResult =
  | { ok: true; ops: ApplyResourceSetOp[]; chart: string }
  | { ok: false; errors: string[] }

/**
 * Compile the imported chart tree into the git-write op set — PURE, no dispatch. Mirrors the
 * `publishBlueprint` branch's ordering:
 *   1. hold + measure the tree (createBlueprintDraft) — empty / over-512-KiB short-circuits here;
 *   2. require a `Chart.yaml` — a blueprint IS a Helm chart; a page tree (no Chart.yaml) is refused
 *      so it never lands in the blueprints repo by mistake;
 *   3. derive the chart identity (draftDisplayName) — branch/paths/PR title derive from Chart.yaml;
 *   4. fan out the ops (buildBlueprintPublishOps) with the destination coords ($fileContent tokens);
 *   5. substitute the held bytes into every token (base64) — published == imported;
 *   6. bound the op count + re-run the applyResourceSet scoping kernel (defense in depth).
 * Never throws.
 */
export const compileBlueprintBuilderPublish = (
  files: Record<string, string>,
  coords: BlueprintBuilderPublishCoords,
): BlueprintBuilderCompileResult => {
  const draft = createBlueprintDraft(files)
  if (!draft.ok) {
    return { errors: [draft.error], ok: false }
  }
  if (!('Chart.yaml' in draft.held.files)) {
    return {
      errors: ['The imported tree has no Chart.yaml — a blueprint is a Helm chart. Add the chart\'s Chart.yaml (and its templates/values) before publishing.'],
      ok: false,
    }
  }
  const chart = draftDisplayName(draft.held.files)
  const built = buildBlueprintPublishOps(coords, draft.held, chart)
  if (built.length > MAX_APPLY_SET_OPS) {
    return {
      errors: [`This chart has ${Object.keys(draft.held.files).length} files; a single publish tops out at ${MAX_APPLY_SET_OPS - 2} — trim the tree (large assets belong in a hosted values file, not the templates).`],
      ok: false,
    }
  }
  // Substitute the held verbatim bytes into every {"$fileContent": "<path>"} token (base64 — GitHub's
  // create-file API requires it). This is the SAME step compilePublishOps runs for the Autopilot flow.
  const substituted = substituteFileContent(built, draft.held, 'base64')
  if (!substituted.ok) {
    return { errors: [substituted.error], ok: false }
  }
  // Defense in depth: the SAME scoping kernel applyResourceSet enforces before dispatch.
  if (!isApplySetAllowed(substituted.ops)) {
    return { errors: ['The blueprint publish set failed the write-scope safety check and was not dispatched.'], ok: false }
  }
  return { chart, ok: true, ops: substituted.ops }
}

/**
 * The dispatch hook. `publish` compiles the imported tree (compileBlueprintBuilderPublish) then, on
 * success, dispatches the set through the SAME applyResourceSet → handleActionSet → runRestSet path
 * the Autopilot flow uses — so the whole set rides the identical aggregated blast-radius confirm and
 * opens the identical git PR (nothing lands live; a human merges). Returns:
 *   - { ok:false, errors } — a compile/validation denial (nothing dispatched), for inline display;
 *   - { ok:true, chip:null } — the human DECLINED the blast-radius confirm (nothing dispatched);
 *   - { ok:true, chip } — the set was confirmed + dispatched.
 */
export type BlueprintBuilderPublishOutcome =
  | { ok: false; errors: string[] }
  | { ok: true; chip: ApplyResourceSetChip | null }

export const useBlueprintBuilderPublish = () => {
  const { handleActionSet } = useHandleAction()

  const publish = useCallback(
    async (
      files: Record<string, string>,
      coords: BlueprintBuilderPublishCoords,
    ): Promise<BlueprintBuilderPublishOutcome> => {
      const compiled = compileBlueprintBuilderPublish(files, coords)
      if (!compiled.ok) {
        return { errors: compiled.errors, ok: false }
      }
      // Reuse the EXACT dispatch path (applyResourceSet). Origin is a hand-imported HUMAN write —
      // the audit record carries actor:'human', not the agent tag Autopilot uses.
      const chip = await applyResourceSet(
        { label: `publish ${compiled.chart} blueprint`, ops: compiled.ops, verb: 'applyResourceSet' },
        { handleActionSet: (ops) => handleActionSet(ops, { actor: 'human' }) },
      )
      return { chip, ok: true }
    },
    [handleActionSet],
  )

  return { publish }
}

/** Re-export the coords default so the form can seed its destination fields without another import. */
export { BLUEPRINTS_REPO_DEFAULTS }
