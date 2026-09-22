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

import { dump, load } from 'js-yaml'

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
/**
 * The `CompositionDefinition` that REGISTERS a published page set, written at the repo root.
 *
 * Without one, a page set releases to OCI and nothing ever installs it: core-provider generates the
 * CRD from `values.schema.json` and serves it as `composition.krateo.io/v<version>/<plural>`, and
 * only then can a claim of that Kind put the pages on the cluster. The chart alone is inert.
 *
 * It is written at PUBLISH time rather than into the held draft because it is the one file that
 * depends on the DESTINATION — the OCI url is `<owner>/charts/<chart name>`, and the owner is not
 * known until the human confirms it. That also means it overwrites the copy a template scaffold
 * brings in, which still names the template's own chart.
 *
 * `CHART_VERSION` is the placeholder the release workflow stamps, and the stamped copy is attached
 * to the GitHub release — so this file is applied FROM THE RELEASE, never from the branch. Writing
 * a real version here would register a chart version that does not exist yet.
 */
export const pageCompositionDefinition = (slug: string, owner: string): string => `# REGISTERS this page set as installable. Apply the STAMPED copy from the GitHub release, not this
# one: the branch carries the CHART_VERSION placeholder, and registering that pins a chart version
# that was never published.
#
#   kubectl apply -f https://github.com/${owner}/${slug}/releases/download/<tag>/compositiondefinition.yaml
#
# Install it WHERE THE PORTAL IS — the pages must land in namespaces the portal's RBAC covers.
apiVersion: core.krateo.io/v1alpha1
kind: CompositionDefinition
metadata:
  name: ${slug}
  namespace: krateo-system
spec:
  chart:
    url: oci://ghcr.io/${owner}/charts/${slug}
    version: CHART_VERSION
`

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
/**
 * The INVERSE of pageDraftFiles: the held tree back to the widget CRs it was built from.
 *
 * WHY THIS HAS TO EXIST. `pageDraftFiles` is where a set of CRs becomes a chart, and until now that
 * was a one-way door: the composer's canvas reads the held YAML, but the only consumer that needed
 * OBJECTS — the preview apply — was handed them by whoever started the draft and never asked again.
 * So the sandbox was seeded once and then drifted from the draft with every edit, which is exactly
 * as wrong as it sounds: a Row dragged onto the canvas was in the tree, in the files and in the
 * publish set, and absent from the thing labelled "Rendered (live)".
 *
 * THE TEMPLATED NAMESPACE COMES BACK AS-IS, deliberately. `pageDraftFiles` writes
 * `{{ include "page.tierNamespace" ... }}` into metadata.namespace so the CHART does not hardcode
 * an authoring namespace. Reversing that here would mean guessing which namespace it came from.
 * It does not need reversing: `rewriteDraftsForSandbox` FORCES the namespace to the sandbox before
 * anything is applied, so the include is overwritten rather than resolved. Anything that starts
 * applying these objects WITHOUT that rewrite has to resolve the namespace itself first.
 *
 * Non-template files (Chart.yaml, values, the tier helper) are not widgets and are skipped. A file
 * that does not parse, or parses to something that is not a CR, is skipped rather than failing the
 * whole set: one malformed file should cost its own widget, not the preview.
 */
export const pageDraftWidgets = (files: Record<string, string>): Record<string, unknown>[] => {
  const widgets: Record<string, unknown>[] = []
  for (const key of Object.keys(files).sort()) {
    if (!key.startsWith(`${PAGE_TEMPLATES_DIR}/`) || !key.endsWith('.yaml')) {
      continue
    }
    let parsed: unknown
    try {
      parsed = load(files[key])
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      continue
    }
    const cr = parsed as Record<string, unknown>
    const metadata = cr.metadata && typeof cr.metadata === 'object' ? (cr.metadata as Record<string, unknown>) : null
    if (typeof cr.kind !== 'string' || !cr.kind || !metadata || typeof metadata.name !== 'string' || !metadata.name) {
      continue
    }
    widgets.push(cr)
  }
  return widgets
}

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
