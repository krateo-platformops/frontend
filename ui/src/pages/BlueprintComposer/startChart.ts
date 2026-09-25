/**
 * Seed an empty blueprint chart — the Start modal's kernel. Pure.
 *
 * WHAT IT SEEDS, and why each file is there:
 *   Chart.yaml                  names the chart; core-provider derives the generated Kind and API
 *                               version from its name and version. (The draft is a BLUEPRINT
 *                               because the store records it as one, not because this file exists.)
 *   values.yaml                 the defaults; empty until the author places a field.
 *   values.schema.json          IS the generated CRD's spec — core-provider refuses a chart without
 *                               one. `{type: object, properties: {}}` and nothing else: an object or
 *                               array `default` is the core-provider#46 wedge (lintBlueprintDraft).
 *   templates/architecture.yaml the empty descriptor, wrapped as the ConfigMap template the
 *                               composition detail page reads. The graph starts from it.
 * Nothing else: what the chart deploys is the author's next decision, and a guessed resource
 * would look chosen.
 *
 * WHAT IT REFUSES is chartIdentity's rule — the SAME one the draft lint runs on every write, so a
 * name Start accepts is a name the lint accepts, and a later version bump that outgrows it is
 * caught there. The derivations the modal shows as the person types (Kind, API version) live there
 * too, and are re-exported here for the modal.
 */
import { dump } from 'js-yaml'

import { CHART_YAML_PATH, VALUES_SCHEMA_PATH } from '../../components/Autopilot/blueprintDraft'

import { ARCHITECTURE_API_VERSION, ARCHITECTURE_KIND, ARCHITECTURE_TEMPLATE_PATH, serializeArchitecture, wrapAsConfigMapTemplate } from './architecture'
import { chartIdentityProblems, chartIdentityWarnings, claimApiVersion, compositionKind, publishNameProblem } from './chartIdentity'

export { CHART_NAME_MAX, COMPOSITION_GROUP, KIND_MAX, claimApiVersion, compositionKind, compositionVersion, kindBudget, metricsKindBudget } from './chartIdentity'

export const VALUES_YAML_PATH = 'values.yaml'

export interface StartChartInput {
  name: string
  version: string
  description: string
}

export interface StartChartProblem {
  field: keyof StartChartInput
  message: string
}

export type StartChartResult =
  | { ok: true; files: Record<string, string> }
  | { ok: false; problems: StartChartProblem[] }

/**
 * Where the release workflow pushes the chart — the convention pageDraft.ts and kogChart.ts write
 * into their CompositionDefinitions. Null until an owner is known: a location with an empty owner
 * segment is not a location.
 *
 * THE OWNER IS LOWER-CASED, because the registry's is. A GHCR path is lower-case, so the release
 * workflow pushes to `ghcr.io/${owner,,}/charts`, and it refuses a compositiondefinition.yaml whose
 * url is anything else. An owner typed as `Krateo-Blueprints` would otherwise show — and register —
 * a location nothing was ever pushed to.
 */
export const ociChartLocation = (owner: string, name: string): string | null => {
  const who = owner.trim().toLowerCase()
  return who ? `oci://ghcr.io/${who}/charts/${name.trim()}` : null
}

/**
 * The CompositionDefinition that REGISTERS a published blueprint, committed at the repo root beside
 * the chart it names. Null without an owner (ociChartLocation's rule).
 *
 * WRITTEN AT PUBLISH, NOT INTO THE DRAFT, because it is the one file that depends on the
 * DESTINATION: the url is `<owner>/charts/<name>`, and the owner is settled only when a person
 * confirms it. A page set's is written at the same moment for the same reason
 * (pageCompositionDefinition).
 *
 * THE VERSION IS LITERAL — Chart.yaml's, as the draft holds it. A blueprint carries a real SemVer
 * from Start on (the lint refuses anything else), and a merge to main releases exactly that version,
 * once; the release workflow refuses a tag that differs. So the file on main is byte for byte what
 * Register applies, and there is no stamped copy to prefer over it — unlike a page set, whose
 * Chart.yaml still carries the release's placeholder.
 *
 * `krateo-system`, because that is where the builder deliverables list looks for a blueprint's
 * registration, and where Register writes it. Registering is a PERSON's action, from that list —
 * the header says so, because this file is what someone reads on the branch and wonders whether to
 * apply.
 */
