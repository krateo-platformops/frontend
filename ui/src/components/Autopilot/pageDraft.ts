/**
 * W4 PORTAL-BUILDER (FE-P2) — the authored-PAGE held-draft seam.
 *
 * The page analogue of blueprintDraftStore (FE-BP1). A `previewPage` whose widget CR objects
 * were accepted is HELD client-side as a `{path: yaml}` file map — EXACTLY the shape
 * blueprintDraftStore already holds — so the SAME machinery publishes it: substituteFileContent
 * (base64) fills each `{"$fileContent":"<path>"}` token from the held YAML at compile time, the
 * blueprint preview-GATE denies a publish unless the SAME page was previewed this thread, and
 * stampAuthorship marks the ops. The page's widget CRs therefore reach the cluster ONLY via a git
 * write (→ the page set's own repo → merge → OCI → its composition renders them) — NEVER
 * hand-applied (applyResourceSet's isSandboxOnlyTarget guard already denies that).
 *
 * A PAGE SET IS ITS OWN CHART. It used to be a handful of loose widget CRs posted into the portal's
 * one chart, which meant every page a person authored rode the portal's release cadence and grew
 * the one Helm release record that is already at 94% of its 1 MiB Secret ceiling — a ceiling the
 * portal has crossed once, after which Helm silently stopped recording releases. Emitting a chart
 * per page set means the keys held here are chart-relative from the start (`Chart.yaml`,
 * `values.schema.json`, `templates/…`), exactly as a blueprint's always were, and everything
 * downstream commits them verbatim rather than routing them somewhere.
 *
 * Pure module (js-yaml + string helpers, no React/network/module-state). The provider owns the
 * shared held-draft store; the previewPage branch in finalize populates it via these helpers.
 */

import { dump } from 'js-yaml'

import type { BlueprintDraftHeld } from './blueprintDraftStore'

/** Where a page chart keeps its widget CRs — the same place any Helm chart keeps its templates. */
export const PAGE_TEMPLATES_DIR = 'templates'

/** The chart-relative key for one of a page's widget CRs: `templates/<kind-lower>.<name>.yaml`. */
export const pageDraftSlug = (kind: string, name: string): string =>
  `${PAGE_TEMPLATES_DIR}/${kind.toLowerCase()}.${name}.yaml`

/** The page ENTRY, at its chart-relative key. previewPageV2 refuses a draft set without one. */
const PAGE_ROOT_KEY = /^templates\/flex\.page-([a-z0-9-]+)\.yaml$/i

/**
 * The chart metadata a page set ships with.
 *
 * `version: CHART_VERSION` is the placeholder the org's release workflow substitutes from the git
 * tag — the same convention portal-builder-template and every Krateo chart use. Writing a real
 * version here would mint a chart claiming a version nothing published.
 *
 * The NAME becomes the generated CRD's Kind, so it is the page slug: a page set called
 * `fleet-health` installs as `FleetHealth`. That is also why it must be a valid DNS name, which the
 * slug already is.
 */
export const pageChartYaml = (slug: string): string => dump({
  apiVersion: 'v2',
  appVersion: 'CHART_VERSION',
  description: `Krateo Composable Portal pages — ${slug}.`,
  name: slug,
  type: 'application',
  version: 'CHART_VERSION',
}, { lineWidth: -1, noRefs: true, sortKeys: false })

/**
 * The generated CRD's spec, which is what `values.schema.json` IS — core-provider reads this file
 * and turns it into the CRD, so a chart without one can be published and can never be installed.
 *
 * Deliberately closed (`additionalProperties: false`) and near-empty: the pages in this chart are
 * static CRs with nothing to parameterise yet. `tiers` is the one thing a deployer genuinely needs,
 * because it decides which namespace the pages land in and therefore who can see them.
 */
export const pageValuesSchema = (slug: string): string => `${JSON.stringify({
  $schema: 'http://json-schema.org/draft-07/schema#',
  additionalProperties: false,
  description: `Krateo Composable Portal pages — ${slug}.`,
  properties: {
    tiers: {
      additionalProperties: false,
      description: 'Which namespace each page tier is created in. Empty = the release namespace.',
      properties: {
        admin: { default: '', title: 'Admin tier namespace', type: 'string' },
        common: { default: '', title: 'Common tier namespace', type: 'string' },
        tenant: { default: '', title: 'Tenant tier namespace', type: 'string' },
      },
      title: 'Namespace tiers',
      type: 'object',
    },
  },
  title: slug,
  type: 'object',
}, null, 2)}\n`

