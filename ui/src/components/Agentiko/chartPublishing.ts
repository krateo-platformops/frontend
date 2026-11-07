/**
 * The Chart.yaml fields the krateo-blueprints publishing standard requires of every chart a builder
 * generates (krateo-blueprints/charts PUBLISHING.md). The blueprints index publishes the exact
 * archive GHCR holds, and release-oci packages the committed tree, so whatever these fields say has
 * to be in the Chart.yaml that is COMMITTED. Nothing downstream adds them.
 *
 * WHEN EACH ONE IS WRITTEN:
 *   - `keywords`, `icon` and, for a page set, `annotations["krateo.io/kind"]` are known the moment a
 *     chart starts, so each builder's start writes them (startChart.ts, controllerStart.ts,
 *     pageDraft.ts pageChartYaml). The author sees them in the Files tab and may change them.
 *   - `sources` names the generated repository, which is NOT known when a chart starts: the
 *     destination is confirmed in the publish form, and builderTargets.ts deliberately has no
 *     fallback. So it is written at publish (publishDraft.ts runDraftPublish), from the confirmed
 *     owner/repo, into the Chart.yaml the claim commits (withChartSource).
 *
 * Pure module: no React, no network, no module state.
 */
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'

import type { DraftKindName } from '../../builders/draftKinds'

/**
 * The https icon every started chart carries. The blueprints index refuses a chart without one (it
 * logs "it needs an https icon in Chart.yaml" and skips the release's index job), so a chart without
 * it is released and silently left out. The author can point it at another image in the Files tab.
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

/**
 * `chartYaml` with `repoUrl` in its `sources`, MERGED into what the author wrote:
 *   - no `sources` (or an empty one): `sources: [repoUrl]` is added;
 *   - a `sources` list without it: it is appended, after the author's own entries;
 *   - a `sources` list that already names it: the text comes back unchanged, byte for byte, so
 *     publishing the same chart twice never lists the repository twice.
 *
 * Edited as a YAML DOCUMENT rather than loaded and dumped, so the author's comments, key order and
 * quoting survive: a load/dump round trip would publish a Chart.yaml the author did not write.
 *
 * A Chart.yaml that does not parse, is not a mapping, or carries a `sources` that is not a list (a
 * scalar or a mapping, which Helm refuses) comes back unchanged. The chart lint refuses an
 * unparsable Chart.yaml before any publish gets here; rewriting a malformed `sources` would be
 * overwriting the author's value with a guess.
 */
export const withChartSource = (chartYaml: string, repoUrl: string): string => {
  const doc = parseDocument(chartYaml)
  if (doc.errors.length || !isMap(doc.contents)) {
    return chartYaml
  }
  const sources = doc.get('sources', true)
  if (sources === undefined || sources === null || (isScalar(sources) && sources.value === null)) {
    doc.set('sources', doc.createNode([repoUrl]))
    return doc.toString({ lineWidth: 0 })
  }
  if (!isSeq(sources)) {
    return chartYaml
  }
  if (sources.items.some((item) => isScalar(item) && typeof item.value === 'string' && sameRepository(item.value, repoUrl))) {
    return chartYaml
  }
  sources.add(doc.createNode(repoUrl))
  return doc.toString({ lineWidth: 0 })
}
