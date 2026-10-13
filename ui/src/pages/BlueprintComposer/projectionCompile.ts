/**
 * STATUS PROJECTION, COMPILED (S12). The descriptor's graph and its `status:` section become the two
 * things a CompositionDefinition needs to project each composition's state into its own `.status`:
 * the chart's `<chart>-status` RESTAction, and the `apiRef` + `statusDataTemplate` that point at it.
 *
 * WHY COMPILED, NOT AUTHORED. core-provider generates the RESTAction's RBAC from snowplow's
 * dispatch-free `GET /rbac`: a stage with `dependsOn`, a `${…}` left after the extras, or a non-kube
 * path is ErrIncomplete, and the composition gets no RBAC at all (core-provider
 * internal/tools/restactionrbac/restactionrbac.go:26-31). So the S11 page action — which chains
 * arch → comp → objs — cannot be the apiRef. This one has only stages whose path is built from the
 * CDC's extras (`compositionName`, `compositionNamespace`, apiresolver.go:29-44) and what the
 * descriptor already says: the architecture ConfigMap, and one namespaced LIST per node kind.
 *
 * ONE COMPUTATION. The top filter is the S11 filter VERBATIM (architectureStateJq.ts), preceded by
 * one step that folds the LISTs into the shape it reads. The composition's `status.managed` is not
 * read — its plural is flect's, which this side cannot derive — so the listed objects stand in for
 * it: an instance the LISTs did not find reads as withheld. level, waitingOn and allReady are the
 * same either way (a withheld and a missing instance are both unsatisfied); only the phase label of
 * a missing object differs.
 */
/* eslint-disable no-template-curly-in-string -- the compiled RESTAction and statusDataTemplate ARE literal ${ jq } substitutions (snowplow and CDC syntax). */
import { dump } from 'js-yaml'

import { ARCHITECTURE_API_VERSION, ARCHITECTURE_KIND, ARCHITECTURE_TEMPLATE_PATH, parseArchitecture, unwrapFromConfigMapTemplate, type ChartArchitecture, type ProjectionRow, type ProjectionType, type ResourceNode } from './architecture'
import { S11_ARCH_STEP_FILTER, S11_TOP_FILTER } from './architectureStateJq'

/** Where the RESTAction lives — the CompositionDefinition's namespace (decision D1 in the S12 spec). */
export const STATUS_RESTACTION_NAMESPACE = 'krateo-system'

export const statusRestActionName = (chart: string): string => `${chart}-status`

/**
 * PROVENANCE, because this RESTAction is a COPY and copies go stale silently (#483).
 *
 * The emitted RESTAction embeds S11_TOP_FILTER verbatim. It is applied as a standalone CR with no
 * Helm release and no ownerReferences, so no chart upgrade can ever reach it: fixing the generator
 * fixes blueprints published from that moment on, and every blueprint already published keeps
 * running the filter it was born with. That is exactly what happened with the condition form of
 * `readyWhen` (#482) — the generator and the portal copy were both fixed and released, while
 * event-site, published 2026-10-06, went on reporting architectureLevel 0 for resources that were
 * Ready, until the live object was patched by hand.
 *
 * These two annotations do not fix that. They make it ANSWERABLE: which generator produced this
 * copy, and does its filter still match the current one — a query instead of an investigation.
 */
export const GENERATED_BY_ANNOTATION = 'krateo.io/generated-by'
export const FILTER_DIGEST_ANNOTATION = 'krateo.io/filter-digest'

/**
 * The generator's own version, as the build inlines it (vite.config.ts `define`). Absent outside a
 * build — unit tests, a node script — where it reads `unknown` rather than throwing, because a
 * missing stamp must never be the reason a publish fails.
 */
const generatorVersion = (): string => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown')

/**
 * A short, STABLE, non-cryptographic digest of the filter text (FNV-1a, 32-bit, hex).
 *
 * Deliberately not SHA-256: `compileProjection` is synchronous and the browser's only built-in hash
 * is `crypto.subtle.digest`, which is async. Making the whole compile async to obtain a stronger
 * hash would be a large change for no gain here — this detects a filter that drifted from its
 * generator, which is an accident, not an adversary. Collisions do not matter: two different
 * filters hashing alike would hide a drift, and FNV-1a over a few KB of jq makes that vanishingly
 * unlikely for texts that differ at all.
 */
