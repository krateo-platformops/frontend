/**
 * The SCM-agnostic publish orchestration (AUTOPILOT_PUBLISH_VIA_GIT_PROVIDER) — the claim-path analog
 * of the buildXPublishOps + compilePublishOps flow in AutopilotProvider.finalize. Given a builder's
 * held files + the user-confirmed destination, it builds a gated BuilderPublish claim (one POST op)
 * and the host-aware "Open pull/merge request" deep link (Option A). Kept out of finalize so the
 * finalize edit is a thin flag-gated delegation and the logic stays unit-testable.
 */

import type { Config } from '../../context/ConfigContext'

import type { ApplyResourceSetOp } from './applyResourceSet'
import type { AuthorshipOrigin } from './authorship'
import {
  buildBuilderPublishClaim,
  buildBuilderPublishOps,
  changeRequestDeepLink,
  resolveStructuredTarget,
  type BuilderKind,
  type BuilderPublishFile,
} from './builderPublishClaim'
import { compileClaimPublish, type GateVerdict, type PublishCompileResult } from './publishCompile'

export interface ClaimPublishResult {
  compiled: PublishCompileResult
  /** The host-aware Open-PR/MR URL — set only on a compiled (non-denied) publish. */
  deepLink: string | null
  branch: string
}

/**
 * Build + compile one builder's SCM-agnostic publish. `dest` is the user-confirmed destination from
 * the publish form (owner→namespace, repo, base) — it overrides the install-config target so the
 * human's choice always wins. `gate` returns the preview-gate verdict for the claim op set
 * (blueprint/page: blueprintGate, which now arms on `builderpublishes`; controller: the KOG gate via
 * a synthetic probe). The install-level git connection + credentials are NOT here — the composition
 * supplies them, so a token never rides in the claim.
 */
export const buildClaimPublish = (args: {
  builder: BuilderKind
  slug: string
  files: BuilderPublishFile[]
  dest: { owner?: string; repo?: string; base?: string } | null
  namespace: string
  config: Config | undefined
  gate: (ops: ApplyResourceSetOp[]) => GateVerdict
  origin: AuthorshipOrigin
}): ClaimPublishResult => {
  const resolved = resolveStructuredTarget(args.builder, args.config)
  const target = {
    ...resolved,
    ...(args.dest?.owner ? { namespace: args.dest.owner } : {}),
    ...(args.dest?.repo ? { repo: args.dest.repo } : {}),
    ...(args.dest?.base ? { base: args.dest.base } : {}),
  }
  const claim = buildBuilderPublishClaim({ builder: args.builder, files: args.files, namespace: args.namespace, slug: args.slug, target })
  const ops = buildBuilderPublishOps(claim)
  const compiled = compileClaimPublish(ops, args.gate(ops), args.origin)
  return {
    branch: claim.spec.branch,
    compiled,
    deepLink: compiled.denial === null ? changeRequestDeepLink(target, claim.spec.branch) : null,
  }
}
