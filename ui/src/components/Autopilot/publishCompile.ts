/**
 * The publish-compile pipeline, factored OUT of AutopilotProvider.finalize — the pure steps that
 * turn an op set into ready-to-dispatch ops (or a denial). Two shapes:
 *   - compileClaimPublish — every builder's publish: ONE host-built BuilderPublish claim, gated on
 *                           preview-before-publish, then the authorship stamp.
 *   - compilePublishOps   — a MODEL-emitted applyResourceSet (a RestDefinition apply, a register
 *                           CompositionDefinition): both preview gates, the $oasAttachment
 *                           substitution, then the authorship stamp.
 * Plus the held-draft identity helpers the finalize branches share. No React, no network.
 */

import { isGitWriteTarget, type ApplyResourceSetOp } from './applyResourceSet'
import { stampAuthorship, type AuthorshipOrigin } from './authorship'
import { draftDisplayName, lintBlueprintDraft, parseRawTemplates } from './blueprintDraft'
import { opsCarryFileContentToken, type BlueprintDraftHeld, type BlueprintDraftStore } from './blueprintDraftStore'
import type { BlueprintGate } from './blueprintGate'
import type { PublishStatusClaim } from './builderPublishStatus'
import { draftHistory } from './draftHistory'
import { substituteOasAttachment, type OasAttachment } from './oasAttachment'
import { isPageDraft, pageDisplayName, pageDraftFiles } from './pageDraft'

/** A preview-gate verdict shape (both the KOG and blueprint gates match this). */
export type GateVerdict = { allowed: true } | { allowed: false; reason: string }

/** The compiled publish set, or the first denial reason (nothing dispatched). */
export interface PublishCompileResult {
  denial: string | null
  ops: ApplyResourceSetOp[] | null
  /** SCM-agnostic claim publishes only: the LocalResources to watch post-apply (set by buildClaimPublish). */
  claim?: PublishStatusClaim
}

/**
 * The model-emitted applyResourceSet compile pipeline. Order: both preview gates, the $fileContent
 * refusal, the $oasAttachment substitution (held bytes replace the token), then the host authorship
 * stamp. Any failure short-circuits to a denial with NO compiled ops.
 */
export const compilePublishOps = (
  ops: readonly ApplyResourceSetOp[] | undefined,
  kogVerdict: GateVerdict,
  blueprintVerdict: GateVerdict,
  oasAttachment: OasAttachment | null,
  origin: AuthorshipOrigin,
): PublishCompileResult => {
  if (!kogVerdict.allowed) {
    return { denial: kogVerdict.reason, ops: null }
  }
  if (!blueprintVerdict.allowed) {
    return { denial: blueprintVerdict.reason, ops: null }
  }
  // Refused HERE, by name, and not only by the apply-set kernel: the kernel's refusal is a silent
  // null — no chip, nothing the model can read — so a hand-written git-write set would just vanish.
  if ((ops ?? []).some((op) => isGitWriteTarget(op.gvr))) {
    return { denial: 'denied — Autopilot does not write gitrefs / repocontents / pullrequests: publish a chart, page or API mapping with publishBlueprint / publishPage / publishRestDef, which commit the held files through one BuilderPublish claim.', ops: null }
  }
  // `$fileContent` was substituted into the RepoContent payloads of the legacy GitHub publish, which
  // is gone. Nothing substitutes it now, so a set carrying it would write the literal token into an
  // object: refuse it, and say where charts and pages are published from.
  if (opsCarryFileContentToken(ops ?? [])) {
    return { denial: 'denied — "$fileContent" is not substituted any more: publish a chart or page with publishBlueprint / publishPage, which commit the held files through one BuilderPublish claim.', ops: null }
  }
  const oasCompiled = substituteOasAttachment(ops ?? [], oasAttachment)
  if (!oasCompiled.ok) {
    return { denial: oasCompiled.error, ops: null }
  }
  return { denial: null, ops: stampAuthorship(oasCompiled.ops, origin) }
}

/**
 * The publish-compile step every builder uses. The op set is a SINGLE BuilderPublish claim carrying
 * the held files verbatim — no token to substitute (the composition splits each path into fileName +
 * toRepo.path and git-provider commits the bytes). A preview gate enforces preview-before-publish
 * (blueprint/page: blueprintGate, armed on the claim's `builderpublishes` resource; controller: the
 * KOG preview gate via a synthetic probe), then the authorship stamp lands on the claim envelope.
 */
