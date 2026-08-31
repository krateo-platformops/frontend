/**
 * The publish-compile pipeline, factored OUT of AutopilotProvider.finalize — the pure step that
 * turns a host-built git-write op set into ready-to-dispatch ops (or a denial). Two shapes:
 *   - compilePublishOps    — the blueprint/page (and legacy KOG direct-write) path: both preview
 *                            gates, then the $oasAttachment + $fileContent substitutions (held bytes
 *                            replace the tokens), then the authorship stamp.
 *   - compileKogPublishOps — the KOG PR path (item #30): the ops already carry FINAL host-serialized
 *                            bytes (no token to substitute), so only the KOG preview gate + the
 *                            authorship stamp apply.
 * Plus the held-draft identity helpers the finalize branches share. No React, no network.
 */

import type { ApplyResourceSetOp } from './applyResourceSet'
import { stampAuthorship, type AuthorshipOrigin } from './authorship'
import { draftDisplayName } from './blueprintDraft'
import { substituteFileContent, type BlueprintDraftHeld, type BlueprintDraftStore } from './blueprintDraftStore'
import type { BlueprintGate } from './blueprintGate'
import { substituteOasAttachment, type OasAttachment } from './oasAttachment'
import { isPageDraft, pageDisplayName, pageDraftFiles, type NavHint } from './pageDraft'

/** A preview-gate verdict shape (both the KOG and blueprint gates match this). */
export type GateVerdict = { allowed: true } | { allowed: false; reason: string }

/** The compiled publish set, or the first denial reason (nothing dispatched). */
export interface PublishCompileResult {
  denial: string | null
  ops: ApplyResourceSetOp[] | null
}

/**
 * The applyResourceSet publish-compile pipeline. Order: both preview gates, then the $oasAttachment
 * + $fileContent substitutions (held bytes replace the tokens), then the host authorship stamp. Any
 * gate/substitution failure short-circuits to a denial with NO compiled ops; success yields the
 * stamped, ready-to-dispatch ops.
 */
export const compilePublishOps = (
  ops: readonly ApplyResourceSetOp[] | undefined,
  kogVerdict: GateVerdict,
  blueprintVerdict: GateVerdict,
  oasAttachment: OasAttachment | null,
  blueprintHeld: BlueprintDraftHeld | null,
  origin: AuthorshipOrigin,
): PublishCompileResult => {
  if (!kogVerdict.allowed) {
    return { denial: kogVerdict.reason, ops: null }
  }
  if (!blueprintVerdict.allowed) {
    return { denial: blueprintVerdict.reason, ops: null }
  }
  const oasCompiled = substituteOasAttachment(ops ?? [], oasAttachment)
  if (!oasCompiled.ok) {
    return { denial: oasCompiled.error, ops: null }
  }
  // base64: every $fileContent token is a RepoContent `.spec.content` value (the BLUEPRINT
  // BUILDER prompt is its sole emitter), and GitHub's create-or-update-file API requires the
  // file bytes base64-encoded. Without this the chart files ship as raw text and GitHub 422s
  // at publish (FE-BP5 — the git-provider CR shape is now verified: content = base64).
  const fileCompiled = substituteFileContent(oasCompiled.ops, blueprintHeld, 'base64')
  if (!fileCompiled.ok) {
    return { denial: fileCompiled.error, ops: null }
  }
  return { denial: null, ops: stampAuthorship(fileCompiled.ops, origin) }
}

/**
 * The KOG PR-publish compile step. UNLIKE compilePublishOps, the git-write ops here already carry
 * their FINAL, host-serialized file bytes (buildKogPublishAsPrOps deterministically serializes the
 * previewed RestDefinition + embeds the held OAS document), so there is NO $fileContent/$oasAttachment
 * token to substitute. Two things still gate it:
 *   1. The KOG preview gate (FE-K3) — a publish is DENIED unless a matching (kind+resourceGroup)
 *      previewRestDef happened this thread. The git-write ops write gitrefs/repocontents/pullrequests
 *      (not restdefinitions), so the caller evaluates the gate against the RESOLVED draft directly (a
 *      synthetic restdefinitions op) rather than against the git-write ops.
 *   2. The authorship stamp (FE-BP3) — host-injected managed-by/authored-by onto every op envelope.
 * The blueprintGate is deliberately NOT applied: it matches on the blueprintStore's held chart name,
 * which the KOG path never populates — the KOG preview gate is the correct preview-before-publish gate.
 */
export const compileKogPublishOps = (
  ops: ApplyResourceSetOp[],
  kogVerdict: GateVerdict,
  origin: AuthorshipOrigin,
): PublishCompileResult => {
  if (!kogVerdict.allowed) {
    return { denial: kogVerdict.reason, ops: null }
  }
  return { denial: null, ops: stampAuthorship(ops, origin) }
}

/**
 * The SCM-agnostic (AUTOPILOT_PUBLISH_VIA_GIT_PROVIDER) publish-compile step. The op set is a SINGLE
 * BuilderPublish claim carrying the held files verbatim — no $fileContent/$oasAttachment token to
 * substitute (the composition splits each path into fileName + toRepo.path and git-provider commits
 * the bytes). A preview gate still enforces preview-before-publish (blueprint/page: blueprintGate,
 * which now arms on the claim's `builderpublishes` resource; controller: the KOG preview gate via a
 * synthetic probe), then the authorship stamp lands on the claim envelope like the github paths.
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
  return isPageDraft(held.files) ? pageDisplayName(held.files) : draftDisplayName(held.files)
}

/** FE-P2: hold an APPLIED previewPage's widget CRs as a {slug: yaml} page draft and arm the SHARED
 * preview gate for the page's identity — so a page publish is allowed ONLY after the SAME page was
 * previewed this thread (published bytes == previewed bytes). No-op on CRs that can't be serialized. */
export const recordPagePreview = (
  widgets: unknown[] | undefined,
  nav: NavHint | undefined,
  store: BlueprintDraftStore,
  gate: BlueprintGate,
): void => {
  const pageFiles = pageDraftFiles(widgets ?? [], nav)
  if (!pageFiles) {
    return
  }
  const draft = store.set(pageFiles)
  if (draft.ok) {
    gate.recordPreview(pageDisplayName(draft.held.files))
  }
}
