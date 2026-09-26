/**
 * W4 BLUEPRINT-BUILDER (FE-B1 + FE-B2) — the PURE draft-chart module behind
 * previewBlueprint's INLINE-DRAFT mode. No React, no network:
 *
 *   1. parseRawTemplates (FE-B1) — the arg guard for the inline chart tree
 *      (`{"Chart.yaml": "...", "templates/x.yaml": "...", ...}`): a non-empty map of
 *      non-empty path → string content, or null — the proposal is DENIED, never a crash.
 *   2. lintBlueprintDraft (FE-B2) — the crdgen-defaults lint, run BEFORE any render
 *      fetch. A values.schema.json carrying a NON-EMPTY object/array `default` (at ANY
 *      depth) is the krateo-platformops/core-provider#46 class: at CD-create time crdgen
 *      emits a malformed `+kubebuilder:default=` marker, controller-gen fails to parse
 *      it, and the CompositionDefinition wedges Ready=False. HARD ERROR — the drawer
 *      shows the verdicts and NOTHING is fetched or published. The 512 KiB total-bytes
 *      cap (the same discipline as the $oasAttachment paste) is enforced here too.
 *   3. buildFormSchemaText / buildFormPreviewModel (FE-B1) — the create-form preview
 *      half: the RAW values.schema.json string (verbatim from the draft file, so the
 *      authoring order survives — the same trick as Form.tsx's stringSchema), parsed
 *      client-side and spliced the way production blueprint-formdef splices the real
 *      one (synthetic `name` + `namespace` first, `(should be hidden)` titles hidden)
 *      for the drawer's read-only SchemaForm mount.
 */
import { load } from 'js-yaml'
import type { JSONSchema4 } from 'json-schema'

import {
  ARCHITECTURE_TEMPLATE_PATH,
  deriveStates,
  graphBlockFor,
  parseArchitecture,
  regenerateGraphBlock,
  unwrapFromConfigMapTemplate,
  type ChartArchitecture,
} from '../../pages/BlueprintComposer/architecture'
import { chartIdentityProblems, chartNameProblem } from '../../pages/BlueprintComposer/chartIdentity'
import { extractNameExpression } from '../../pages/BlueprintComposer/gateExtract'
import { graphBlockIn } from '../../pages/BlueprintComposer/graphCompile'

import type { DraftKind } from './blueprintDraftStore'
import { OAS_ATTACHMENT_MAX_BYTES, utf8ByteLength } from './oasAttachment'

/** The draft file the lint and the form preview read. */
export const VALUES_SCHEMA_PATH = 'values.schema.json'

/** Required in every blueprint draft: it names the chart, and its ABSENCE is what `isPageDraft`
 * keys on — so a blueprint without one is mistaken for a page rather than reported as broken. */
export const CHART_YAML_PATH = 'Chart.yaml'

/** Hard cap on the inline draft: 512 KiB of UTF-8 bytes (paths + contents) — the same
 * discipline as the OAS attachment, and well inside the render service's 2 MiB body cap. */
export const RAW_TEMPLATES_MAX_BYTES = OAS_ATTACHMENT_MAX_BYTES

/** Drawer caption when the draft is refused client-side (lint error or size cap). */
export const DRAFT_REJECTED_CAPTION
  = 'draft rejected client-side — nothing was rendered and nothing can be published; fix the verdicts and preview again.'

const asRecord = (value: unknown): Record<string, unknown> | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null)

/**
 * Strip a code-fence / triple-quote wrapper the model may put around a WHOLE file body.
 * gemini (and most LLMs) intermittently wrap a generated file in a markdown fence
 * (```json … ```) or a python-style triple-quote ('''…''' / """…"""). Those bytes would be
 * published verbatim into the chart AND break JSON.parse of values.schema.json (observed:
 * `'''{ "title": … }'''` → the preview-gate refuses to publish). We already strip fences
 * from CHAT text (transport.sanitizeChatText); drafted FILE bodies need the same. Only a
 * SYMMETRIC wrapper around the entire trimmed body is removed (an optional opening language
 * tag line too); genuine content — a values.yaml starting `replicaCount: 1`, a schema
 * starting `{` — is never touched.
 */
