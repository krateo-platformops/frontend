/**
 * A CHART MAY NOT CARRY ITS OWN DEFINITION (Diego, 2026-11-24). A blueprint may hold any resource the
 * cluster serves, CompositionDefinitions of OTHER charts included. One that registers the chart it is part
 * of would let a composition rewrite or delete its own registration.
 *
 * Judged twice, by the matcher core-provider's chart gate uses too (chartReference.ts):
 *   - on the template text, in the lint, before anything is rendered. A chart name built from a template
 *     expression is not one yet, so it is not judged there (an expression elsewhere, such as the registry,
 *     does not hide a literal name);
 *   - on the RENDERED objects of a preview, which is what would be installed. A render that carries it is
 *     a failed render, so it never arms a publish. A template behind a `lookup` gate is not rendered.
 * A definition whose chart no one can tell is not refused here: nothing says it is this one.
 */
import { load } from 'js-yaml'

import { chartReference, definitionsIn, registersChart } from './chartReference'

const problem = (where: string, name: string): string =>
  `${where}: this CompositionDefinition installs the chart it is part of (${name}), so a composition could rewrite or delete its own registration. Remove it: the portal writes compositiondefinition.yaml when you publish.`

/** A template expression in a name or a path: a name no chart has. It keeps the rest of the reference readable. */
const EXPRESSION = 'templated-expression'

/** A scalar as written, unquoted and without its comment, its template expressions replaced. */
const scalar = (raw: string): string => {
  const value = raw.replace(/\{\{.*?\}\}/g, EXPRESSION).trim()
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
      && registersChart(chartReference(chartIn(text)), name)))
    .map((path) => problem(path, name))
}

/** A render whose objects register this very chart did not render something publishable: it says so as its error. */
export const refuseOwnDefinition = <Rendered extends { error?: string; objects: readonly { apiVersion?: string; kind?: string; name?: string; yaml?: string }[] }>(rendered: Rendered, name: string | null): Rendered => {
  if (rendered.error || !name) { return rendered }
  const own = rendered.objects.flatMap(({ apiVersion, kind, yaml }) => {
    let parsed: unknown
    try {
      parsed = load(yaml ?? '')
    } catch {
      return []
    }
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? definitionsIn(parsed as Record<string, unknown>, apiVersion ?? '', kind ?? '')
      : []
  }).find(({ reference }) => registersChart(reference, name))
  return own ? { ...rendered, error: problem(`CompositionDefinition ${own.name}`.trim(), name) } : rendered
}
