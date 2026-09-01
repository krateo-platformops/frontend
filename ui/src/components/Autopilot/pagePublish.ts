/**
 * FE-BP7 — DETERMINISTIC portal-page-publish op construction (frontend-constructs-ops, PAGE variant).
 *
 * WHY THIS EXISTS: the Portal Builder publish is the SAME heterogeneous multi-op git write that
 * FE-BP6 solved for blueprints — one `gitrefs` op to cut the builder branch, one `repocontents`
 * op PER page file (each carrying a `{"$fileContent": "<slug>"}` token), then one `pullrequests`
 * op — only the target repo (krateo-platformops/portal) and the file→path routing differ. So
 * it hits the exact same two failure modes: gemini-2.5-pro STALLS hand-writing the whole payload
 * (it narrates instead of emitting the fence → no blast-radius dialog → the publish silently dies)
 * and the ops it does emit are bare `{spec}` bodies the apiserver rejects ("Object 'Kind' is
 * missing"). The page publish is EVEN more fragile than the blueprint one because the old prompt
 * also asked the model to supply the portal-chart `main` HEAD sha, which it usually does not have.
 *
 * THE FIX (mirrors blueprintPublish.ts): the model emits ONE tiny `publishPage` verb with just the
 * repo coordinates, and the HOST builds the op set from the already-HELD previewed page draft (the
 * `{slug: yaml}` map recordPagePreview stored). The resulting ops flow through the SAME
 * compilePublishOps pipeline ($fileContent → base64 substitution + authorship stamp) and the SAME
 * blast-radius confirm — this module only assembles the ordered op list; it never bypasses a gate.
 *
 * FILE→PATH ROUTING is the one thing this adds over the blueprint variant: a page draft holds two
 * kinds of file — widget CRs keyed `<kind-lower>.<name>.yaml` (→ `chart/templates/<key>`) and the
 * auto-generated sidebar nav fragment keyed `nav-fragment.<slug>.yaml` (→
 * `chart/files/nav-fragments/<slug>.yaml`, globbed by menu.sidebar-nav.yaml so the /<slug> sidebar
 * entry ships WITH the page). The gitref sha is OMITTED (the git-provider auto-resolves the base
 * HEAD) — the model never has to source it.
 */

import type { ApplyResourceSetGvr, ApplyResourceSetOp } from './applyResourceSet'
import { FILE_CONTENT_KEY, type BlueprintDraftHeld } from './blueprintDraftStore'
import { GITHUB_KOG_GROUP, GITHUB_KOG_VERSION } from './blueprintPublish'
import { pageNavFragmentPath, pageNavFragmentSlug } from './pageDraft'

/**
 * Repo coordinates for a page publish. The model supplies these simple scalars from its prompt
 * (which it does reliably); each falls back to the portal-chart default if omitted, so a publish is
 * robust even when the model drops a field. These mirror the constants baked into the PORTAL BUILDER
 * prompt — the single source stays the prompt/model, not this file.
 */
// NON-repo install defaults for the legacy github git-write path (base branch, the git-provider
// credentials Secret name, the CR namespace). The publish OWNER/REPO are NOT here — they are never
// hardcoded in source; they come only from install config (AUTOPILOT_PAGE_BUILDER_REPO) or the
// human-confirmed publish destination. A config-less install prefills nothing and the human supplies
// the destination (or the publish is denied) — no baked-in repo can silently point at the wrong place.
export const PORTAL_CHART_REPO_DEFAULTS = {
  base: 'main',
  configurationRef: 'github-blueprints-config',
  namespace: 'krateo-system',
} as const

/** The `publishPage` verb payload — repo coords only; the file set comes from the held page draft. */
export interface PagePublishRequest {
  owner?: string
  repo?: string
  base?: string
  namespace?: string
  configurationRef?: string
  title?: string
  body?: string
  message?: string
}

/** DNS-1123-ish name segment from a held-file slug (a RepoContent needs a unique metadata.name per file). */
const pathNameSlug = (path: string): string => path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * Fan a `publishPage` request out into the ordered git-write op set for the HELD page draft:
 *   1. POST gitrefs      — create `refs/heads/builder/page-<slug>` (sha omitted; the git-provider
 *                          auto-resolves the base-branch HEAD).
 *   2. POST repocontents — one per held file, content = the `{"$fileContent": "<slug>"}` token
 *                          (compilePublishOps substitutes the previewed bytes as base64). Widget CRs
 *                          land under `chart/templates/`; the nav fragment under
 *                          `chart/files/nav-fragments/` (so the sidebar entry ships with the page).
 *   3. POST pullrequests — open the PR from the builder branch into `base`.
 * The branch/paths are DERIVED from the page slug so the model never has to match them. Each op's
 * payload is a FULL CR object (apiVersion + kind + metadata.name + spec) — a bare `{spec}` is
 * rejected by the apiserver create ("Object 'Kind' is missing"). Object keys are alphabetized (repo
 * eslint sort-keys). The op count is 2 + files — the caller enforces the MAX_APPLY_SET_OPS cap.
 */
export const buildPagePublishOps = (
  req: PagePublishRequest,
  held: BlueprintDraftHeld,
  slug: string,
): ApplyResourceSetOp[] => {
  const owner = req.owner ?? ''
  const repo = req.repo ?? ''
  const base = req.base ?? PORTAL_CHART_REPO_DEFAULTS.base
  const namespace = req.namespace ?? PORTAL_CHART_REPO_DEFAULTS.namespace
  const configurationRef = { name: req.configurationRef ?? PORTAL_CHART_REPO_DEFAULTS.configurationRef }
  const page = `page-${slug}`
  const branch = `builder/${page}`
  const navKey = pageNavFragmentSlug(slug)
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
      payload: cr('GitRef', page, { configurationRef, owner, ref: `refs/heads/${branch}`, repo }),
      verb: 'POST',
    },
  ]

  // Widget CRs (kind-lower.name.yaml) → chart/templates/; the nav fragment (nav-fragment.<slug>.yaml)
  // → chart/files/nav-fragments/<slug>.yaml. Insertion order (widgets first, nav fragment last) is
  // preserved by pageDraftFiles, so iterating the held keys yields widgets-then-nav deterministically.
  for (const key of Object.keys(held.files)) {
    const path = key === navKey ? pageNavFragmentPath(slug) : `chart/templates/${key}`
    ops.push({
      gvr: gvr('repocontents'),
      namespace,
      payload: cr('RepoContent', `${page}-${pathNameSlug(key)}`, {
        branch,
        configurationRef,
        content: { [FILE_CONTENT_KEY]: key },
        message: req.message ?? `feat(${page}): add ${path}`,
        owner,
        path,
        repo,
      }),
      verb: 'POST',
    })
  }

  ops.push({
    gvr: gvr('pullrequests'),
    namespace,
    payload: cr('PullRequest', page, {
      base,
      body: req.body ?? `Adds the ${page} portal page and its /${slug} sidebar entry, authored end-to-end via the Portal Builder.`,
      configurationRef,
      head: branch,
      owner,
      repo,
      title: req.title ?? `builder: page ${slug}`,
    }),
    verb: 'POST',
  })

  return ops
}