export const stripCodeFence = (raw: string): string => {
  const trimmed = raw.trim()
  for (const marker of ['```', "'''", '"""'] as const) {
    if (trimmed.length > marker.length * 2 && trimmed.startsWith(marker) && trimmed.endsWith(marker)) {
      const inner = trimmed.slice(marker.length, trimmed.length - marker.length)
      // drop an optional leading language tag line, e.g. ```json\n or '''yaml\n
      return inner.replace(/^[a-zA-Z0-9_-]*\r?\n/, '').trim()
    }
  }
  return raw
}

/** Total UTF-8 bytes of the draft (paths + contents) — what the 512 KiB cap measures. */
export const rawTemplatesByteSize = (rawTemplates: Record<string, string>): number =>
  Object.entries(rawTemplates).reduce((total, [path, content]) => total + utf8ByteLength(path) + utf8ByteLength(content), 0)

/** A non-empty object or non-empty array — the exact #46 default class. `{}`/`[]`
 * defaults are structurally harmless (nothing for the marker to serialize) and pass. */
const isNonEmptyStructure = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.length > 0
  }
  return value !== null && typeof value === 'object' && Object.keys(value).length > 0
}

/** Keys whose CHILD KEYS are property NAMES, not schema keywords — a property literally
 * named `default` under these maps must not be mistaken for a defaults keyword. */
const NAME_MAP_KEYWORDS = new Set(['$defs', 'definitions', 'patternProperties', 'properties'])

/** Value-carrying keywords whose contents are DATA, not schema — never walked into
 * (`default` is checked, then skipped: keys inside a default value are not keywords). */
const VALUE_KEYWORDS = new Set(['const', 'default', 'enum', 'examples'])

/**
 * Subschema combinators. VALID JSON Schema, and fatal to the generated CRD.
 *
 * core-provider copies `type` and `x-kubernetes-preserve-unknown-fields` into each branch, and
 * Kubernetes forbids both inside a branch of a STRUCTURAL schema — so the apiserver rejects the
 * generated CRD and the CompositionDefinition wedges. Observed on builder-publish 1.8.24, whose
 * schema carried `anyOf: [{required:[files]},{required:[filesBundle]}]` to say "one or the other":
 *
 *   spec.validation.openAPIV3Schema.properties[spec].anyOf[0].type:
 *     Forbidden: must be empty to be structural
 *
 * That chart sat Ready=False for as long as the pin named it, and — because the SERVED CRD stayed
 * on the previous version — a field the new schema had added was silently pruned off every claim
 * that sent it. Flagged here because the cost is invisible until a publish quietly commits nothing.
 */
const COMBINATOR_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'not'])

const combinatorProblem = (path: string, keyword: string): string =>
  `[CRDGEN-COMBINATOR] ${path}: \`${keyword}\` is valid JSON Schema but breaks CRD generation — core-provider copies type/x-kubernetes-preserve-unknown-fields into each branch, which Kubernetes forbids in a structural schema, and the CompositionDefinition wedges Ready=False. Express the constraint in the chart templates (fail) instead; see builder-publish/_files.tpl.`

const crdgenDefaultsProblem = (path: string, shape: 'object' | 'array' = 'object'): string =>
  `[CRDGEN-DEFAULTS] ${path}: non-empty ${shape} default — crdgen emits a malformed +kubebuilder:default marker and the CompositionDefinition wedges Ready=False (krateo-platformops/core-provider#46). Move the structure into values.yaml; keep schema defaults scalar.`

/**
 * One crdgen finding in values.schema.json, located. `path` is the lint's own spelling
 * (`properties.credentials.default`); `segments` is the same walk as keys and indexes, which an
 * editor can follow into the text without re-parsing a dotted path (a property may be named `a.b`).
 * `shape` says what a populated default holds; `keyword` names the combinator.
 */
export interface SchemaFinding {
  code: 'CRDGEN-DEFAULTS' | 'CRDGEN-COMBINATOR'
  path: string
  segments: (string | number)[]
  shape?: 'object' | 'array'
  keyword?: string
}

