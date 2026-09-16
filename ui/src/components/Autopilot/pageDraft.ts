/**
 * W4 PORTAL-BUILDER (FE-P2) — the authored-PAGE held-draft seam.
 *
 * The page analogue of blueprintDraftStore (FE-BP1). A `previewPage` whose widget CR objects
 * were accepted is HELD client-side as a `{slug: yaml}` file map — EXACTLY the shape
 * blueprintDraftStore already holds — so the SAME machinery publishes it: substituteFileContent
 * (base64) fills each `{"$fileContent":"<slug>"}` token from the held YAML at compile time, the
 * blueprint preview-GATE denies a publish unless the SAME page was previewed this thread, and
 * stampAuthorship marks the ops. The page's widget CRs therefore reach the cluster ONLY via a git
 * write (→ krateo-platformops/portal → merge → OCI → the Portal composition re-renders) —
 * NEVER hand-applied (applyResourceSet's isSandboxOnlyTarget guard already denies that).
 *
 * Pure module (js-yaml + string helpers, no React/network/module-state). The provider owns the
 * shared held-draft store; the previewPage branch in finalize populates it via these helpers.
 */

import { dump } from 'js-yaml'

/** The portal-chart file convention for a page's widget CRs: `<kind-lower>.<name>.yaml`. */
export const pageDraftSlug = (kind: string, name: string): string => `${kind.toLowerCase()}.${name}.yaml`

/**
 * The Helm chart ROOT inside krateo-platformops/portal — every path a page publish writes hangs off
 * it. This is ONE constant, deliberately, because the last time it was three literals the repo moved
 * underneath them and nobody noticed for five weeks: `chart/` was renamed to `helm/portal/` on
 * 2026-08-03 and no longer exists.
 *
 * A stale prefix is INVISIBLE at publish time. The git-provider writes any path you hand it, so the
 * branch pushes, the change request opens green and the merge is clean — and then nothing renders,
 * because a file outside the chart directory is not packaged by `helm package` and is not reachable
 * by the chart's own `.Files.Glob`. Note that GitHub's rename redirect does NOT save us here: it
 * resolves a stale REPO name, so `krateo-portal-chart` still lands in the right repository, and that
 * is exactly what makes a stale PATH so easy to miss — the publish looks addressed correctly right
 * up to the point where the page silently fails to exist.
 */
export const PORTAL_PAGE_CHART_ROOT = 'helm/portal'

/**
 * The repo path for ONE held page file — the SINGLE router every WRITER shares (the legacy github
 * git-write set, the BuilderPublish claim, and the preview drawer's Files tab), so the destination
 * the user is SHOWN and the destination a publish COMMITS cannot drift apart again.
 *
 * It routes one way only, and that asymmetry is load-bearing: held keys are the identity the
 * preview gate and the `$fileContent` substitution match on, so a path that comes BACK from the UI
 * (an edited file) has to be resolved to its key first — see heldKeyForDisplayedPath.
 *
 * Held keys are bare identity tokens, not paths (the preview gate and the `$fileContent`
 * substitution match on them), so the destination is derived here instead of being baked into the
 * key.
 *
 * This used to route by key SHAPE, because a page draft carried two kinds of file: widget CRs and
 * a nav fragment bound for `files/nav-fragments/`. The fragment is gone — the sidebar now assembles
 * itself from the page roots the cluster has (portal#217), so nothing globs that directory and a
 * file written there would be bytes nobody reads. Every held key is now a widget CR.
 */
export const pagePublishPath = (key: string): string => {
  return `${PORTAL_PAGE_CHART_ROOT}/templates/${key}`
}

/**
 * A held page draft → the `{path, content}` list a BuilderPublish claim commits. The claim path is
 * the one that runs on installs with AUTOPILOT_PUBLISH_VIA_GIT_PROVIDER=true (the deployed default),
 * and it used to publish the held KEYS verbatim — dropping `flex.page-<slug>.yaml` at the REPO ROOT,
 * which renders exactly as nothing. Blueprints were unaffected because their held keys already are
 * chart-relative paths; a page's are not, so a page needs this routing applied explicitly.
 */
export const pagePublishFiles = (files: Record<string, string>): { content: string; path: string }[] =>
  Object.entries(files).map(([key, content]) => ({ content, path: pagePublishPath(key) }))

