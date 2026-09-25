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
import { PUBLISH_CLAIM_PREFIX } from '../../pages/BlueprintComposer/chartIdentity'

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
    /**
     * OPTIONAL template repo the destination is seeded from BEFORE the held files are committed —
     * rendered by the composition as a git-provider `Repo` (`fromRepo` → `toRepo`).
     *
     * Omitted entirely when no template is configured. That is not the same as an empty url: the
     * chart gates on a non-empty `source.url`, so omitting skips the seeding step, while an empty
     * string would render a `Repo` that clones nothing.
     *
     * `krateoIgnorePath` is a DIRECTORY, not a file path, and it is sent EXPLICITLY.
     *
     * git-provider joins this value with the literal filename, so it must name the directory that
     * CONTAINS the ignore file. Passing the filename produces `.krateoignore/.krateoignore` and the
     * whole seeding step dies:
     *   `failed to set krateo ignore: unable to open .krateoignore:
     *    lstat /tmp/git-provider-clone-<n>/.krateoignore/.krateoignore: not a directory`
     * Observed on a real publish (krateo-057, git-provider via builder-publish 1.8.31), which left
     * the BuilderPublish stuck at `2 of 2 managed children are not ready` and committed nothing.
     *
     * WHAT THE IGNORE FILE CANNOT DO: keep a file out of the copy. git-provider's `.krateoignore`
     * only stops a file being RENDERED — it is copied all the same (copier.go sets `doNotRender`,
     * and `TestKrateoIgnorePreventsRendering` pins it). This comment used to credit a missing ignore
     * path for the example chart that arrived in every seeded page-set repo; the example chart
     * arrived because it was in the template. So the template is now one with nothing to keep out —
     * `krateo-blueprints/builder-scaffold`, which holds a release workflow, `.helmignore`,
     * `.gitignore` and a README, and no chart and no CompositionDefinition. The path is still sent:
     * a template without a `.krateoignore` is read as having nothing to ignore, and one that has one
     * gets it honoured for rendering, which is all it ever did.
     */
    source?: { url: string; krateoIgnorePath: string }
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

/**
 * The DIRECTORY holding the template's ignore list — the repo root. git-provider appends the
 * `.krateoignore` filename itself, so this must not name the file (see the field doc above: doing so
 * yields `.krateoignore/.krateoignore` and fails the clone). An absent file is not an error
 * (`setKrateoIgnore` treats it as an empty list), so the chart-free scaffold, which has none, is
 * seeded whole — which is the point of it.
 */
const TEMPLATE_IGNORE_DIR = '/'

/**
 * ONE REPOSITORY PER ARTIFACT, once the destination is SEEDED from a template: the repository must
 * be named for the chart it will hold. Null when it is; otherwise the reason, in words a person can
 * act on.
 *
 * WHY THE SEED MAKES IT A RULE. A seeded repository is a release unit for exactly one chart, at its
 * root: its release workflow refuses a second Chart.yaml, and checks that compositiondefinition.yaml
 * registers the chart beside it. Point a second chart at a repository that already holds one and
 * nothing fails at publish — it fails quietly instead: the claim commits with `override: false`, so
 * every root file already there (Chart.yaml, values.yaml, values.schema.json,
 * compositiondefinition.yaml) is SKIPPED, and the change request folds the new chart's templates
 * into the old chart. Before this rule, fifteen page sets were published into one repository
 * (`demo-service-catalog`), because the publish form carried the last repository over.
 *
 * Without a template there is no release workflow to protect, so the rule is not applied: the
 * repository prefill is still the slug, and a person may change it.
 */
export const seededRepoProblem = (slug: string, repo: string): string | null => {
  const wanted = slug.trim()
  const given = repo.trim()
  if (given === wanted) {
    return null
  }
  return `the repository must be "${wanted}", not "${given}" — a repository seeded from the builder template holds exactly one chart, at its root, and is named for it. A repository that already holds a chart keeps its own Chart.yaml, values.schema.json and compositiondefinition.yaml (a publish never overwrites a file), so this chart's templates would be merged into that one.`
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
  /** Clone URL of a template to seed a NEW destination repo from. Null/absent = no seeding. */
  sourceUrl?: string | null
}): BuilderPublishClaim => {
  const name = `${PUBLISH_CLAIM_PREFIX}${args.slug}`
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
      // Spread, so the key is ABSENT rather than present-and-undefined: the CRD is strict, and the
      // chart decides whether to render the Repo by testing the url for emptiness.
      ...(args.sourceUrl ? { source: { krateoIgnorePath: TEMPLATE_IGNORE_DIR, url: args.sourceUrl } } : {}),
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