/** Schema-aware walk: flags every non-empty object/array `default` and every combinator, at any depth. */
const walkSchemaNode = (node: unknown, path: string, segments: (string | number)[], findings: SchemaFinding[]): void => {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => {
      walkSchemaNode(entry, `${path}[${index}]`, [...segments, index], findings)
    })
    return
  }
  const record = asRecord(node)
  if (!record) {
    return
  }
  for (const [key, value] of Object.entries(record)) {
    const at = path ? `${path}.${key}` : key
    const atSegments = [...segments, key]
    if (COMBINATOR_KEYWORDS.has(key)) {
      findings.push({ code: 'CRDGEN-COMBINATOR', keyword: key, path: at, segments: atSegments })
      // Reported AND still walked. Skipping the branches looked tidier and silently dropped the
      // nested-defaults coverage inside them — the branch contents do not disappear when the
      // combinator is removed, they move, so their problems are still the author's to fix.
    }
    if (VALUE_KEYWORDS.has(key)) {
      if (key === 'default' && isNonEmptyStructure(value)) {
        findings.push({ code: 'CRDGEN-DEFAULTS', path: at, segments: atSegments, shape: Array.isArray(value) ? 'array' : 'object' })
      }
      continue
    }
    if (NAME_MAP_KEYWORDS.has(key)) {
      const nameMap = asRecord(value)
      if (nameMap) {
        for (const [name, child] of Object.entries(nameMap)) {
          walkSchemaNode(child, `${at}.${name}`, [...atSegments, name], findings)
        }
        continue
      }
    }
    walkSchemaNode(value, at, atSegments, findings)
  }
}

/**
 * The crdgen findings of a values.schema.json, as data — the lint below words them, and the form
 * editor marks and fixes them. Empty for invalid JSON: that is the lint's to name, once.
 */
export const schemaDefaultsFindings = (schemaText: string): SchemaFinding[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(schemaText)
  } catch {
    return []
  }
  const findings: SchemaFinding[] = []
  walkSchemaNode(parsed, '', [], findings)
  return findings
}

/**
 * FE-B2 core: lint a raw values.schema.json string for the crdgen-defaults class.
 * Returns error lines for the preview drawer — EMPTY means the schema carries no
 * non-empty object/array default anywhere. Invalid JSON is itself a hard error (the
 * schema drives BOTH the composition CRD and the create form — it must parse).
 */
export const lintValuesSchemaDefaults = (schemaText: string): string[] => {
  try {
    JSON.parse(schemaText)
  } catch (error) {
    return [`${VALUES_SCHEMA_PATH} is not valid JSON — ${error instanceof Error ? error.message : String(error)}`]
  }
  return schemaDefaultsFindings(schemaText).map((finding) => (finding.code === 'CRDGEN-COMBINATOR'
    ? combinatorProblem(finding.path, finding.keyword ?? '')
    : crdgenDefaultsProblem(finding.path, finding.shape)))
}

/**
 * [CDC-GLOBAL] A CLOSED root that does not declare `global` — valid JSON Schema, a clean preview, a
 * green publish, merge, release and registration, and then no composition of the chart can render.
 *
 * composition-dynamic-controller adds a top-level `global` block to the values of EVERY render
 * (`internal/composition/composition.go` → plumbing `helm/utils/values.go`, which sets
 * `global` with `SetNestedField`), and Helm validates the values against this file before it
 * renders. `additionalProperties: false` at the root refuses the one key the author never wrote.
 * test-mongodb-db found it that way (ea6aa3c), five steps after the edit that caused it; the
 * blueprint-builder example schema carries the same root.
 *
 * Only the ROOT: CDC injects nothing deeper, so a closed nested object is fine and stays allowed.
 * Declaring `global` under `properties` is the other way out, for an author who wants the root
 * closed. Blueprints only — see lintBlueprintDraft. Invalid JSON is not reported here: the
 * defaults lint already names it, once.
 */
export const lintValuesSchemaRoot = (schemaText: string): string[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(schemaText)
  } catch {
    return []
  }
  const root = asRecord(parsed)
  if (!root || root.additionalProperties !== false) {
    return []
  }
  const properties = asRecord(root.properties)
  if (properties && Object.prototype.hasOwnProperty.call(properties, 'global')) {
    return []
  }
  return [`[CDC-GLOBAL] ${VALUES_SCHEMA_PATH}: the root sets "additionalProperties": false and does not declare "global" — composition-dynamic-controller adds a top-level global block to the values of every render, so Helm's schema check refuses every composition of this chart after it is published and registered. Remove additionalProperties: false from the root, or declare "global" under properties.`]
}