export const filterDigest = (text: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * The chart-root file a publish commits the projection as — never under templates/, never packaged
 * (the builder scaffold's .helmignore). JSON, not YAML: the portal's Install step reads it from the
 * publish claim with snowplow's jq, which parses JSON (`fromjson`) and has no YAML parser. It holds
 * the RESTAction Install applies next to the CompositionDefinition (decision D1), and the apiRef and
 * rows that CompositionDefinition carries.
 */
export const PROJECTION_BUNDLE_PATH = 'status-projection.json'

/** A row as the CompositionDefinition carries it. */
export interface StatusFieldMapping {
  forPath: string
  expression: string
  type?: ProjectionType
}

export type ProjectionCompile =
  | {
    ok: true
    /** The RESTAction manifest, as YAML — for reading. */
    restaction: string
    /** status-projection.json: { apiRef, statusDataTemplate, restaction } — what a publish commits. */
    bundle: string
    apiRef: { name: string; namespace: string; extras?: Record<string, string> }
    statusDataTemplate: StatusFieldMapping[]
  }
  | { ok: false; reason: string }

/** The architecture rows, always first. Types pin the generated CRD's status schema (statusfields.go). */
export const ARCHITECTURE_ROWS: readonly StatusFieldMapping[] = [
  { expression: '${ .api.level // 0 }', forPath: 'architectureLevel', type: 'integer' },
  { expression: '${ [ .api.waitingOn[]?.id ] }', forPath: 'waitingOn', type: 'array' },
  { expression: '${ .api.allReady == true }', forPath: 'architectureReady', type: 'boolean' },
]

const NAMESPACE = '((.compositionNamespace // .namespace) // "")'
const COMPOSITION = '((.compositionName // .name) // "")'

/** A namespaced collection path for an apiVersion + plural: core kinds live under /api, the rest under /apis. */
const listPath = (apiVersion: string, plural: string): string => {
  const root = apiVersion.includes('/') ? `/apis/${apiVersion}` : `/api/${apiVersion}`
  return `\${ "${root}/namespaces/" + ${NAMESPACE} + "/${plural}" }`
}

/** A LIST step's filter: each item reduced as S11's objs filter reduces it, stamped with the step's apiVersion (LIST items carry none). */
const listFilter = (step: string, apiVersion: string): string => [
  `[ (.${step}.items // [])[] | select(type == "object" and (.metadata.name // "") != "")`,
  `  | { apiVersion: ${JSON.stringify(apiVersion)},`,
  '      metadata: { name: .metadata.name, namespace: (.metadata.namespace // ""), creationTimestamp: (.metadata.creationTimestamp // "") },',
  '      status: (.status // {}) } ]',
].join('\n')

/**
 * The fold in front of the S11 filter: the LISTs become `.objs`, and what they found stands in for
 * `.comp[0].managed`. A LIST is allowed or refused as a WHOLE, so a refused one must not read as
 * "nothing rendered" — that would report every instance of the kind as unsatisfied, a claim about
 * objects that were not seen. Instead every name the graph gives that kind is marked rendered, and a
 * denial is written as S11's per-name `"<name>" is forbidden`: the instance reads unreadable
 * (unknown), and S11's own proof — a rendered dependent proves what it waited for — applies.
 */
const fold = (steps: readonly { step: string; ids: string[] }[]): string => [
  `${JSON.stringify(steps)} as $steps`,
  '| . as $in',
  '| ($in.arch.graph.nodes // []) as $gn',
  '| [ $steps[] | . as $s',
  '    | { ids: $s.ids,',
  '        items: ($in[$s.step] // [] | if type == "array" then . else [.] end),',
  '        errs: ([ $in[$s.step + "Err"] // [] ] | flatten) } ] as $by',
  '| [ $by[] | .items[] ] as $objs',
  '| [ $by[] | select(.errs | length > 0) | . as $b',
  '    | any(.errs[]; (type == "object" and ((.code // 0) == 403 or .reason == "Forbidden"))',
  '                   or (type == "string" and test("forbidden|not authorized"; "i"))) as $denied',
  '    | $gn[] | select(.present == true) | select(.id as $i | $b.ids | index($i) != null)',
  '    | { apiVersion, names: (.names // []), denied: $denied } ] as $unlisted',
  '| $in + { objs: $objs,',
  '          objErr: [ $unlisted[] | select(.denied) | .names[] | "\\"\\(.)\\" is forbidden: its kind could not be listed" ],',
  '          comp: [ { conditions: [],',
  '                    managed: ([ $objs[] | { apiVersion, name: .metadata.name, path: "listed" } ]',
  '                              + [ $unlisted[] | .apiVersion as $v | .names[] | { apiVersion: $v, name: ., path: "unlisted" } ]) } ] }',
].join('\n')

/**
 * Compile the projection for a chart, or say why not. A node with no `resource` (plural) cannot be
 * listed and is refused by id; a chart with nothing sequenced has no machine to project.
 */
export const compileProjection = (arch: ChartArchitecture): ProjectionCompile => {
  const sequenced = arch.resources.filter((node) => !node.lifecycle)
  if (!sequenced.length) {
    return { ok: false, reason: 'Nothing to project — the chart has no sequenced resources.' }
  }
  const unlisted = sequenced.filter((node) => !node.resource).map((node) => node.id)
  if (unlisted.length) {
    return { ok: false, reason: `Status projection lists each resource by its plural — add resource: to ${unlisted.join(', ')} in templates/architecture.yaml.` }
  }
  // One LIST per distinct (apiVersion, plural), in the descriptor's order.
  const kinds: { apiVersion: string; plural: string }[] = []
  for (const node of sequenced) {
    if (!kinds.some((kind) => kind.apiVersion === node.apiVersion && kind.plural === node.resource)) {
      kinds.push({ apiVersion: node.apiVersion, plural: node.resource as string })
    }
  }
  const steps = kinds.map((_, idx) => `o${idx}`)
  // Which nodes each LIST serves — the fold marks them when their LIST fails.
  const served = kinds.map((kind, idx) => ({
    ids: sequenced.filter((node) => node.apiVersion === kind.apiVersion && node.resource === kind.plural).map((node) => node.id),
    step: steps[idx],
  }))

  const api: Record<string, unknown>[] = []
  const archStep: Record<string, unknown> = {}
  archStep.name = 'arch'
  archStep.path = `\${ "/api/v1/namespaces/" + ${NAMESPACE} + "/configmaps/" + ${COMPOSITION} + "-architecture" }`
  archStep.verb = 'GET'
  archStep.headers = ['Accept: application/json']
  archStep.continueOnError = true
  archStep.errorKey = 'archErr'
  archStep.filter = S11_ARCH_STEP_FILTER
  api.push(archStep)
  kinds.forEach((kind, idx) => {
    const step: Record<string, unknown> = {}
    step.name = steps[idx]
    step.path = listPath(kind.apiVersion, kind.plural)
    step.verb = 'GET'
    step.headers = ['Accept: application/json']
    step.continueOnError = true
    step.errorKey = `${steps[idx]}Err`
    step.filter = listFilter(steps[idx], kind.apiVersion)
    api.push(step)
  })

  const name = statusRestActionName(arch.chart)
  const manifest: Record<string, unknown> = {}
  manifest.apiVersion = 'templates.krateo.io/v1'
  manifest.kind = 'RESTAction'
  const metadata: Record<string, unknown> = {}
  metadata.name = name
  metadata.namespace = STATUS_RESTACTION_NAMESPACE
  manifest.metadata = metadata
  const spec: Record<string, unknown> = {}
  spec.api = api
  spec.filter = `(\n${fold(served)}\n)\n| (\n${S11_TOP_FILTER}\n)\n`
  manifest.spec = spec
  // Stamped AFTER the filter exists, so the digest is of what actually ships (#483).
  metadata.annotations = {
    [FILTER_DIGEST_ANNOTATION]: filterDigest(spec.filter as string),
    [GENERATED_BY_ANNOTATION]: `frontend-${generatorVersion()}`,
    'krateo.io/generated-from': 'templates/architecture.yaml',
  }

  const author: ProjectionRow[] = arch.status?.project ?? []
  const extras = arch.status?.extras
  return {
    apiRef: { name, namespace: STATUS_RESTACTION_NAMESPACE, ...(extras && Object.keys(extras).length ? { extras } : {}) },
    bundle: `${JSON.stringify({ apiRef: { name, namespace: STATUS_RESTACTION_NAMESPACE, ...(extras && Object.keys(extras).length ? { extras } : {}) }, restaction: manifest, statusDataTemplate: [...ARCHITECTURE_ROWS, ...author] }, null, 2)}\n`,
    ok: true,
    restaction: dump(manifest, { lineWidth: -1, noRefs: true, sortKeys: false }),
    statusDataTemplate: [...ARCHITECTURE_ROWS, ...author.map((row) => ({ ...row }))],
  }
}

/**
 * The projection a held chart publishes, or null when it publishes none — no descriptor, one that
 * does not parse (the lint says why), or one that cannot compile (a node with no `resource`: an
 * agent-authored or migrated chart). Additive by design: a chart without a projection still
 * publishes and registers exactly as before; it simply projects no architecture state.
 */
export const projectionForFiles = (files: Readonly<Record<string, string>>): Extract<ProjectionCompile, { ok: true }> | null => {
  const template = files[ARCHITECTURE_TEMPLATE_PATH]
  if (!template) { return null }
  const parsed = parseArchitecture(unwrapFromConfigMapTemplate(template) ?? '')
  if (!parsed.ok) { return null }
  const compiled = compileProjection(parsed.architecture)
  return compiled.ok ? compiled : null
}

/* ------------------------------------------------------------------------------------------------
 * REGENERATION — the upgrade path the copy never had (#483).
 *
 * snowplow's RESTAction carries `spec.filter` as a literal string and offers no indirection
 * (`RESTActionSpec{ API []*API; Filter *string }`), so the computation CANNOT be referenced instead
 * of copied. And the per-chart stages cannot be derived at request time either: a stage with
 * `dependsOn` makes core-provider's read-set unresolvable (snowplow answers 422, surfaced as
 * `restactionrbac.ErrIncomplete`) and the composition then gets NO RBAC at all. So one RESTAction
 * per chart, with the computation inlined, is forced — the copy is not a shortcut that can simply be
 * removed.
 *
 * What CAN be removed is its permanence. Everything `compileProjection` consumes to build this
 * RESTAction is still legible IN the emitted object:
 *
 *   - the chart name            <- metadata.name, minus the `-status` suffix
 *   - which kinds are listed    <- each `o<n>` stage's path (apiVersion + plural)
 *   - which node ids each serves <- the `$steps` literal the fold opens with
 *
 * so a published blueprint can be recompiled from the live CR alone: no chart, no re-publish, no
 * composer. That is what makes a regeneration ACTION possible, and it is the half of #483 that
 * actually repairs the installed base — chart ownership (the issue's other suggestion) cannot,
 * because a blueprint chart is itself published once and pinned, which freezes the same copy one
 * level down.
 *
 * NOT recoverable, and deliberately not touched: `apiRef.extras` and the author's
 * `status.project` rows. Those live in the CompositionDefinition's `statusDataTemplate`, come from
 * the descriptor, and leave no trace in this object. Regeneration rewrites `spec` and the
 * provenance annotations of the RESTAction and nothing else.
 */

/** The live RESTAction, as `kubectl get -o json` returns it — only the parts regeneration reads. */
export interface LiveProjection {
  metadata?: { name?: string; namespace?: string; annotations?: Record<string, string> | null }
  spec?: { api?: ({ name?: string; path?: string; filter?: string } | null)[] | null; filter?: string }
}

export type ProjectionRecovery =
  | { ok: true; architecture: ChartArchitecture }
  | { ok: false; reason: string }

/** `${ "/apis/<group>/<version>/namespaces/" + … + "/<plural>" }` — and `/api/<version>/…` for core kinds. */
const LIST_PATH = /^\$\{ "\/(api|apis)\/(\S+?)\/namespaces\/" \+ .+ \+ "\/([^"/]+)" \}$/
/** The fold opens with the step→ids map as a JSON literal: `[{"ids":["a"],"step":"o0"}] as $steps`. */
const STEPS_LINE = /^(\[.*\]) as \$steps$/m

/**
 * Rebuild the compile inputs from a live projection RESTAction, or say why not.
 *
 * ONLY the fields the RESTAction itself derives from are real: `chart`, and each sequenced node's
 * `id`, `apiVersion` and `resource`. `kind`, `class` and `template` are placeholders — the emitted
 * object never carried them. So the result is an input to `compileProjection`, NOT a substitute for
 * parsing `templates/architecture.yaml`: it round-trips the RESTAction exactly and nothing else.
 */
export const recoverArchitecture = (ra: LiveProjection): ProjectionRecovery => {
  const name = ra.metadata?.name ?? ''
  if (!name.endsWith('-status')) {
    return { ok: false, reason: `not a projection RESTAction: ${name || '<unnamed>'} does not end in -status` }
  }
  const filter = ra.spec?.filter ?? ''
  const steps = STEPS_LINE.exec(filter)
  if (!steps) {
    return { ok: false, reason: 'the filter does not open with the generated fold — no `… as $steps` line to read the node ids from' }
  }
  let served: { ids: string[]; step: string }[]
  try {
    served = JSON.parse(steps[1]) as { ids: string[]; step: string }[]
  } catch {
    return { ok: false, reason: 'the fold\'s $steps literal is not JSON' }
  }
  if (!Array.isArray(served) || !served.length) {
    return { ok: false, reason: 'the fold lists no steps — nothing to project' }
  }

  const stages = (ra.spec?.api ?? []).filter((stage): stage is { name?: string; path?: string; filter?: string } => !!stage)
  const resources: ResourceNode[] = []
  for (const entry of served) {
    const stage = stages.find((candidate) => candidate.name === entry.step)
    if (!stage) { return { ok: false, reason: `the fold names step ${entry.step}, which has no api stage` } }
    const parts = LIST_PATH.exec(stage.path ?? '')
    if (!parts) { return { ok: false, reason: `step ${entry.step} has no namespaced LIST path to read a kind from: ${stage.path ?? '<none>'}` } }
    const [, , apiVersion, plural] = parts
    // The stage filter stamps the same apiVersion as a JSON literal (listFilter). Two independent
    // readings of one fact: if they disagree, this object was not emitted by this generator and
    // recompiling it would be a guess.
    const stamped = /apiVersion: ("(?:[^"\\]|\\.)*")/.exec(stage.filter ?? '')
    if (stamped && (JSON.parse(stamped[1]) as string) !== apiVersion) {
      return { ok: false, reason: `step ${entry.step} disagrees with itself: path says ${apiVersion}, filter says ${JSON.parse(stamped[1]) as string}` }
    }
    for (const id of entry.ids) {
      resources.push({ apiVersion, class: 'custom', id, kind: '', resource: plural, template: '' })
    }
  }

  return { architecture: { apiVersion: ARCHITECTURE_API_VERSION, chart: name.slice(0, -'-status'.length), kind: ARCHITECTURE_KIND, resources }, ok: true }
}

