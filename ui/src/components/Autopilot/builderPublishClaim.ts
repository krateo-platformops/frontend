/**
 * F1 — the SCM-agnostic publish path. Instead of emitting the GitHub-specific
 * `GitRef → RepoContent → PullRequest` set on `github.krateo.io`, each builder emits ONE
 * `BuilderPublish` claim (apps.krateo.io/v1alpha1). A Krateo composition (C1, builder-publish)
 * expands it into plain git-provider `LocalResource`s that commit the held files verbatim to a
 * `builder/<slug>` branch off base — on ANY SCM git-provider can reach. No PR/MR is created: the
 * UI opens one via a host-aware deep link (Option A). Proven end-to-end on git-provider 0.13.0.
 *
 * Split of concerns (settled by the S0 spike):
 *   • per-PUBLISH (this claim, what the model/frontend knows): builder, name, branch, the target
 *     repo (namespace/repo/base), and the held files WITH FULL PATHS.
 *   • per-INSTALL (NOT here — the composition supplies from install defaults): the git-provider
 *     credentials, the URL scheme, the ADO insecure flag. The claim never carries a secret.
 *   • the LocalResource `fileName` is a BASENAME (its CRD forbids slashes) — the composition splits
 *     each held path into fileName + toRepo.path. The frontend just sends the full path.
 */

import type { Config } from '../../context/ConfigContext'

import type { ApplyResourceSetGvr, ApplyResourceSetOp } from './applyResourceSet'

/** The three builders, by their user-facing names (kog is the internal/legacy name for controller). */
export type BuilderKind = 'blueprint' | 'controller' | 'page'

/** Where a publish lands. `scm`/`host` drive the deep link + citation URLs only — the write is
 *  scm-blind (git-provider does it). `namespace`/`repo`/`base` address the repo within `host`. */
export interface StructuredTarget {
  scm: string
  host: string
  namespace: string
  repo: string
  base: string
}

/** One held file — full in-repo path + exact bytes (the composition splits path→dir/base). */
export interface BuilderPublishFile {
  path: string
  content: string
}

export interface BuilderPublishClaim {
  /** `composition.krateo.io/<served-version>` — resolved at runtime (see builderPublishGvr.ts). */
  apiVersion: string
  kind: 'BuilderPublish'
  metadata: { name: string; namespace: string }
  spec: {
    name: string
    builder: BuilderKind
    branch: string
    target: { namespace: string; repo: string; base: string }
    files: BuilderPublishFile[]
  }
}

type BuilderRepoKey = 'AUTOPILOT_BLUEPRINT_BUILDER_REPO' | 'AUTOPILOT_KOG_BUILDER_REPO' | 'AUTOPILOT_PAGE_BUILDER_REPO'

const PER_BUILDER: Record<BuilderKind, BuilderRepoKey> = {
  blueprint: 'AUTOPILOT_BLUEPRINT_BUILDER_REPO',
  controller: 'AUTOPILOT_KOG_BUILDER_REPO',
  page: 'AUTOPILOT_PAGE_BUILDER_REPO',
}

/** Parse an install-config `namespace/repo` slug (GitLab subgroups → a multi-segment namespace).
 *  NO hardcoded fallback: a missing/malformed slug yields EMPTY coords — the human supplies the
 *  destination at publish (or the publish is denied). */
const parseSlug = (slug: string | undefined): { namespace: string; repo: string } => {
  const parts = (typeof slug === 'string' ? slug : '').split('/').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) {
    return { namespace: '', repo: '' }
  }
  return { namespace: parts.slice(0, -1).join('/'), repo: parts[parts.length - 1] }
}

/** Base branch a builder branch is cut from — a neutral git default, not a repo source. */
const DEFAULT_BASE = 'main'