/**
 * One top-level Chart.yaml scalar, or null. It is YAML, so it is read as YAML — the way Helm reads
 * it: two regex readers disagreed about `name: x # comment`, and a third missed a value on the next
 * line. A number is read back as its string (`version: 1.0` is `1`, which the rule then refuses as
 * the non-SemVer it is). Never throws: this runs inside the draft broadcast, and an unreadable
 * Chart.yaml is a missing value.
 */
const chartYamlScalar = (chartYaml: string | undefined, key: 'name' | 'version'): string | null => {
  if (!chartYaml) {
    return null
  }
  try {
    const doc = load(chartYaml) as Record<string, unknown> | null
    const value = typeof doc?.[key] === 'number' ? String(doc[key]) : doc?.[key]
    return typeof value === 'string' && value !== '' ? value : null
  } catch {
    return null
  }
}

/**
 * Chart.yaml's `name:`, or null. ONE reader for the lint and for the identity the gate, the slug and
 * the destination are keyed on — so the lint cannot pass a chart whose identity has silently fallen
 * back to "draft chart".
 */
export const chartYamlName = (chartYaml: string | undefined): string | null => chartYamlScalar(chartYaml, 'name')

/** Chart.yaml's `version:`, or null — read exactly as the name is, because the rule reads them together. */
export const chartYamlVersion = (chartYaml: string | undefined): string | null => chartYamlScalar(chartYaml, 'version')

/**
 * The held chart with its architecture file REGENERATED: the `krateo:graph` block recompiled from
 * data.architecture as it is now, under Chart.yaml's name (architecture.ts regenerateGraphBlock).
 *
 * The canvas tells a person to add a resource by editing templates/architecture.yaml, and that edit
 * has to be previewable: the block is the composer's to keep in step, never the author's. So the
 * draft store runs this on every write to a held blueprint — Chart files, the composer, Undo — and
 * parseRawTemplates on every tree Autopilot proposes, BEFORE it is linted, rendered and held, so the
 * bytes rendered are the bytes held. Each is still one ordinary write: it disarms the gate, and only
 * a render arms it again. The same object comes back when nothing changed.
 */
export const regenerateArchitecture = (files: Record<string, string>): Record<string, string> => {
  const template = files[ARCHITECTURE_TEMPLATE_PATH]
  if (template === undefined) {
    return files
  }
  const next = regenerateGraphBlock(template, chartYamlName(files[CHART_YAML_PATH]))
  return next === template ? files : { ...files, [ARCHITECTURE_TEMPLATE_PATH]: next }
}

/**
 * The inline chart tree of a previewBlueprint proposal: a plain object mapping
 * non-empty relative paths to string contents. Anything else — empty map, non-object,
 * a non-string file body — is null (the proposal is denied, matching every arg guard).
 * Each file body is de-fenced (see stripCodeFence) so an accidental model wrapper never
 * corrupts the published chart or the schema lint, and the architecture file's graph block is
 * regenerated (regenerateArchitecture): Autopilot edits data.architecture as a person does, and
 * the block is not its to write.
 */
export const parseRawTemplates = (value: unknown): Record<string, string> | null => {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  const entries = Object.entries(record)
  if (entries.length === 0) {
    return null
  }
  const cleaned: Record<string, string> = {}
  for (const [path, content] of entries) {
    if (!path.trim() || typeof content !== 'string') {
      return null
    }
    cleaned[path] = stripCodeFence(content)
  }
  return regenerateArchitecture(cleaned)
}

/**
 * The chart's identity, by the kind of draft it is.
 *
 * EVERY chart name must be a DNS-1123 label: it becomes the repository, the branch
 * (`builder/<name>`), the release and the claim. A missing one used to fall back to "draft chart",
 * which is none of those.
 *
 * A BLUEPRINT is also held to the whole of chartIdentity's rule — the one Start runs — at the
 * version Chart.yaml carries NOW: core-provider derives the Kind, the CRD and the controller
 * container from name + version, and a release that lengthens the version can push a name that fit
 * at Start past what Kubernetes accepts. Checked here, on every write, because that is the only place
 * a bump is seen before a CompositionDefinition wedges on it. Only what fails on EVERY install is
 * refused — the metrics Service's tighter budget is Start's advice, never a lint problem, or a real
 * blueprint that deploys could not be previewed or published (chartIdentity's header).
 *
 * A PAGE set keeps the label check only. It IS registered by a CompositionDefinition too, but at
 * publish time (pageCompositionDefinition) and against a Chart.yaml whose version is the
 * CHART_VERSION placeholder the release stamps — there is no version to measure the budget at here,
 * and the placeholder would be refused as non-SemVer on every page draft.
 */