export const blueprintCompositionDefinition = (name: string, owner: string, repo: string, version: string): string | null => {
  const url = ociChartLocation(owner, name)
  if (!url) {
    return null
  }
  const chart = name.trim()
  const release = version.trim()
  return `# REGISTERS this blueprint: core-provider pulls the chart, generates the CRD from values.schema.json
# and serves the Kind ${compositionKind(chart)} as ${claimApiVersion(release)}.
# Register it from the portal once release ${release} is green (builder deliverables -> Register).
# The same file is attached to https://github.com/${owner.trim().toLowerCase()}/${repo.trim()}/releases/tag/${release}.
# The version is Chart.yaml's, literally; the release workflow refuses a tag that differs.
apiVersion: core.krateo.io/v1alpha1
kind: CompositionDefinition
metadata:
  name: ${chart}
  namespace: krateo-system
spec:
  chart:
    url: ${url}
    version: ${release}
`
}

/**
 * The Start modal's refusals, keyed by field. The name and version rules are chartIdentity's — not a
 * copy — because the lint re-runs them on the held Chart.yaml, and two copies would drift apart the
 * way the old Kind cap (60, plural-only) drifted from what core-provider actually creates.
 */
export const validateStartChart = (input: StartChartInput): StartChartProblem[] => {
  const problems = chartIdentityProblems({ name: input.name, version: input.version })
  // A NEW chart must also be publishable — the claim's name limit (chartIdentity's header).
  const publish = problems.some((problem) => problem.field === 'name') ? null : publishNameProblem(input.name)
  return publish ? [{ field: 'name', message: publish }, ...problems] : problems
}

/**
 * What the modal ADVISES without refusing — a name that deploys, but not on an install running CDC
 * metrics (chartIdentity's header). Start still works: the lint does not refuse it either.
 */
export const startChartWarnings = (input: StartChartInput): StartChartProblem[] =>
  chartIdentityWarnings({ name: input.name, version: input.version })

/** Build by assignment: the lint alphabetises object literals, and a file's key order is its format. */
const chartYaml = (name: string, version: string, description: string): string => {
  const chart: Record<string, string> = {}
  chart.apiVersion = 'v2'
  chart.name = name
  if (description) { chart.description = description }
  chart.type = 'application'
  chart.version = version
  return dump(chart, { lineWidth: -1, noRefs: true, sortKeys: false })
}

const valuesSchema = (): string => {
  const schema: Record<string, unknown> = {}
  schema.$schema = 'http://json-schema.org/draft-07/schema#'
  schema.type = 'object'
  schema.properties = {}
  return `${JSON.stringify(schema, null, 2)}\n`
}

const VALUES_YAML = '# Defaults for this blueprint. Every field placed in values.schema.json gets its default here.\n{}\n'

export const startChart = (input: StartChartInput): StartChartResult => {
  const problems = validateStartChart(input)
  if (problems.length) {
    return { ok: false, problems }
  }
  const name = input.name.trim()
  const descriptor = serializeArchitecture({ apiVersion: ARCHITECTURE_API_VERSION, chart: name, kind: ARCHITECTURE_KIND, resources: [] })
  const files: Record<string, string> = {}
  files[CHART_YAML_PATH] = chartYaml(name, input.version.trim(), input.description.trim())
  files[VALUES_YAML_PATH] = VALUES_YAML
  files[VALUES_SCHEMA_PATH] = valuesSchema()
  files[ARCHITECTURE_TEMPLATE_PATH] = wrapAsConfigMapTemplate(descriptor, name)
  return { files, ok: true }
}