/** The page slug from its `flex.page-<slug>.yaml` root, else null (no root flex → no route → no nav). */
export const pageRootSlug = (files: Record<string, string>): string | null => {
  const root = Object.keys(files).find((slug) => /^flex\.page-[a-z0-9-]+\.yaml$/i.test(slug))
  const matched = root?.match(/^flex\.page-([a-z0-9-]+)\.yaml$/i)
  return matched ? matched[1].toLowerCase() : null
}

/**
 * A previewed page's widget CR objects → the `{slug: yaml}` file map the publish substitutes.
 * Refuses (null) a page whose any CR is missing `kind` or `metadata.name` — without both there
 * is no stable file path, and a page publish must not fabricate one. YAML is serialized here so
 * the model never has to reproduce the bytes at publish time (published == previewed).
 *
 * #106 — when the page has a `flex.page-<slug>.yaml` root, ALSO emit its nav fragment (keyed
 * `nav-fragment.<slug>.yaml`) so the builder can publish the sidebar entry WITH the page (no manual
 * menu edit). Derived from the SAME held files at record- and publish-time → part of the
 * previewed==published byte set the gate enforces.
 */
export const pageDraftFiles = (widgets: readonly unknown[]): Record<string, string> | null => {
  if (!Array.isArray(widgets) || widgets.length === 0) {
    return null
  }
  const files: Record<string, string> = {}
  for (const entry of widgets) {
    const cr = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null
    if (!cr) {
      return null
    }
    const kind = typeof cr.kind === 'string' ? cr.kind.trim() : ''
    const metadata = cr.metadata && typeof cr.metadata === 'object' ? (cr.metadata as Record<string, unknown>) : null
    const name = metadata && typeof metadata.name === 'string' ? metadata.name.trim() : ''
    if (!kind || !name) {
      return null
    }
    files[pageDraftSlug(kind, name)] = dump(cr, { lineWidth: -1, noRefs: true, sortKeys: false })
  }
  if (!Object.keys(files).length) {
    return null
  }
  return files
}

/**
 * True iff a held draft is a PAGE draft. Blueprint drafts ALWAYS carry a `Chart.yaml`
 * (createBlueprintDraft/previewBlueprint), a page draft never does — so its absence is the
 * discriminator the provider uses to pick the right identity function for the preview-gate.
 */
export const isPageDraft = (files: Record<string, string>): boolean => !('Chart.yaml' in files)

/**
 * The inverse of `pagePublishPath`, for bytes coming BACK from the UI: given a path as the preview
 * drawer DISPLAYS it, return the key that file is held under, or null if it is not a held file.
 *
 * The drawer shows a page file at its repo destination (`helm/portal/templates/flex.page-x.yaml`)
 * while the draft holds it under a bare identity token (`flex.page-x.yaml`). Handing the displayed
 * path straight to `updateFile` therefore fails its `path in held.files` check and the edit is
 * silently refused — which is why per-file editing of a PAGE has never once worked, before this
 * change or after it. A blueprint is unaffected and must stay that way: its held keys ARE repo
 * paths (`chart/templates/...`), so it matches on the first branch and is never basename-d, which
 * would collapse two templates of the same name in different directories onto each other.
 */
export const heldKeyForDisplayedPath = (path: string, files: Record<string, string>): string | null => {
  if (path in files) {
    return path
  }
  if (!isPageDraft(files)) {
    return null
  }
  // Invert by ROUTING each held key, not by taking a basename. The nav fragment is why: it is held
  // as `nav-fragment.<slug>.yaml` but lands as `<slug>.yaml` in a different directory, so its
  // filename is not its key and a basename resolves it to nothing. Routing forward and comparing
  // is exact for every shape, and stays exact if the routing rules change.
  return Object.keys(files).find((key) => pagePublishPath(key) === path) ?? null
}

/**
 * The page's STABLE identity for the preview-gate (`page:<root-slug>`): the root page flex
 * (`flex.page-<slug>.yaml`, the portal's page-root convention), else the first CR's slug. Computed
 * identically at record-time (previewPage) and publish-time from the SAME held files, so the
 * gate match is deterministic. A publish whose held page was never previewed → identity absent
 * from the gate's previewed set → DENIED (same invariant as the blueprint gate).
 */
export const pageDisplayName = (files: Record<string, string>): string => {
  const slugs = Object.keys(files)
  const root = slugs.find((slug) => /^flex\.page-[a-z0-9-]+\.yaml$/i.test(slug))
  const pick = root ?? slugs[0] ?? ''
  return pick ? `page:${pick.replace(/\.yaml$/i, '')}` : 'page:draft'
}