const lintChartIdentity = (chartYaml: string, kind: DraftKind): string[] => {
  const name = chartYamlName(chartYaml)
  if (name === null) {
    return [`${CHART_YAML_PATH} has no name — it becomes the repository, the branch, the claim and the Kind.`]
  }
  if (kind === 'page') {
    const problem = chartNameProblem(name)
    return problem ? [`${CHART_YAML_PATH} name "${name}": ${problem}`] : []
  }
  const version = chartYamlVersion(chartYaml)
  return chartIdentityProblems({ name, version: version ?? '' }).map((problem) => {
    if (problem.field === 'name') {
      return `${CHART_YAML_PATH} name "${name}": ${problem.message}`
    }
    return version === null
      ? `${CHART_YAML_PATH} has no version — Helm refuses the chart, and core-provider derives the API version from it.`
      : `${CHART_YAML_PATH} version "${version}": ${problem.message}`
  })
}

/** A held file by path — own keys only: a template path is author text, and `constructor` is not a file. */
const heldFile = (files: Record<string, string>, path: string): string | undefined =>
  (Object.prototype.hasOwnProperty.call(files, path) ? files[path] : undefined)

/**
 * The names (L1, L4, L5). The detail page finds a node's objects by name — informer-served objects
 * carry no apiVersion or kind to join on — so a sequenced node needs one, it must be the name its
 * template really gives the object, and no two sequenced nodes may share one. A template whose name
 * the scan cannot pin down (gateExtract's extractNameExpression) is not second-guessed.
 */
const descriptorNameProblems = (arch: ChartArchitecture, files: Record<string, string>): string[] => {
  const problems: string[] = []
  const firstWith = new Map<string, number>()
  arch.resources.forEach((node, idx) => {
    const at = `${ARCHITECTURE_TEMPLATE_PATH}: resources[${idx}].name`
    const text = heldFile(files, node.template)
    const templateName = text === undefined ? null : extractNameExpression(text)
    if (!node.name) {
      if (!node.lifecycle) {
        const hint = templateName ? ` ${node.template} names it ${templateName}.` : ''
        problems.push(`${at} — required on a sequenced resource: the composition detail page finds its objects by this name.${hint}`)
      }
      return
    }
    if (templateName !== null && templateName !== node.name) {
      problems.push(`${at} — ${node.template} names its object ${templateName}, not ${node.name}: the detail page would look for an object the chart never creates.`)
    }
    if (node.lifecycle) {
      return
    }
    const first = firstWith.get(node.name)
    if (first === undefined) {
      firstWith.set(node.name, idx)
    } else {
      problems.push(`${at} — the same name as resources[${first}]: the detail page tells objects apart by name, so two resources cannot share one.`)
    }
  })
  return problems
}

/**
 * Every write to a held chart regenerates the block (regenerateArchitecture), so this is the backstop
 * for bytes that reached a draft some other way — and the way out it names is one a person has.
 */
const REGENERATE = 'The block is compiled from data.architecture and never written by hand: the composer rewrites it whenever the chart is saved — in Chart files, by the composer or by Autopilot. Apply any edit in Chart files to have it rewritten, or Undo.'

/**
 * The chart name and the graph block (L2, L3). The label and `graph.chart` carry Chart.yaml's name,
 * which is also the one the composer compiles with, so the descriptor's `chart` must be the same.
 * The block must be exactly what the descriptor compiles to: a stale one would publish a graph the
 * descriptor does not describe, and the detail page would draw it.
 */
const descriptorGraphProblems = (arch: ChartArchitecture, descriptor: string, text: string, chartName: string | null): string[] => {
  const problems: string[] = []
  if (chartName !== null && arch.chart !== chartName) {
    problems.push(`${ARCHITECTURE_TEMPLATE_PATH}: chart — "${arch.chart}" is not this chart: ${CHART_YAML_PATH} names it "${chartName}", and the ConfigMap's label and its graph carry that name.`)
  }
  const current = graphBlockIn(text)
  if (current === null) {
    problems.push(`${ARCHITECTURE_TEMPLATE_PATH} has no krateo:graph block after data.architecture — it is what resolves each node's objects for the composition detail page. ${REGENERATE}`)
  } else if (current !== graphBlockFor(descriptor, chartName ?? arch.chart)) {
    problems.push(`${ARCHITECTURE_TEMPLATE_PATH}: the krateo:graph block no longer matches data.architecture. ${REGENERATE}`)
  }
  return problems
}