export const compileClaimPublish = (
  ops: ApplyResourceSetOp[],
  verdict: GateVerdict,
  origin: AuthorshipOrigin,
): PublishCompileResult => {
  if (!verdict.allowed) {
    return { denial: verdict.reason, ops: null }
  }
  return { denial: null, ops: stampAuthorship(ops, origin) }
}

/** The held draft's preview-gate identity: a page draft (no Chart.yaml) is keyed by its page slug,
 * a blueprint by its Chart.yaml name. One shared store+gate serve both (FE-P2 reuses FE-BP1/BP2). */
export const heldDraftIdentity = (held: BlueprintDraftHeld | null): string | null => {
  if (!held) {
    return null
  }
  return isPageDraft(held) ? pageDisplayName(held.files) : draftDisplayName(held.files)
}

/**
 * A proposal that REPLACES the held draft with a different one takes the undo history with it. A
 * step recorded against page-a, restored into page-b, would be the silent data loss undo exists to
 * prevent. A re-preview of the SAME draft keeps it: undoing back past the agent's own revision is
 * what the history is for.
 *
 * Replacing NOTHING counts as different. The history is module state and the store is the
 * provider's, so a provider remount (every nav-route registration remounts the router) empties the
 * store and keeps the steps — which belong to no draft at all.
 */
const forgetOtherDraftsHistory = (replaced: string | null, held: BlueprintDraftHeld): void => {
  if (replaced !== heldDraftIdentity(held)) {
    draftHistory.clear()
  }
}

/**
 * Did a previewBlueprint chip come from an ACTUAL render? Arming requires a positive signal: an
 * unconfigured render service, a refused or malformed proposal and a lint-rejected draft all return a
 * chip without `previewFailed`, and used to arm a chart that was never rendered.
 */
export const blueprintChipRendered = (chip: { rendered?: boolean }): boolean => chip.rendered === true

/**
 * FE-BP1/BP2, moved out of the provider so a preview a PERSON starts from the composer arms the
 * same gate a proposed one does. Holds the previewed tree (published bytes == previewed bytes) and
 * arms the blueprint gate for its Chart.yaml name — only when the draft is lint-clean AND the
 * render succeeded. `previewFailed` is the half the lint cannot see: a chart that fails
 * `helm template` is lint-clean, and used to be publishable with the drawer showing the error the
 * whole time. A remote-chart preview (no rawTemplates) holds nothing: there is no authored tree.
 * Returns whether the draft was held and the gate armed.
 */
export const recordBlueprintPreview = (
  rawTemplates: Record<string, string> | undefined,
  previewFailed: boolean,
  store: BlueprintDraftStore,
  gate: Pick<BlueprintGate, 'recordPreview'>,
): boolean => {
  // The tree the handler RENDERED — de-fenced, exactly as the preview parsed it — not the raw
  // proposal bytes. Linting the raw bytes refused a draft whose one file the model had wrapped in a
  // code fence, while the drawer, which read the de-fenced tree, showed it as the held draft: its
  // Files tab then wrote by path into whatever WAS held.
  const tree = parseRawTemplates(rawTemplates)
  if (!tree || previewFailed || lintBlueprintDraft(tree).length > 0) {
    return false
  }
  const replaced = heldDraftIdentity(store.get())
  const draft = store.set(tree, 'blueprint')
  if (!draft.ok) {
    return false
  }
  forgetOtherDraftsHistory(replaced, draft.held)
  gate.recordPreview(draftDisplayName(draft.held.files))
  return true
}

/** FE-P2: hold an APPLIED previewPage's widget CRs as a {slug: yaml} page draft and arm the SHARED
 * preview gate for the page's identity — so a page publish is allowed ONLY after the SAME page was
 * previewed this thread (published bytes == previewed bytes). No-op on CRs that can't be serialized. */
export const recordPagePreview = (
  widgets: unknown[] | undefined,
  store: BlueprintDraftStore,
  // Structurally narrowed to the ONE method this uses, so a caller holding a narrowed gate — the
  // draft-bus hook does, deliberately, so its tests need not build a whole gate — can seed a draft
  // through the same entry point a proposed page uses instead of reimplementing it.
  gate: Pick<BlueprintGate, 'recordPreview'>,
): void => {
  const pageFiles = pageDraftFiles(widgets ?? [])
  if (!pageFiles) {
    return
  }
  const replaced = heldDraftIdentity(store.get())
  const draft = store.set(pageFiles, 'page')
  if (draft.ok) {
    forgetOtherDraftsHistory(replaced, draft.held)
    gate.recordPreview(pageDisplayName(draft.held.files))
  }
}
