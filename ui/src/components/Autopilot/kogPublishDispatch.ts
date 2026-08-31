/**
 * The controller (KOG) publish dispatch — factored out of AutopilotProvider.finalize (which was at
 * its max-lines cap). Given the last previewed RestDefinition + the held OAS document, it asks the
 * destination form, then compiles EITHER the github git-write set (buildKogPublishAsPrOps) OR — when
 * AUTOPILOT_PUBLISH_VIA_GIT_PROVIDER is set — one SCM-agnostic BuilderPublish claim over the same
 * file set. The KOG preview gate (a synthetic probe, since neither path writes a restdefinitions op)
 * enforces preview-before-publish. No React, no chips — returns the compiled result + deep link.
 */

import type { Config } from '../../context/ConfigContext'

import { MAX_APPLY_SET_OPS, type ApplyResourceSetOp } from './applyResourceSet'
import type { AuthorshipOrigin } from './authorship'
import { buildClaimPublish } from './builderClaimPublish'
import { REST_DEFINITION_GVR } from './kogMapping'
import { buildKogPublishAsPrOps, kogPublishFiles, resolveKogPublishDraft } from './kogPublish'
import type { PreviewGate } from './previewGate'
import { compileKogPublishOps, type PublishCompileResult } from './publishCompile'
import { askPublishDestination } from './publishTargetForm'

export interface KogPublishDispatchCtx {
  previewGate: PreviewGate
  /** oasStore.get()?.text ?? null — the held OAS document, committed in the paste case. */
  oasText: string | null
  kogTarget: { owner: string; repo: string }
  config: Config | undefined
  publishViaClaim: boolean
  origin: AuthorshipOrigin
}

export const dispatchKogPublish = async (
  proposal: { base?: string; owner?: string; repo?: string },
  ctx: KogPublishDispatchCtx,
): Promise<{ compiled: PublishCompileResult; deepLink: string | null }> => {
  const resolution = resolveKogPublishDraft(ctx.previewGate.lastDraft(), ctx.oasText)
  // The DESTINATION is user-owned: a proper form asks (fence coords are prefills); cancel → denied.
  const restDefTarget = await askPublishDestination(proposal, 'restdef', ctx.kogTarget.repo, ctx.kogTarget.owner)
  const targeted = restDefTarget ? { ...proposal, ...restDefTarget } : proposal
  // Probe the KOG preview gate against the RESOLVED draft (neither the git-write ops nor the claim
  // writes a restdefinitions op, so the gate sees the draft via a synthetic probe op).
  const gateProbe: ApplyResourceSetOp[] | undefined = resolution.held
    ? [{ gvr: { ...REST_DEFINITION_GVR }, namespace: 'krateo-system', payload: resolution.held.draft, verb: 'POST' }]
    : undefined
  if (!restDefTarget) {
    return { compiled: { denial: 'publish cancelled — destination not confirmed', ops: null }, deepLink: null }
  }
  if (resolution.missingOasDocument) {
    return { compiled: { denial: 'denied — the previewed mapping uses a configmap:// oasPath but no OpenAPI document is attached; paste the document in the rail first (it is held client-side and committed at publish), or preview a URL oasPath.', ops: null }, deepLink: null }
  }
  if (!resolution.held) {
    return { compiled: { denial: 'denied — no previewed RestDefinition to publish (previewRestDef a mapping first)', ops: null }, deepLink: null }
  }
  if (ctx.publishViaClaim) {
    // SCM-agnostic: the same RestDefinition (+ OAS ConfigMap) file set → ONE BuilderPublish claim.
    const res = buildClaimPublish({
      builder: 'controller',
      config: ctx.config,
      dest: restDefTarget,
      files: kogPublishFiles(resolution.held, 'krateo-system'),
      gate: () => ctx.previewGate.evaluate(gateProbe),
      namespace: 'krateo-system',
      origin: ctx.origin,
      slug: resolution.held.kind,
    })
    return { compiled: res.compiled, deepLink: res.deepLink }
  }
  const built = buildKogPublishAsPrOps(targeted, resolution.held)
  if (built.length > MAX_APPLY_SET_OPS) {
    return { compiled: { denial: `denied — the KOG publish set has ${built.length} ops, over the ${MAX_APPLY_SET_OPS}-op cap.`, ops: null }, deepLink: null }
  }
  return { compiled: compileKogPublishOps(built, ctx.previewGate.evaluate(gateProbe), ctx.origin), deepLink: null }
}
