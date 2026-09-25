/**
 * The controller (KOG) publish dispatch — factored out of AutopilotProvider.finalize (which was at
 * its max-lines cap). Given the last previewed RestDefinition + the held OAS document, it asks the
 * destination form, then compiles one BuilderPublish claim over the controller's chart files — the
 * same claim every builder publishes through. The KOG preview gate (a synthetic probe, since the
 * claim writes no restdefinitions op) enforces preview-before-publish. No React, no chips — returns
 * the compiled result + deep link.
 */

import type { Config } from '../../context/ConfigContext'

import type { ApplyResourceSetOp } from './applyResourceSet'
import type { AuthorshipOrigin } from './authorship'
import { buildClaimPublish } from './builderClaimPublish'
import { kogCompositionDefinition } from './kogChart'
import { REST_DEFINITION_GVR } from './kogMapping'
import { kogPublishFiles, resolveKogPublishDraft } from './kogPublish'
import type { PreviewGate } from './previewGate'
import type { PublishCompileResult } from './publishCompile'
import { askPublishDestination } from './publishTargetForm'

export interface KogPublishDispatchCtx {
  previewGate: PreviewGate
  /** oasStore.get()?.text ?? null — the held OAS document, committed in the paste case. */
  oasText: string | null
  kogTarget: { owner: string; repo: string }
  config: Config | undefined
  origin: AuthorshipOrigin
}

export const dispatchKogPublish = async (
  proposal: { base?: string; owner?: string; repo?: string },
  ctx: KogPublishDispatchCtx,
): Promise<{ compiled: PublishCompileResult; deepLink: string | null }> => {
  const resolution = resolveKogPublishDraft(ctx.previewGate.lastDraft(), ctx.oasText)
  // The DESTINATION is user-owned: a proper form asks (fence coords are prefills); cancel → denied.
  // PER-ARTIFACT repos (#163): each controller/RestDefinition gets its OWN repo named for the kind —
  // so the repo prefill is the resolved kind, with the OWNER from install config (ctx.kogTarget.owner).
  const destRepo = resolution.held?.kind || ctx.kogTarget.repo
  const restDefTarget = await askPublishDestination(proposal, 'restdef', destRepo, ctx.kogTarget.owner)
  // Probe the KOG preview gate against the RESOLVED draft (the claim writes no restdefinitions op,
  // so the gate sees the draft via a synthetic probe op).
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

  // THE REGISTRATION FILE, written at publish time because it is the one file that depends on the
  // DESTINATION: its OCI url is `<owner>/charts/<kind>`, and the owner is only settled once the
  // human confirms it in the blast-radius dialog. Without it the controller chart releases to OCI
  // and nothing installs it — core-provider generates the CRD from values.schema.json and serves it,
  // and only then can a claim create the RestDefinition that makes oasgen materialise the real kind.
  const kogOwner = restDefTarget.owner || ctx.kogTarget.owner
  const publishFiles = kogOwner
    ? [
      ...kogPublishFiles(resolution.held),
      { content: kogCompositionDefinition(resolution.held.kind, kogOwner), path: 'compositiondefinition.yaml' },
    ]
    : kogPublishFiles(resolution.held)
  // SCM-agnostic: the RestDefinition (+ OAS ConfigMap) chart → ONE BuilderPublish claim.
  const res = await buildClaimPublish({
    builder: 'controller',
    config: ctx.config,
    dest: restDefTarget,
    files: publishFiles,
    gate: () => ctx.previewGate.evaluate(gateProbe),
    namespace: 'krateo-system',
    origin: ctx.origin,
    slug: resolution.held.kind,
  })
  return { compiled: res.compiled, deepLink: res.deepLink }
}