/**
 * The architecture file, when the chart has one, must say something the composer and the
 * composition detail page can read: the descriptor in the ConfigMap's data.architecture, well
 * formed, without a dependency cycle (a chart with a cycle never leaves its first state), its nodes
 * named as their templates name them, and the graph block compiled from exactly this descriptor.
 */
const lintDescriptor = (files: Record<string, string>): string[] => {
  const text = heldFile(files, ARCHITECTURE_TEMPLATE_PATH)
  if (text === undefined) {
    return []
  }
  const descriptor = unwrapFromConfigMapTemplate(text)
  if (descriptor === null) {
    return [`${ARCHITECTURE_TEMPLATE_PATH} does not carry the descriptor in data.architecture — the composer and the composition detail page read it from there.`]
  }
  // This lint runs INSIDE the draft broadcast and the gate's change listener, so it must never
  // throw: a throw there escapes the store write after the tree is replaced, before anything can
  // disarm it, and every later answer on the draft buses goes with it. A descriptor the kernel
  // cannot read is a problem to name, like any other.
  try {
    const parsed = parseArchitecture(descriptor)
    if (!parsed.ok) {
      return parsed.problems.map((problem) => `${ARCHITECTURE_TEMPLATE_PATH}: ${problem.path} — ${problem.message}`)
    }
    const derived = deriveStates(parsed.architecture)
    if (!derived.ok) {
      return [`${ARCHITECTURE_TEMPLATE_PATH}: the dependencies form a cycle (${derived.cycle.join(' → ')}) — a chart with a cycle never leaves its first state.`]
    }
    return [
      ...descriptorNameProblems(parsed.architecture, files),
      ...descriptorGraphProblems(parsed.architecture, descriptor, text, chartYamlName(heldFile(files, CHART_YAML_PATH))),
    ]
  } catch (err) {
    return [`${ARCHITECTURE_TEMPLATE_PATH} could not be read — ${err instanceof Error ? err.message : String(err)}`]
  }
}

/**
 * The pre-render gate for an inline draft: the 512 KiB size cap first (an over-cap
 * draft is refused whole — same posture as an over-cap OAS paste), then the FE-B2
 * crdgen-defaults lint of values.schema.json when the draft ships one. Empty = the
 * draft may be POSTed to the render service.
 *
 * `kind` is REQUIRED, with no default. The rules differ by kind (lintChartIdentity), and the files
 * cannot say which kind they are: both carry a Chart.yaml and a values.schema.json now, which is
 * why isPageDraft stopped sniffing the file set and reads the kind the store recorded. A default
 * would apply one kind's rules to every caller that forgot the other; a required argument makes
 * each caller say what it is linting.
 */
