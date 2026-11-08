/**
 * The Chart.yaml fields the krateo-blueprints publishing standard requires of every chart a builder
 * generates (krateo-blueprints/charts PUBLISHING.md). The blueprints index publishes the exact
 * archive GHCR holds, and release-oci packages the committed tree, so whatever these fields say has
 * to be in the Chart.yaml that is COMMITTED. Nothing downstream adds them.
 *
 * WHEN EACH ONE IS WRITTEN:
 *   - At START, as a convenience: `keywords`, `icon` and, for a page set,
 *     `annotations["krateo.io/kind"]` are known the moment a chart starts, so each builder's start
 *     writes them (startChart.ts, controllerStart.ts, pageDraft.ts pageChartYaml). The author sees
 *     them in the Files tab and may change them.
 *   - At PUBLISH, as the guarantee (publishDraft.ts runDraftPublish, withPublishingFields): every
 *     field still MISSING from the Chart.yaml the claim commits is filled in. That covers `sources`,
 *     which names the generated repository and so cannot be known at start (the destination is
 *     confirmed in the publish form, and builderTargets.ts deliberately has no fallback), and it
 *     covers a draft started before the start-time fields existed, or one whose author deleted
 *     them: without them the index refuses the chart's first release.
 *
 * Pure module: no React, no network, no module state.
 */
import { type Document, isMap, isScalar, isSeq, parseDocument } from 'yaml'

import type { DraftKindName } from '../../builders/draftKinds'

/**
 * The https icon every chart carries unless its author chose another. The blueprints index refuses a
 * chart without one (it logs "it needs an https icon in Chart.yaml" and skips the release's index
 * job), so a chart without it is released and silently left out.
 */
export const CHART_ICON = 'https://raw.githubusercontent.com/krateo-platformops/.github/main/brand/logo.svg'

/**
 * The ONE keyword each builder seeds: its kind. Keywords are Marketplace filter chips (the
 * standard's rule 3), so a word true of every chart (`krateo`, `helm`, `chart`) filters nothing and
 * is never seeded. Domain words are the author's to add.
 */
export const CHART_KEYWORD = {
  blueprint: 'blueprint',
  controller: 'controller',
  page: 'page-set',
} as const satisfies Record<DraftKindName, string>

/** The annotation the blueprints index routes a chart by; a page set's value sends it to the `pages` channel, off the Marketplace. */
export const KRATEO_KIND_ANNOTATION = 'krateo.io/kind'

/** Two repository URLs name the same repository: hosts and owners are case-insensitive, and a clone URL's `.git` or a trailing slash changes nothing. */
const sameRepository = (left: string, right: string): boolean => {
  const normal = (url: string): string => url.trim().toLowerCase()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  return normal(left) === normal(right)
}

/** A key with no value at all: absent, or written with nothing after the colon. */
const isAbsent = (node: unknown): boolean => node === undefined || node === null || (isScalar(node) && node.value === null)

/** One field's fill: true when it changed the document. Each leaves an author's value alone. */
type Fill = (doc: Document) => boolean

/** `sources`: the publishing repository, appended once after the author's own entries. */
const fillSource = (repoUrl: string): Fill => (doc) => {
  const sources = doc.get('sources', true)
  if (isAbsent(sources)) {
    doc.set('sources', doc.createNode([repoUrl]))
    return true
  }
  // A `sources` that is not a list (a scalar or a mapping, which Helm refuses) is the author's to fix.
  if (!isSeq(sources) || sources.items.some((item) => isScalar(item) && typeof item.value === 'string' && sameRepository(item.value, repoUrl))) {
    return false
  }
  sources.add(doc.createNode(repoUrl))
  return true
}

/** `keywords`: the builder's kind, only when there are none. A non-empty list is the author's, even without the kind. */
const fillKeywords = (kind: DraftKindName): Fill => (doc) => {
  const keywords = doc.get('keywords', true)
  if (!isAbsent(keywords) && !(isSeq(keywords) && keywords.items.length === 0)) {
    return false
  }
  doc.set('keywords', doc.createNode([CHART_KEYWORD[kind]]))
  return true
}

/** `icon`: the shared brand icon, only when there is none. An empty string is no icon. */
const fillIcon: Fill = (doc) => {
  const icon = doc.get('icon', true)
  if (!isAbsent(icon) && !(isScalar(icon) && icon.value === '')) {
    return false
  }
  doc.set('icon', CHART_ICON)
  return true
}

/** A page set's `krateo.io/kind: page-set`, only when the annotation is absent. */
const fillPageSetKind: Fill = (doc) => {
  const annotations = doc.get('annotations', true)
  if (isAbsent(annotations)) {
    doc.set('annotations', doc.createNode({ [KRATEO_KIND_ANNOTATION]: CHART_KEYWORD.page }))
    return true
  }
  // Annotations that are not a mapping are the author's to fix; one already set is the author's value.
  if (!isMap(annotations) || annotations.has(KRATEO_KIND_ANNOTATION)) {
    return false
  }
  annotations.set(KRATEO_KIND_ANNOTATION, CHART_KEYWORD.page)
  return true
}

/**
 * `chartYaml` with every publishing field that is MISSING filled in, for a chart of draft kind
 * `kind` published to `repoUrl`. Nothing the author wrote is overwritten:
 *   - `sources`: added when absent or empty; the repository appended after the author's entries;
 *     nothing when it already names the repository (so publishing twice never lists it twice);
 *   - `keywords`: the kind's one keyword when absent or empty; a non-empty list is left alone;
 *   - `icon`: CHART_ICON when absent or empty; an author's icon is left alone;
 *   - a page set's `annotations["krateo.io/kind"]`: `page-set` when absent.
 * When nothing is missing the text comes back unchanged, byte for byte.
 *
 * Edited as a YAML DOCUMENT rather than loaded and dumped, so the author's comments, key order and
 * quoting survive: a load/dump round trip would publish a Chart.yaml the author did not write.
 *
 * A Chart.yaml that does not parse, or is not a mapping, comes back unchanged. The chart lint refuses
 * one before any publish gets here, and filling fields into it would be a guess.
 */
export const withPublishingFields = (chartYaml: string, kind: DraftKindName, repoUrl: string): string => {
  const doc = parseDocument(chartYaml)
  if (doc.errors.length || !isMap(doc.contents)) {
    return chartYaml
  }
  const fills: Fill[] = [fillIcon, fillKeywords(kind), ...(kind === 'page' ? [fillPageSetKind] : []), fillSource(repoUrl)]
  // Every fill runs: `some` would stop at the first that changed something.
  const changed = fills.map((fill) => fill(doc)).includes(true)
  return changed ? doc.toString({ lineWidth: 0 }) : chartYaml
}