/**
 * The repo path for ONE held page file — now the identity function, and kept only so the seam has
 * a name while callers migrate.
 *
 * It used to prefix `helm/portal/templates/`, because a page's held keys were bare identity tokens
 * and its files were destined for the PORTAL's chart. A page set is its own chart now: its keys are
 * already chart-relative (`templates/flex.page-x.yaml`, `Chart.yaml`), exactly as a blueprint's
 * always were, so there is nothing left to route. Prefixing them a second time is precisely the
 * double-prefix bug this module used to warn about, with the sides swapped.
 */
export const pagePublishPath = (key: string): string => key

/** The page slug from its `flex.page-<slug>.yaml` root, else null (no root flex → no route → no nav). */
export const pageRootSlug = (files: Record<string, string>): string | null => {
  const root = Object.keys(files).find((key) => PAGE_ROOT_KEY.test(key))
  const matched = root?.match(PAGE_ROOT_KEY)
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

  // THE CHART, not just its templates. A page set publishes as its own Helm chart now, which is
  // what lets it ship on its own cadence instead of forcing a portal release for every authored
  // page — and what keeps it out of the portal's release record, which sits at 94% of the 1 MiB
  // Secret cap that already forced one split.
  //
  // Both files are REQUIRED, for different reasons. Without Chart.yaml there is no chart at all.
  // Without values.schema.json core-provider cannot build the CRD, so the chart publishes, merges,
  // releases, and then wedges the CompositionDefinition at Ready=False — several layers and one
  // merge away from the cause.
  const slug = pageRootSlug(files)
  if (!slug) {
    // No `page-<slug>` root means no page ENTRY, and nothing to name the chart after. Refusing
    // beats emitting a chart called after whichever file happened to sort first.
    return null
  }
  files['Chart.yaml'] = pageChartYaml(slug)
  files['values.schema.json'] = pageValuesSchema(slug)
  return files
}

/**
 * True iff a held draft was authored by the PAGE builder.
 *
 * Reads the kind the writer recorded rather than sniffing the file set. It used to be
 * `!('Chart.yaml' in files)` — sound only while a page was a bag of widget CRs and could never
 * carry a chart. A page that ships as its own chart inverts that test silently, so the fact is
 * carried now instead of re-derived from a coincidence.
 */
export const isPageDraft = (held: Pick<BlueprintDraftHeld, 'kind'>): boolean => held.kind === 'page'

/**
 * The inverse of `pagePublishPath` — now trivial, and kept because `updateDisplayedFile` still
 * calls it and blueprint drafts still need the `path in files` check.
 *
 * A page's key used to differ from the path the drawer displayed, so an edit coming BACK from the
 * UI had to be inverted before the store would accept it. Both are chart-relative now, so the
 * first branch matches for a page exactly as it always did for a blueprint, and the page-specific
 * inversion below is unreachable — left as an explicit null rather than silently falling through.
 */
export const heldKeyForDisplayedPath = (path: string, held: BlueprintDraftHeld): string | null =>
  (path in held.files ? path : null)

/**
 * The page's STABLE identity for the preview-gate (`page:<root-slug>`): the root page flex
 * (`flex.page-<slug>.yaml`, the portal's page-root convention), else the first CR's slug. Computed
 * identically at record-time (previewPage) and publish-time from the SAME held files, so the
 * gate match is deterministic. A publish whose held page was never previewed → identity absent
 * from the gate's previewed set → DENIED (same invariant as the blueprint gate).
 */
export const pageDisplayName = (files: Record<string, string>): string => {
  const root = Object.keys(files).find((key) => PAGE_ROOT_KEY.test(key))
  // The root, or nothing. It used to fall back to `slugs[0]`, which was harmless while every key
  // was a widget CR and became a bug the moment a page carried a chart: the first key sorts to
  // `Chart.yaml`, so a rootless draft identified itself as `page:Chart`. An identity that names the
  // wrong file is worse than one that admits it does not know — the publish gate matches on it.
  return root ? `page:${root.replace(/^templates\//, '').replace(/\.yaml$/i, '')}` : 'page:draft'
}