/**
 * Resolve a builder's full publish target from install config ONLY — the per-builder repo slug
 * (`AUTOPILOT_*_BUILDER_REPO`) plus the global SCM/host (`AUTOPILOT_GIT_SCM`/`_HOST`). No hardcoded
 * repo: an absent slug → empty namespace/repo (the human-confirmed publish form supplies them, and
 * for blueprint/controller Autopilot emits a per-artifact repo). Absent SCM/host → github / github.com.
 */
export const resolveStructuredTarget = (builder: BuilderKind, config: Config | undefined): StructuredTarget => {
  const api = config?.api
  const { namespace, repo } = parseSlug(api?.[PER_BUILDER[builder]])
  return {
    base: DEFAULT_BASE,
    host: api?.AUTOPILOT_GIT_HOST || 'github.com',
    namespace,
    repo,
    scm: api?.AUTOPILOT_GIT_SCM || 'github',
  }
}

/** The builder branch derived from a page/chart/kind slug — the model never has to match it. */
export const builderBranch = (slug: string): string => `builder/${slug}`

/**
 * Build the BuilderPublish claim for a held publish. `slug` names the page/chart/kind (drives the
 * publish identity + branch); `files` carry FULL in-repo paths and exact bytes.
 */
export const buildBuilderPublishClaim = (args: {
  builder: BuilderKind
  slug: string
  files: BuilderPublishFile[]
  target: StructuredTarget
  /** `group/version` for the CR body — the live value resolved from the CompositionDefinition. */
  apiVersion: string
  namespace?: string
}): BuilderPublishClaim => {
  const name = `publish-${args.slug}`
  const ns = args.namespace || 'krateo-system'
  return {
    apiVersion: args.apiVersion,
    kind: 'BuilderPublish',
    metadata: { name, namespace: ns },
    spec: {
      branch: builderBranch(args.slug),
      builder: args.builder,
      files: args.files,
      name,
      target: { base: args.target.base, namespace: args.target.namespace, repo: args.target.repo },
    },
  }
}

/**
 * The single ordered write op that emits a BuilderPublish claim — the SCM-agnostic replacement for
 * the github `GitRef → RepoContent → PullRequest` op-set. ONE `POST`; the composition renders the
 * git-provider LocalResources. Deny-by-default: it rides the same gated `applyResourceSet` path.
 * `gvr` is the LIVE GVR resolved from the deployed CompositionDefinition (composition.krateo.io /
 * chart-version-derived served version / builderpublishes) — never hardcoded (see builderPublishGvr.ts).
 */
export const buildBuilderPublishOps = (claim: BuilderPublishClaim, gvr: ApplyResourceSetGvr): ApplyResourceSetOp[] => [
  { gvr: { ...gvr }, namespace: claim.metadata.namespace, payload: claim, verb: 'POST' },
]

/**
 * Host-aware "Open change request" URL (Option A: the human opens it). Always an https web URL
 * (the browser opens the SCM's UI, independent of the git push scheme). Branch names carry a slash,
 * so they are encoded in query params.
 */
export const changeRequestDeepLink = (target: StructuredTarget, branch: string): string => {
  const { base, host, namespace, repo, scm } = target
  const repoUrl = `https://${host}/${namespace}/${repo}`
  const branchEnc = encodeURIComponent(branch)
  const baseEnc = encodeURIComponent(base)
  switch (scm) {
    case 'gitlab':
      return `${repoUrl}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${branchEnc}&merge_request%5Btarget_branch%5D=${baseEnc}`
    case 'bitbucket':
      return `${repoUrl}/pull-requests/new?source=${branchEnc}&dest=${baseEnc}`
    case 'ado':
    case 'azuredevops':
      // ADO nests org/project/_git/repo; `namespace` carries org[/project]. Best-effort.
      return `https://${host}/${namespace}/_git/${repo}/pullrequestcreate?sourceRef=${branchEnc}&targetRef=${baseEnc}`
    default:
      // github (and github-enterprise) — the compare/open-PR page.
      return `${repoUrl}/compare/${base}...${branch}?expand=1`
  }
}
