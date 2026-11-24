/**
 * A CHART MAY NOT CARRY ITS OWN DEFINITION (Diego, 2026-11-24). A blueprint may hold any resource the
 * cluster serves, CompositionDefinitions of OTHER charts included. One that registers the chart it is part
 * of would let a composition rewrite or delete its own registration.
 *
 * Judged twice, with core-provider's matching rule (its chart gate judges the rendered manifest too):
 *   - on the template text, in the lint, before anything is rendered. A chart name built from a template
 *     expression is not one yet, so it is not judged there;
 *   - on the RENDERED objects of a preview, which is what would be installed. A render that carries it is
 *     a failed render, so it never arms a publish. A template behind a `lookup` gate is not rendered.
 * An own definition no one can tell is one (no chart named at all) is not refused: nothing says it is.
 */
import { load } from 'js-yaml'

type Json = Record<string, unknown>
const asRecord = (value: unknown): Json | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null)

const GROUP = /^core\.krateo\.io(?:\/|$)/
const SEMVER_ARCHIVE = /^\d+\.\d+\.\d+[^/]*\.tgz$/

/** Whether a CompositionDefinition's `spec.chart` names this chart: its repo, its OCI path, or its archive. */
export const namesChart = (chart: { repo?: unknown; url?: unknown }, name: string): boolean => {
  if (chart.repo === name) { return true }
  if (typeof chart.url !== 'string') { return false }
  const path = chart.url.trim().replace(/[?#].*$/, '').replace(/\/+$/, '')
  const last = path.slice(path.lastIndexOf('/') + 1)
  const bare = last.replace(/@.*$/, '').replace(/:[^:]*$/, '')
  return bare === name || (last.startsWith(`${name}-`) && SEMVER_ARCHIVE.test(last.slice(name.length + 1)))
}

const problem = (where: string, name: string): string =>
  `${where}: this CompositionDefinition installs the chart it is part of (${name}), so a composition could rewrite or delete its own registration. Remove it: the portal writes compositiondefinition.yaml when you publish.`

/** A scalar as written, unquoted and without its comment. A template expression in it stays as it is, and so never equals a name. */
const scalar = (raw: string): string => {
  const value = raw.trim()
  const quoted = /^(["'])(.*?)\1\s*(?:#.*)?$/.exec(value)
  return quoted ? quoted[2] : value.replace(/\s+#.*$/, '')
}

/** The `spec.chart` of one YAML document's text, read by its indentation. */
const chartIn = (text: string): { repo?: string; url?: string } => {
  const lines = text.split('\n')
  const at = lines.findIndex((line) => /^\s+chart:\s*(?:#.*)?$/.test(line))
  const found: { repo?: string; url?: string } = {}
  if (at === -1) { return found }
  const indent = lines[at].search(/\S/)
  let inside: number | null = null
  for (const line of lines.slice(at + 1)) {
    const own = line.search(/\S/)
    const skip = own === -1 || /^\s*(?:#|\{\{)/.test(line)
    if (!skip && own <= indent) { break }
    if (!skip) {
      inside ??= own
      const field = own === inside ? /^\s*(repo|url):(.+)$/.exec(line) : null
      if (field) { found[field[1] as 'repo' | 'url'] = scalar(field[2]) }
    }
  }
  return found
}

/** The lint: templates whose literal text registers this very chart. */
export const ownDefinitionProblems = (files: Readonly<Record<string, string>>, name: string | null): string[] => {
  if (!name) { return [] }
  return Object.keys(files).filter((path) => path.startsWith('templates/') && /\.(?:ya?ml|tpl)$/.test(path)).sort()
    .filter((path) => files[path].split(/^---.*$/m).some((text) =>
      /^kind:\s*["']?CompositionDefinition["']?\s*(?:#.*)?$/m.test(text)
      && /^apiVersion:\s*["']?core\.krateo\.io\//m.test(text)
      && namesChart(chartIn(text), name)))
    .map((path) => problem(path, name))
}

/** A render whose objects register this very chart did not render something publishable: it says so as its error. */
export const refuseOwnDefinition = <Rendered extends { error?: string; objects: readonly { apiVersion?: string; kind?: string; name?: string; yaml?: string }[] }>(rendered: Rendered, name: string | null): Rendered => {
  if (rendered.error || !name) { return rendered }
  const own = rendered.objects.find(({ apiVersion, kind, yaml }) => {
    if (kind !== 'CompositionDefinition' || !GROUP.test(apiVersion ?? '')) { return false }
    let parsed: unknown
    try {
      parsed = load(yaml ?? '')
    } catch {
      return false
    }
    return namesChart(asRecord(asRecord(asRecord(parsed)?.spec)?.chart) ?? {}, name)
  })
  return own ? { ...rendered, error: problem(`CompositionDefinition ${own.name ?? ''}`.trim(), name) } : rendered
}