/**
 * Key-order-independent serialization, for comparing what we compiled against what the apiserver
 * returns. The compiler emits a stage as `name, path, verb, headers, continueOnError, errorKey,
 * filter`; the apiserver hands it back alphabetically. Comparing the two with `JSON.stringify`
 * reports every stage as changed on every run, which turns a regeneration into an unconditional
 * write and makes "nothing to do" unreachable.
 */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) { return `[${value.map(canonical).join(',')}]` }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export type ProjectionRegeneration =
  | {
    ok: true
    /** The RESTAction as the CURRENT generator would emit it, for the kinds this one already lists. */
    restaction: Record<string, unknown>
    /** Empty when the live object already matches — the regeneration is then a no-op. */
    changed: ('filter' | 'stages' | 'provenance')[]
  }
  | { ok: false; reason: string }

/**
 * Recompile a live projection RESTAction with the current generator.
 *
 * The stage PATHS are recovered from the object, so they come back identical by construction — which
 * is what makes this safe to apply: core-provider derives the composition's RBAC read-set from those
 * paths, and a regeneration that cannot move them cannot widen or break it. What does move is the
 * filter (the computation), the stage filters (how each LIST is reduced), and the provenance stamp.
 */
export const regenerateProjection = (ra: LiveProjection): ProjectionRegeneration => {
  const recovered = recoverArchitecture(ra)
  if (!recovered.ok) { return recovered }
  const compiled = compileProjection(recovered.architecture)
  if (!compiled.ok) { return { ok: false, reason: compiled.reason } }

  // The bundle's own object, not a YAML round-trip of the rendered string — the same manifest a
  // publish commits, so a regeneration and a fresh publish cannot differ by a serializer quirk.
  const next = (JSON.parse(compiled.bundle) as { restaction: Record<string, unknown> }).restaction
  const nextSpec = next.spec as { api: { path?: string; filter?: string }[]; filter: string }
  const livePaths = (ra.spec?.api ?? []).filter(Boolean).map((stage) => stage?.path ?? '')
  const nextPaths = nextSpec.api.map((stage) => stage.path ?? '')
  if (livePaths.length !== nextPaths.length || nextPaths.some((path, idx) => path !== livePaths[idx])) {
    return { ok: false, reason: 'regeneration moved a stage path — refusing, because the composition\'s RBAC is derived from these' }
  }

  const changed: ('filter' | 'stages' | 'provenance')[] = []
  if (nextSpec.filter !== (ra.spec?.filter ?? '')) { changed.push('filter') }
  if (canonical(nextSpec.api) !== canonical((ra.spec?.api ?? []).filter(Boolean))) { changed.push('stages') }
  const liveAnnotations = ra.metadata?.annotations ?? {}
  const nextAnnotations = (next.metadata as { annotations: Record<string, string> }).annotations
  if (Object.entries(nextAnnotations).some(([key, value]) => liveAnnotations[key] !== value)) { changed.push('provenance') }

  return { changed, ok: true, restaction: next }
}
