/**
 * UI-NATIVE KOG BUILDER (item C) — the publish-wiring seam.
 *
 * Two surfaces:
 *   1. compileKogBuilderPublish (PURE) — form input + repo coords → the ORDERED git-write op set,
 *      or a denial. It REUSES the exact Autopilot machinery, in the same order the `publishRestDef`
 *      branch runs it:
 *        - buildAndValidateRestDefinition → the SAME validateRestDefinitionDraft correctness gate;
 *        - resolveKogPublishDraft         → the SAME URL-vs-paste discriminator (from the oasPath);
 *        - buildKogPublishAsPrOps         → the SAME gitref + repocontents + pullrequest fan-out;
 *        - isApplySetAllowed              → the SAME defense-in-depth scoping kernel (≤10 ops,
 *                                           Krateo groups / core ConfigMaps only).
 *      NOTHING here is reimplemented — this module only orders the reused pieces and maps their
 *      failures to a human-readable denial.
 *   2. useKogBuilderPublish (HOOK) — dispatches the compiled set through the SAME `applyResourceSet`
 *      → `handleActionSet` → `runRestSet` path Autopilot uses, so the WHOLE set rides the identical
 *      aggregated blast-radius confirm + git PR. Origin is `{actor:'human'}` (a hand-authored write,
 *      not agent-originated). Returns null on deny/decline (nothing dispatched), a chip on success.
 *
 * THE OAS "HELD CLIENT-SIDE, NEVER RETYPED" GUARANTEE is preserved by construction: the paste-case
 * document is passed straight from the form's local state into buildKogPublishAsPrOps, which embeds
 * the verbatim bytes into the committed ConfigMap manifest — the document is authored once and never
 * reproduced. No model, no round-trip.
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
import { buildKogPublishAsPrOps, resolveKogPublishDraft, type KogPublishRequest } from './kogPublish'
import { buildAndValidateRestDefinition, type RestDefinitionDraftInput } from './restDefinitionDraft'

/** The publish destination + optional PR metadata the form collects (repo coords are config-defaulted). */
export type KogBuilderPublishCoords = KogPublishRequest

/** A compiled, ready-to-dispatch publish, or the first denial (nothing to dispatch). */
export type KogBuilderCompileResult =
  | { ok: true; ops: ApplyResourceSetOp[] }
  | { ok: false; errors: string[] }

/**
 * Compile the UI-native form input into the git-write op set — PURE, no dispatch. Mirrors the
 * `publishRestDef` branch's ordering exactly:
 *   1. build + validate the draft (validateRestDefinitionDraft) — field errors short-circuit here;
 *   2. resolve URL-vs-paste (resolveKogPublishDraft) — a configmap:// oasPath REQUIRES the held
 *      OAS document (missingOasDocument), a URL oasPath needs none;
 *   3. fan out the ops (buildKogPublishAsPrOps) with the destination coords;
 *   4. bound the op count + re-run the applyResourceSet scoping kernel (defense in depth).
 * `oasDocument` is the form's held paste text (null in the URL case). Never throws.
 */
export const compileKogBuilderPublish = (
  input: RestDefinitionDraftInput,
  coords: KogBuilderPublishCoords,
  oasDocument: string | null,
): KogBuilderCompileResult => {
  const { draft, errors } = buildAndValidateRestDefinition(input)
  if (errors.length > 0) {
    return { errors, ok: false }
  }
  const resolution = resolveKogPublishDraft(draft, oasDocument)
  if (resolution.missingOasDocument) {
    return {
      errors: ['The oasPath is a configmap:// reference but no OpenAPI document is attached — paste the document below (it is held client-side and committed at publish), or use an http(s):// URL as the oasPath.'],
      ok: false,
    }
  }
  if (!resolution.held) {
    return { errors: ['The RestDefinition draft could not be resolved for publish — check the kind name and oasPath.'], ok: false }
  }
  const ops = buildKogPublishAsPrOps(coords, resolution.held)
  if (ops.length > MAX_APPLY_SET_OPS) {
    return { errors: [`The KOG publish set has ${ops.length} ops, over the ${MAX_APPLY_SET_OPS}-op cap.`], ok: false }
  }
  // Defense in depth: the SAME scoping kernel applyResourceSet enforces before dispatch. A UI-native
  // build should always pass (it goes through buildKogPublishAsPrOps), but re-checking here surfaces
  // a bad set as an inline error rather than a silent null from the dispatcher.
  if (!isApplySetAllowed(ops)) {
    return { errors: ['The KOG publish set failed the write-scope safety check and was not dispatched.'], ok: false }
  }
  return { ok: true, ops }
}

/**
 * The dispatch hook. `publish` compiles the form input (compileKogBuilderPublish) then, on success,
 * dispatches the set through the SAME applyResourceSet → handleActionSet → runRestSet path Autopilot
 * uses — so the whole set rides the identical aggregated blast-radius confirm and opens the identical
 * git PR (nothing lands live; a human merges). Returns:
 *   - { ok:false, errors } — a compile/validation denial (nothing dispatched), for inline display;
 *   - { ok:true, chip:null } — the human DECLINED the blast-radius confirm (nothing dispatched);
 *   - { ok:true, chip } — the set was confirmed + dispatched.
 */
export type KogBuilderPublishOutcome =
  | { ok: false; errors: string[] }
  | { ok: true; chip: ApplyResourceSetChip | null }

export const useKogBuilderPublish = () => {
  const { handleActionSet } = useHandleAction()

  const publish = useCallback(
    async (
      input: RestDefinitionDraftInput,
      coords: KogBuilderPublishCoords,
      oasDocument: string | null,
    ): Promise<KogBuilderPublishOutcome> => {
      const compiled = compileKogBuilderPublish(input, coords, oasDocument)
      if (!compiled.ok) {
        return { errors: compiled.errors, ok: false }
      }
      // Reuse the EXACT dispatch path (applyResourceSet). Origin is a hand-authored HUMAN write —
      // the audit record carries actor:'human', not the agent tag Autopilot uses.
      const chip = await applyResourceSet(
        { label: `publish ${input.name.trim()} RestDefinition`, ops: compiled.ops, verb: 'applyResourceSet' },
        { handleActionSet: (ops) => handleActionSet(ops, { actor: 'human' }) },
      )
      return { chip, ok: true }
    },
    [handleActionSet],
  )

  return { publish }
}