export const lintBlueprintDraft = (rawTemplates: Record<string, string>, kind: DraftKind): string[] => {
  const bytes = rawTemplatesByteSize(rawTemplates)
  if (bytes > RAW_TEMPLATES_MAX_BYTES) {
    const kib = Math.ceil(bytes / 1024)
    return [`the inline draft is ${kib} KiB — over the 512 KiB cap (same discipline as the OAS attachment). Trim the draft, or publish the chart and preview it by chart URL instead.`]
  }

  const problems: string[] = []

  // Chart.yaml is REQUIRED, and its absence used to fail in the least legible way available: it is
  // the discriminator `isPageDraft` uses (`!('Chart.yaml' in files)`), so a blueprint without one
  // was silently reclassified as a PAGE draft and the publish was refused on an identity mismatch
  // — a message about page slugs, for a missing chart file.
  if (rawTemplates[CHART_YAML_PATH] === undefined) {
    problems.push(`${CHART_YAML_PATH} is missing — without it this is not a chart, and the publish gate reads the draft as a portal PAGE and refuses it for the wrong reason.`)
  } else {
    problems.push(...lintChartIdentity(rawTemplates[CHART_YAML_PATH], kind))
  }
  problems.push(...lintDescriptor(rawTemplates))

  // values.schema.json is REQUIRED, and this is the expensive one to learn late. core-provider
  // opens it to build the CRD and hard-errors when it is absent, so a draft without one publishes
  // clean, merges, releases, and only then wedges the CompositionDefinition at Ready=False with
  // "error getting spec schema" — several layers and one merge away from the cause.
  const schemaText = rawTemplates[VALUES_SCHEMA_PATH]
  if (schemaText === undefined) {
    problems.push(`${VALUES_SCHEMA_PATH} is missing — it IS the generated CRD's spec, so a chart without one can be published and can never be installed (core-provider fails with "error getting spec schema").`)
  } else {
    problems.push(...lintValuesSchemaDefaults(schemaText))
    // A BLUEPRINT only, because a refusal has to be something the author can act on. A blueprint's
    // schema is authored, by a person or an agent, and this is the last point before a composition
    // fails where anyone sees it. A page set's is GENERATED (pageValuesSchema), and so is a
    // controller's (kogValuesSchema): a refusal here would name a file nobody wrote. Both close
    // their root and declare `global` where they are written, and generatedValuesSchemas.test.ts
    // runs this same check on them, so a regression fails a test instead of every page publish.
    if (kind === 'blueprint') {
      problems.push(...lintValuesSchemaRoot(schemaText))
    }
  }

  return problems
}

/** The draft chart's display name, from Chart.yaml's `name:` (fallback: 'draft chart'). */
export const draftDisplayName = (rawTemplates: Record<string, string>): string =>
  chartYamlName(rawTemplates[CHART_YAML_PATH]) ?? 'draft chart'

/**
 * The RAW schema string the drawer's create-form preview renders, or undefined (no
 * section). Prefers the VERBATIM draft file (authoring order survives untouched);
 * falls back to re-serializing the render response's valuesSchema (remote-chart mode,
 * where no draft file exists). A failed render has no trustworthy schema — no form.
 */
export const buildFormSchemaText = (
  rawTemplates: Record<string, string> | undefined,
  valuesSchema: unknown,
  renderError: string | undefined,
): string | undefined => {
  if (renderError) {
    return undefined
  }
  const draftText = rawTemplates?.[VALUES_SCHEMA_PATH]
  if (typeof draftText === 'string' && draftText.trim()) {
    return draftText
  }
  if (asRecord(valuesSchema)) {
    return JSON.stringify(valuesSchema)
  }
  return undefined
}

/** What the read-only SchemaForm mounts: the spliced schema + the keys hidden from it. */
export interface FormPreviewModel {
  schema: JSONSchema4
  hidden: string[]
}

/** Every property key (any depth) whose title carries the formdef hide convention. */
const collectHiddenKeys = (properties: Record<string, unknown>, hidden: Set<string>): void => {
  for (const [key, node] of Object.entries(properties)) {
    const record = asRecord(node)
    if (!record) {
      continue
    }
    if (typeof record.title === 'string' && /should be hidden/i.test(record.title)) {
      hidden.add(key)
    }
    const nested = asRecord(record.properties)
    if (nested) {
      collectHiddenKeys(nested, hidden)
    }
  }
}

/**
 * Parse the raw schema string and splice it the way production blueprint-formdef
 * splices the published one: synthetic `name` + `namespace` as the FIRST properties
 * (both required — the create Form routes them to metadata via payloadToOverride),
 * and `(should be hidden)`-titled keys collected into the hide list. Null = the
 * string does not parse to an object schema with properties — no form section.
 */
export const buildFormPreviewModel = (formSchema: string): FormPreviewModel | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(formSchema)
  } catch {
    return null
  }
  const record = asRecord(parsed)
  const properties = asRecord(record?.properties)
  if (!record || !properties || Object.keys(properties).length === 0) {
    return null
  }
  const required = Array.isArray(record.required) ? record.required.filter((key): key is string => typeof key === 'string') : []
  const hidden = new Set<string>()
  collectHiddenKeys(properties, hidden)
  const schema = {
    ...record,
    properties: {
      name: { title: 'Name', type: 'string' },
      namespace: { title: 'Namespace', type: 'string' },
      ...properties,
    },
    required: ['name', 'namespace', ...required.filter((key) => key !== 'name' && key !== 'namespace')],
    type: 'object',
  } as JSONSchema4
  return { hidden: [...hidden], schema }
}
