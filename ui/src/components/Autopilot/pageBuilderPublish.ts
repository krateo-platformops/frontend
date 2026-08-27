/**
 * UI-NATIVE PAGE BUILDER (item C, page slice) — the publish-wiring seam.
 *
 * The page analogue of blueprintBuilderPublish.ts / kogBuilderPublish.ts. This is an IMPORT/publish
 * surface: the user brings their OWN portal page files (widget-CR YAML keyed `<kind-lower>.<name>.yaml`
 * plus a `flex.page-<slug>.yaml` root, and OPTIONALLY a nav fragment keyed `nav-fragment.<slug>.yaml`)
 * via Upload/paste, and this module publishes them VERBATIM through the EXACT git-write path the
 * Autopilot `publishPage` branch uses. NOTHING here is reimplemented.
 *
 * Two surfaces (mirroring kogBuilderPublish.ts):
 *   1. compilePageBuilderPublish (PURE) — the imported `{slug: yaml}` map + repo coords → the ORDERED
 *      git-write op set, or a denial. It REUSES the Autopilot machinery in the same order the
 *      `publishPage` branch runs it:
 *        - createBlueprintDraft   → the SAME 512 KiB held-tree cap (the page draft is held in the
 *          SAME store shape as a blueprint tree, so the SAME machinery serves it);
 *        - isPageDraft            → a page tree carries NO Chart.yaml (the discriminator);
 *        - pageRootSlug           → the SAME `flex.page-<slug>.yaml` root → the page slug (the branch,
 *          paths and PR title all derive from it);
 *        - buildPagePublishOps    → the SAME gitref + per-file repocontents (widget CRs → chart/templates,
 *          the nav fragment → chart/files/nav-fragments) + pullrequest fan-out ($fileContent tokens);
 *        - substituteFileContent (base64) → the SAME $fileContent → base64 substitution the publish
 *          pipeline runs, so published bytes == the imported bytes;
 *        - isApplySetAllowed      → the SAME defense-in-depth scoping kernel (≤10 ops, Krateo groups).
 *   2. usePageBuilderPublish (HOOK) — dispatches the compiled set through the SAME
 *      applyResourceSet → handleActionSet → runRestSet path, so the whole set rides the identical
 *      aggregated blast-radius confirm + git PR (nothing lands live; a human merges). Origin is
 *      `{actor:'human'}` (a hand-imported write, not agent-originated).
 *
 * NOTE ON AUTHORSHIP: as in the blueprint/KOG UI-native paths, the human import does NOT run
 * stampAuthorship (`authored-by: autopilot`); the `{actor:'human'}` origin at the runRestSet layer is
 * the correct provenance. The $fileContent substitution IS run (publishPage ops carry tokens).
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
import { createBlueprintDraft, substituteFileContent } from './blueprintDraftStore'
import { isPageDraft, pageRootSlug } from './pageDraft'
import { buildPagePublishOps, PORTAL_CHART_REPO_DEFAULTS, type PagePublishRequest } from './pagePublish'

/** The publish destination + optional PR metadata the form collects (repo coords are config-defaulted). */
export type PageBuilderPublishCoords = PagePublishRequest

/** A compiled, ready-to-dispatch publish, or the first denial (nothing to dispatch). */
export type PageBuilderCompileResult =
  | { ok: true; ops: ApplyResourceSetOp[]; slug: string }
  | { ok: false; errors: string[] }

/**
 * Compile the imported page tree into the git-write op set — PURE, no dispatch. Mirrors the
 * `publishPage` branch's ordering:
 *   1. hold + measure the tree (createBlueprintDraft) — empty / over-512-KiB short-circuits here;
 *   2. require a PAGE tree (isPageDraft — no Chart.yaml); a chart tree is refused so it never lands
 *      in the portal-chart repo by mistake;
 *   3. require a `flex.page-<slug>.yaml` root (pageRootSlug) — without it there is no route/slug/nav;
 *   4. fan out the ops (buildPagePublishOps) with the destination coords ($fileContent tokens);
 *   5. substitute the held bytes into every token (base64) — published == imported;
 *   6. bound the op count + re-run the applyResourceSet scoping kernel (defense in depth).
 * Never throws.
 */
export const compilePageBuilderPublish = (
  files: Record<string, string>,
  coords: PageBuilderPublishCoords,
): PageBuilderCompileResult => {
  const draft = createBlueprintDraft(files)
  if (!draft.ok) {
    return { errors: [draft.error], ok: false }
  }
  if (!isPageDraft(draft.held.files)) {
    return {
      errors: ['The imported tree carries a Chart.yaml — that is a Helm chart (a blueprint), not a portal page. Use the Blueprint importer instead.'],
      ok: false,
    }
  }
  const slug = pageRootSlug(draft.held.files)
  if (!slug) {
    return {
      errors: ['The page has no `flex.page-<slug>.yaml` root — a portal page needs a root Flex named `page-<slug>` (that slug becomes the /route and sidebar entry). Add it before publishing.'],
      ok: false,
    }
  }
  const built = buildPagePublishOps(coords, draft.held, slug)
  if (built.length > MAX_APPLY_SET_OPS) {
    return {
      errors: [`This page has ${Object.keys(draft.held.files).length} files; a single publish tops out at ${MAX_APPLY_SET_OPS - 2} — split the page across turns on the same branch.`],
      ok: false,
    }
  }
  const substituted = substituteFileContent(built, draft.held, 'base64')
  if (!substituted.ok) {
    return { errors: [substituted.error], ok: false }
  }
  if (!isApplySetAllowed(substituted.ops)) {
    return { errors: ['The page publish set failed the write-scope safety check and was not dispatched.'], ok: false }
  }
  return { ok: true, ops: substituted.ops, slug }
}

/**
 * The dispatch hook. `publish` compiles the imported page tree (compilePageBuilderPublish) then, on
 * success, dispatches the set through the SAME applyResourceSet → handleActionSet → runRestSet path
 * the Autopilot flow uses — so the whole set rides the identical aggregated blast-radius confirm and
 * opens the identical git PR (nothing lands live; a human merges). Returns:
 *   - { ok:false, errors } — a compile/validation denial (nothing dispatched), for inline display;
 *   - { ok:true, chip:null } — the human DECLINED the blast-radius confirm (nothing dispatched);
 *   - { ok:true, chip } — the set was confirmed + dispatched.
 */
export type PageBuilderPublishOutcome =
  | { ok: false; errors: string[] }
  | { ok: true; chip: ApplyResourceSetChip | null }

export const usePageBuilderPublish = () => {
  const { handleActionSet } = useHandleAction()

  const publish = useCallback(
    async (
      files: Record<string, string>,
      coords: PageBuilderPublishCoords,
    ): Promise<PageBuilderPublishOutcome> => {
      const compiled = compilePageBuilderPublish(files, coords)
      if (!compiled.ok) {
        return { errors: compiled.errors, ok: false }
      }
      const chip = await applyResourceSet(
        { label: `publish page-${compiled.slug}`, ops: compiled.ops, verb: 'applyResourceSet' },
        { handleActionSet: (ops) => handleActionSet(ops, { actor: 'human' }) },
      )
      return { chip, ok: true }
    },
    [handleActionSet],
  )

  return { publish }
}

/** Re-export the coords default so the form can seed its destination fields without another import. */
export { PORTAL_CHART_REPO_DEFAULTS }
