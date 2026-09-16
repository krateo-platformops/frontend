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
 * The tier the CRs in a page chart are placed in.
 *
 * ONE tier per page set, because that is the granularity the composer can honestly express: a page
 * set is one chart with one audience. `common` is the portal's own name for "every authenticated
 * user sees it", which is what a newly authored page is until someone decides otherwise. A deployer
 * remaps it to any namespace through `values.tiers.common`; splitting a single page set across
 * tiers means splitting it into two charts.
 */
const PAGE_TIER = 'common'

/**
 * The chart's own copy of the portal's `tierNamespace` helper.
 *
 * Copied rather than referenced: a page set is a SEPARATE chart now, so `portal.tierNamespace` is
 * not in scope at render time and a template calling it fails with "template not defined". Renamed
 * to `page.*` for the same reason — these are two charts with two helper namespaces, and a name
 * borrowed from the other one would only look shared.
 *
 * Empty tier → `.Release.Namespace`, which is the whole default: install the chart and its pages
 * land beside it, with RBAC tiering opt-in exactly as it is in the portal.
 */
const pageTiersPartial = (): string => `{{/*
page.tierNamespace — resolve a widget tier to a namespace.
Call: {{ include "page.tierNamespace" (dict "ctx" . "tier" "common") }}
Returns .Values.tiers.<tier> if non-empty, else .Release.Namespace.
*/}}
{{- define "page.tierNamespace" -}}
{{- $ns := index (default (dict) .ctx.Values.tiers) .tier -}}
{{- if $ns -}}{{ $ns }}{{- else -}}{{ .ctx.Release.Namespace }}{{- end -}}
{{- end -}}
`

/**
 * The generated CRD's spec, which is what `values.schema.json` IS — core-provider reads this file
 * and turns it into the CRD, so a chart without one can be published and can never be installed.
 *
 * Deliberately closed (`additionalProperties: false`) and near-empty: the pages in this chart are
 * static CRs with nothing to parameterise yet. `tiers.common` is the one thing a deployer genuinely
 * needs, because it decides which namespace the pages land in and therefore who can see them.
 *
 * It lists ONLY the tier the templates actually reference. The portal's own schema offers admin and
 * tenant beside common, and mirroring all three here would have put two knobs in the install form
 * that no template reads — a setting that silently does nothing is worse than one that isn't there.
 */
export const pageValuesSchema = (slug: string): string => `${JSON.stringify({
  $schema: 'http://json-schema.org/draft-07/schema#',
  additionalProperties: false,
  description: `Krateo Composable Portal pages — ${slug}.`,
  properties: {
    tiers: {
      additionalProperties: false,
      description: 'Which namespace this page set is created in. Empty = the release namespace.',
      properties: {
        common: { default: '', title: 'Namespace', type: 'string' },
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
/** The namespace every CR this chart ships is created in — resolved at install time, not authoring. */
const TIER_NAMESPACE = `{{ include "page.tierNamespace" (dict "ctx" . "tier" "${PAGE_TIER}") }}`

/**
 * `spec.resourcesRefs.items[]` with sibling refs pointed at the tier instead of the authoring
 * namespace. Returns a partial spread — `{}` when there is nothing to retarget — so a CR with no
 * refs, or only external ones, is dumped exactly as it was held.
 */
const retargetRefs = (cr: Record<string, unknown>, shipped: ReadonlySet<string>): Record<string, unknown> => {
  const spec = cr.spec && typeof cr.spec === 'object' ? cr.spec as Record<string, unknown> : null
  const refs = spec?.resourcesRefs && typeof spec.resourcesRefs === 'object' ? spec.resourcesRefs as Record<string, unknown> : null
  if (!Array.isArray(refs?.items)) {
    return {}
  }
  const items: unknown[] = (refs.items as unknown[]).map((item) => {
    const ref = item && typeof item === 'object' ? item as Record<string, unknown> : null
    return ref && typeof ref.name === 'string' && shipped.has(ref.name) ? { ...ref, namespace: TIER_NAMESPACE } : item
  })
  return { spec: { ...spec, resourcesRefs: { ...refs, items } } }
}

export const pageDraftFiles = (widgets: readonly unknown[]): Record<string, string> | null => {
  if (!Array.isArray(widgets) || widgets.length === 0) {
    return null
  }
  // Which CRs this chart SHIPS, by name. A parent declares each child with an explicit namespace,
  // and only the refs pointing at a sibling in this chart may be re-templated: a widget put on the
  // page by "Place existing" lives in a namespace of its own that this chart neither creates nor
  // moves, so rewriting its ref would point the page at a resource that isn't there.
  const shipped = new Set(
    widgets.map((entry) => (entry as { metadata?: { name?: unknown } })?.metadata?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0),
  )
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
    // TEMPLATED namespace, on the way OUT only. The draft objects keep the real namespace they
    // were authored in, because that is what the preview sandbox rewrites and renders; the CHART
    // must not hardcode it, or every installation of this page set lands in whichever namespace the
    // author happened to be working in. Writing the include here rather than into the held object
    // keeps those two readers from having to share one value that cannot suit both.
    //
    // Both namespaces move together or the page breaks in a way nothing reports: the CRs install
    // into the tier, but a parent still naming the authoring namespace resolves its children
    // somewhere else — a page that renders empty, with every resource present and healthy.
    files[pageDraftSlug(kind, name)] = dump(
      { ...cr, metadata: { ...metadata, namespace: TIER_NAMESPACE }, ...retargetRefs(cr, shipped) },
      { lineWidth: -1, noRefs: true, sortKeys: false },
    )
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
  // A partial (leading `_`), so Helm defines it and renders nothing from it.
  files[`${PAGE_TEMPLATES_DIR}/_tiers.tpl`] = pageTiersPartial()
  // The defaults the schema already declares, written out as values.yaml too. Helm does not require
  // it (the tier helper defaults a missing `tiers` to an empty dict), but a chart whose values are
  // only discoverable by reading a JSON Schema is a chart nobody reads the values of — and `helm
  // lint` says so. Keep it in step with pageValuesSchema; they describe the same two facts.
  files['values.yaml'] = 'tiers:\n  # Namespace this page set is created in. Empty = the release namespace.\n  common: ""\n'
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
