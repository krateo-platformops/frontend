/**
 * FE-BP6 — DETERMINISTIC blueprint-publish op construction (frontend-constructs-ops).
 *
 * WHY THIS EXISTS: the blueprint publish (STEP A) is a heterogeneous multi-op git write —
 * one `gitrefs` op to cut the builder branch, one `repocontents` op PER chart file (each
 * carrying a `{"$fileContent": "<path>"}` substitution token), then one `pullrequests` op.
 * gemini-2.5-pro reliably emits a small SCALAR verb but stalls trying to hand-write that
 * whole payload — it narrates ("you'll be asked to confirm…") instead of emitting the
 * fence, so no blast-radius dialog renders and the publish silently dies (verified live on
 * autopilot 0.1.40 / frontend 1.3.44, even with an explicit re-prompt backstop). The fix:
 * the model emits ONE tiny `publishBlueprint` verb with just the repo coordinates, and the
 * HOST builds the op set from the already-HELD previewed tree. The resulting ops flow
 * through the SAME compilePublishOps pipeline ($fileContent → base64 substitution +
 * authorship stamp) and the SAME blast-radius confirm — this module only assembles the
 * ordered op list; it never bypasses a gate.
 */

import type { ApplyResourceSetGvr, ApplyResourceSetOp } from './applyResourceSet'
import { FILE_CONTENT_KEY, type BlueprintDraftHeld } from './blueprintDraftStore'

/** The KOG git-write provider group/version (RepoContent/GitRef/PullRequest live here). */
export const GITHUB_KOG_GROUP = 'github.krateo.io'
export const GITHUB_KOG_VERSION = 'v1alpha1'

/**
 * Repo coordinates for a blueprint publish. The model supplies these simple scalars from its
 * prompt (which it does reliably); each falls back to the blueprint-catalog default if omitted,
 * so a publish is robust even when the model drops a field. These mirror the coordinates in the
 * BLUEPRINT BUILDER section of the orchestrator's system prompt (the `portal-protocol` key of the
 * krateo-prompts-eng ConfigMap, krateo-autopilot >= 0.1.49) — the single source stays the
 * prompt/model, not this file, so change them there first.
 */
// NON-repo install defaults for the legacy github git-write path only. The publish OWNER/REPO are
// never hardcoded in source — owner comes from install config (AUTOPILOT_BLUEPRINT_BUILDER_REPO) and
// the repo is PER-ARTIFACT (each blueprint gets its own repo named for the chart), both confirmed by
// the human at publish. See builderTargets.ts / AutopilotProvider.finalize.
export const BLUEPRINTS_REPO_DEFAULTS = {
  base: 'main',
  configurationRef: 'github-blueprints-config',
  namespace: 'krateo-system',
} as const

/** The `publishBlueprint` verb payload — repo coords only; the file set comes from the held draft. */
export interface BlueprintPublishRequest {
  owner?: string
  repo?: string
  base?: string
  namespace?: string
  configurationRef?: string
  title?: string
  body?: string
  message?: string
}

/**
 * Fan a `publishBlueprint` request out into the ordered git-write op set for the HELD chart tree:
 *   1. POST gitrefs      — create `refs/heads/builder/<chart>` (sha omitted; the git-provider
 *                          auto-resolves the base-branch HEAD).
 *   2. POST repocontents — one per held file, content = the `{"$fileContent": "<path>"}` token
 *                          (compilePublishOps substitutes the previewed bytes as base64).
 *   3. POST pullrequests — open the PR from the builder branch into `base`.
 * The branch is DERIVED from the chart name so the model never has to match it. Object keys are
 * alphabetized (repo eslint sort-keys). The op count is 2 + files — the caller enforces the
 * MAX_APPLY_SET_OPS cap and surfaces a clear denial for an over-large tree.
 */
/** DNS-1123-ish name segment from a file path (a RepoContent needs a unique metadata.name per file). */
const pathNameSlug = (path: string): string => path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export const buildBlueprintPublishOps = (
  req: BlueprintPublishRequest,
  held: BlueprintDraftHeld,
  chart: string,
): ApplyResourceSetOp[] => {
  const owner = req.owner ?? ''
  const repo = req.repo ?? ''
  const base = req.base ?? BLUEPRINTS_REPO_DEFAULTS.base
  const namespace = req.namespace ?? BLUEPRINTS_REPO_DEFAULTS.namespace
  const configurationRef = { name: req.configurationRef ?? BLUEPRINTS_REPO_DEFAULTS.configurationRef }
  const branch = `builder/${chart}`
  const apiVersion = `${GITHUB_KOG_GROUP}/${GITHUB_KOG_VERSION}`
  const gvr = (resource: string): ApplyResourceSetGvr => ({ group: GITHUB_KOG_GROUP, resource, version: GITHUB_KOG_VERSION })

  // Each op's payload MUST be a FULL CR object — apiVersion + kind + metadata.name + spec — not a
  // bare `{spec}`: the apiserver create rejects a body with no kind ("Object 'Kind' is missing").
  // The host stamps managed-by/authored-by onto metadata after this (stampAuthorship).
  const cr = (kind: string, name: string, spec: Record<string, unknown>): Record<string, unknown> => ({
    apiVersion,
    kind,
    metadata: { name, namespace },
    spec,
  })

  const ops: ApplyResourceSetOp[] = [
    {
      gvr: gvr('gitrefs'),
      namespace,
      payload: cr('GitRef', chart, { configurationRef, owner, ref: `refs/heads/${branch}`, repo }),
      verb: 'POST',
    },
  ]

  for (const path of Object.keys(held.files)) {
    ops.push({
      gvr: gvr('repocontents'),
      namespace,
      payload: cr('RepoContent', `${chart}-${pathNameSlug(path)}`, {
        branch,
        configurationRef,
        content: { [FILE_CONTENT_KEY]: path },
        message: req.message ?? `feat(${chart}): add ${path}`,
        owner,
        path: `blueprints/${chart}/${path}`,
        repo,
      }),
      verb: 'POST',
    })
  }

  ops.push({
    gvr: gvr('pullrequests'),
    namespace,
    payload: cr('PullRequest', chart, {
      base,
      body: req.body ?? `Adds the ${chart} blueprint, authored end-to-end via the Blueprint Builder.`,
      configurationRef,
      head: branch,
      owner,
      repo,
      title: req.title ?? `feat(${chart}): add ${chart} blueprint`,
    }),
    verb: 'POST',
  })

  return ops
}
