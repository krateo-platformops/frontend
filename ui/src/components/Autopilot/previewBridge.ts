/**
 * Wave-4 preview bridge — the PURE helpers behind the three read-only preview verbs
 * (previewBlueprint / previewPage / previewRestDef). No React, no registry entries
 * here: argument guards (a malformed proposal is DENIED — null — never a crash), the
 * helm-render transport seam, and the payload builders for the preview drawer.
 *
 * previewBlueprint transport contract (helm-render-service, POST /render): the body
 * carries EXACTLY ONE chart source — {chart:{url,version?,repo?}} (remote mode) OR
 * {rawTemplates:{"<path>":"<content>"}} (FE-B1 inline-draft mode, previewing a chart
 * that has no URL yet) — plus {values} → 200 {objects:[{apiVersion,kind,name,
 * namespace,yaml}], valuesSchema?, error?}. A response carrying {error} is CONTENT (a
 * bad chart is data — the drawer shows the error string); an unreachable/failed
 * service is likewise surfaced as preview text, never a throw.
 */
import { dump, load } from 'js-yaml'

import { getAccessToken } from '../../utils/getAccessToken'

import type { PortalActionProposal } from './actionBridge'
import { parseRawTemplates } from './blueprintDraft'
import { restDefImmutabilityWarnings, validateRestDefinitionDraft } from './kogMapping'
import { pageDraftSlug } from './pageDraft'
import { setPreviewProblems, type AutopilotPreviewPayload, type PreviewObjectEntry } from './previewBus'

/** The chart coordinates previewBlueprint sends to the render service. */
export interface BlueprintChartRef {
  url: string
  version?: string
  repo?: string
}

/** Exactly ONE of `chart` (remote mode) | `rawTemplates` (FE-B1 inline-draft mode) —
 * the parser guarantees the invariant; a proposal carrying both or neither is denied. */
export interface BlueprintPreviewArgs {
  chart?: BlueprintChartRef
  rawTemplates?: Record<string, string>
  values?: Record<string, unknown>
}

/** The normalized outcome of a render call: content objects OR an error string (data). */
export interface HelmRenderResult {
  error?: string
  objects: PreviewObjectEntry[]
  valuesSchema?: unknown
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null)

const optionalString = (value: unknown): boolean => value === undefined || typeof value === 'string'

/**
 * previewBlueprint args — EXACTLY ONE chart source, matching the render service's own
 * exactly-one-of contract: {chart:{url, version?, repo?}} (remote) XOR
 * {rawTemplates:{"<path>":"<content>"}} (inline draft, FE-B1), plus optional
 * {values: object}. Both sources, neither, or a malformed one = null (denied).
 */
export const parseBlueprintPreviewArgs = (proposal: PortalActionProposal): BlueprintPreviewArgs | null => {
  if (proposal.chart !== undefined && proposal.rawTemplates !== undefined) {
    return null
  }
  const values = proposal.values === undefined ? undefined : asRecord(proposal.values)
  if (proposal.values !== undefined && !values) {
    return null
  }
  if (proposal.rawTemplates !== undefined) {
    const rawTemplates = parseRawTemplates(proposal.rawTemplates)
    if (!rawTemplates) {
      return null
    }
    return { rawTemplates, ...(values ? { values } : {}) }
  }
  const chart = asRecord(proposal.chart)
  if (!chart || typeof chart.url !== 'string' || !chart.url.trim() || !optionalString(chart.version) || !optionalString(chart.repo)) {
    return null
  }
  return {
    chart: {
      url: chart.url,
      ...(typeof chart.version === 'string' && chart.version ? { version: chart.version } : {}),
      ...(typeof chart.repo === 'string' && chart.repo ? { repo: chart.repo } : {}),
    },
    ...(values ? { values } : {}),
  }
}

/** previewPage args: {widgets:[<widget CR objects>]} — each entry MUST at least carry a
 * widget `kind`; anything else (empty list, a non-object, a kind-less blob) is denied. */
export const parsePagePreviewArgs = (proposal: PortalActionProposal): Record<string, unknown>[] | null => {
  const { widgets } = proposal
  if (!Array.isArray(widgets) || widgets.length === 0) {
    return null
  }
  const parsed: Record<string, unknown>[] = []
  for (const entry of widgets) {
    const cr = asRecord(entry)
    if (!cr || typeof cr.kind !== 'string' || !cr.kind.trim()) {
      return null
    }
    parsed.push(cr)
  }
  return parsed
}

/** previewRestDef args: {restDefinition: <RestDefinition CR draft object>}. Null = denied. */
export const parseRestDefPreviewArgs = (proposal: PortalActionProposal): Record<string, unknown> | null => {
  const restDefinition = asRecord(proposal.restDefinition)
  if (!restDefinition || Object.keys(restDefinition).length === 0) {
    return null
  }
  return restDefinition
}

/** A human-readable chart name from its URL (last path segment, archive suffix stripped). */
export const chartDisplayName = (url: string): string => {
  const last = url.replace(/\/+$/, '').split('/')
    .pop() ?? url
  return last.replace(/\.(tgz|tar\.gz)$/i, '') || url
}

/** Serialize a CR draft to YAML for the preview drawer; never throws (a draft is data). */
export const toYamlString = (value: unknown): string => {
  try {
    return dump(value, { lineWidth: 120, noRefs: true })
  } catch {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
}

const metadataOf = (cr: Record<string, unknown>): { name?: string; namespace?: string } => {
  const metadata = asRecord(cr.metadata)
  return {
    ...(typeof metadata?.name === 'string' && metadata.name ? { name: metadata.name } : {}),
    ...(typeof metadata?.namespace === 'string' && metadata.namespace ? { namespace: metadata.namespace } : {}),
  }
}

/** The Bearer of the logged-in session, forwarded so the render service can pull private
 * charts. Best-effort: no token (or no localStorage in tests) → no header, never a throw. */
const authHeader = (): Record<string, string> => {
  try {
    return { Authorization: `Bearer ${getAccessToken()}` }
  } catch {
    return {}
  }
}

const normalizeRenderedObject = (entry: unknown): PreviewObjectEntry => {
  const record = asRecord(entry) ?? {}
  return {
    ...(typeof record.apiVersion === 'string' && record.apiVersion ? { apiVersion: record.apiVersion } : {}),
    kind: typeof record.kind === 'string' && record.kind ? record.kind : 'Object',
    ...(typeof record.name === 'string' && record.name ? { name: record.name } : {}),
    ...(typeof record.namespace === 'string' && record.namespace ? { namespace: record.namespace } : {}),
    yaml: typeof record.yaml === 'string' ? record.yaml : toYamlString(entry),
  }
}

/** The render CONTRACT body — `{objects, valuesSchema?, error?}` — as produced by BOTH
 * transports: the direct render service (`callHelmRender`, the response JSON) and the
 * server-side RA (`callBlueprintRenderRA`, the RESTAction's resolved `.status`). The RA
 * jq filter emits EXACTLY this shape, so one normalizer serves both. */
interface RenderContractBody { error?: unknown; objects?: unknown; valuesSchema?: unknown }

/** Normalize the shared `{objects, valuesSchema?, error?}` contract body into a
 * HelmRenderResult. An `{error}` string is CONTENT (a bad chart is data → objects:[]);
 * otherwise the objects list (+ valuesSchema when present). Never throws. */
const toHelmRenderResult = (body: RenderContractBody | null): HelmRenderResult => {
  if (typeof body?.error === 'string' && body.error) {
    return { error: body.error, objects: [] }
  }
  const objects = Array.isArray(body?.objects) ? body.objects.map(normalizeRenderedObject) : []
  return { objects, ...(body?.valuesSchema === undefined ? {} : { valuesSchema: body.valuesSchema }) }
}

/** Serialize the previewBlueprint args into the RA's `?extras` envelope — the SAME
 * exactly-one-of source contract, forwarded by snowplow into the RA's jq dict, where the
 * `blueprint-render` payload step rebuilds the render service body server-side. Exactly
 * ONE of `chart` | `rawTemplates` (the parser guarantees it), plus `values` (default {}). */
export const buildBlueprintRenderExtras = (args: BlueprintPreviewArgs): string =>
  JSON.stringify({
    ...(args.rawTemplates ? { rawTemplates: args.rawTemplates } : { chart: args.chart }),
    values: args.values ?? {},
  })

/**
 * POST the chart source + values to the render service and normalize the response —
 * remote mode sends {chart}, inline-draft mode sends {rawTemplates} (the service's
 * exactly-one-of contract). EVERY failure mode resolves (never rejects): a {error}
 * body, a non-2xx status, and an unreachable service all come back as `{error}` — the
 * drawer shows the string as the preview content. The caller decides nothing about
 * transport.
 *
 * NOTE: this is the LEGACY direct-fetch transport (config api.RENDER_API_BASE_URL). The
 * render service is ClusterIP-only and should NOT be browser-exposed, so the preferred
 * path is `callBlueprintRenderRA` (server-side via snowplow). This is kept as the
 * config-absent fallback for installs that still expose the render service directly.
 */
export const callHelmRender = async (renderBaseUrl: string, args: BlueprintPreviewArgs): Promise<HelmRenderResult> => {
  try {
    const response = await fetch(`${renderBaseUrl.replace(/\/+$/, '')}/render`, {
      body: JSON.stringify({
        ...(args.rawTemplates ? { rawTemplates: args.rawTemplates } : { chart: args.chart }),
        values: args.values ?? {},
      }),
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      method: 'POST',
    })
    const body = await response.json().catch(() => null) as RenderContractBody | null
    // A non-2xx WITHOUT an {error} body is the only transport-specific case (the RA path
    // has no equivalent — snowplow answers 200 with the {error} in .status). Everything
    // else flows through the shared contract normalizer.
    if (!(typeof body?.error === 'string' && body.error) && !response.ok) {
      return { error: `render service responded ${response.status}`, objects: [] }
    }
    return toHelmRenderResult(body)
  } catch (error) {
    return { error: `render service unreachable — ${error instanceof Error ? error.message : String(error)}`, objects: [] }
  }
}

/**
 * Render a blueprint through the snowplow `blueprint-render` RESTAction — the SAME
 * transport a widget uses (`GET ${snowplowBaseUrl}/call?resource=restactions&...` with
 * the user's Bearer), so the ClusterIP-only render service is NEVER browser-exposed:
 * snowplow POSTs it in-cluster via the RA's endpointRef and returns the shaped result in
 * the RESTAction's resolved `.status`.
 *
 * The previewBlueprint args ride in `?extras` (the exactly-one-of chart source + values);
 * the response is the resolved RESTAction CR whose `.status` is the render contract body
 * `{objects, valuesSchema?, error?}` (snowplow places a RESTAction's jq filter output
 * directly in `.status`). EVERY failure mode resolves into `{error}` content — never a
 * throw — exactly like `callHelmRender`, so the drawer path is identical.
 */
export const callBlueprintRenderRA = async (
  snowplowBaseUrl: string,
  namespace: string,
  args: BlueprintPreviewArgs,
): Promise<HelmRenderResult> => {
  try {
    const url = new URL(`${snowplowBaseUrl.replace(/\/+$/, '')}/call`)
    url.searchParams.set('resource', 'restactions')
    url.searchParams.set('apiVersion', 'templates.krateo.io/v1')
    url.searchParams.set('name', 'blueprint-render')
    url.searchParams.set('namespace', namespace)
    url.searchParams.set('extras', buildBlueprintRenderExtras(args))
    const response = await fetch(url.toString(), { headers: { ...authHeader() } })
    if (!response.ok) {
      // A RA transport failure (RBAC 403, the RA not installed 404, snowplow 5xx) — the
      // render service {error} would have been a 200 with .status.error, so a non-2xx here
      // is genuinely the RA path failing. Surface it as content, never a throw.
      return { error: `blueprint-render RESTAction responded ${response.status}`, objects: [] }
    }
    // snowplow resolves a RESTAction with its jq filter output placed DIRECTLY in .status
    // (not .status.widgetData — that is the widget shape). The filter emits the render
    // contract body verbatim.
    const cr = await response.json().catch(() => null) as { status?: unknown } | null
    const status = asRecord(cr?.status) as RenderContractBody | null
    return toHelmRenderResult(status)
  } catch (error) {
    return { error: `blueprint-render RESTAction unreachable — ${error instanceof Error ? error.message : String(error)}`, objects: [] }
  }
}

/** Why previewPage is a SOURCE preview (see previewHandlers.ts for the full rationale). */
export const PAGE_PREVIEW_CAPTION
  = 'Source preview — the proposed widget CRs exactly as they would be submitted. Nothing is applied; live in-page rendering of drafts is a follow-up.'

export const buildPagePreviewPayload = (widgets: Record<string, unknown>[]): AutopilotPreviewPayload => ({
  caption: PAGE_PREVIEW_CAPTION,
  // The write-set a publish commits: each widget CR at its portal-chart destination path (the
  // SAME chart/templates/<kind>.<name>.yaml the publishPage git-write targets — see pageDraft.ts).
  files: widgets.map((widget) => ({
    content: toYamlString(widget),
    path: `chart/templates/${pageDraftSlug(String(widget.kind), String(metadataOf(widget).name ?? ''))}`,
  })),
  objects: widgets.map((widget) => ({
    kind: String(widget.kind),
    ...metadataOf(widget),
    ...(typeof widget.apiVersion === 'string' && widget.apiVersion ? { apiVersion: widget.apiVersion } : {}),
    yaml: toYamlString(widget),
  })),
  publishTarget: { base: 'main', repo: 'krateo-portal-chart' },
  title: `Page preview — ${widgets.length} proposed widget${widgets.length === 1 ? '' : 's'}`,
})

/**
 * The mapped verbs/paths of a RestDefinition draft, extracted by PURE client-side
 * parsing (no network, no crdgen): kind + group headlines, one `action · METHOD path`
 * line per verbsDescription entry, and the identifiers. Missing pieces surface as
 * explicit placeholders — an incomplete draft is data, not an error.
 */
export const extractRestDefSummary = (restDefinition: Record<string, unknown>): string[] => {
  const spec = asRecord(restDefinition.spec)
  const resource = asRecord(spec?.resource)
  const lines: string[] = []
  if (typeof resource?.kind === 'string' && resource.kind) {
    lines.push(`kind: ${resource.kind}`)
  }
  if (typeof spec?.resourceGroup === 'string' && spec.resourceGroup) {
    lines.push(`group: ${spec.resourceGroup}`)
  }
  const verbs = Array.isArray(resource?.verbsDescription) ? resource.verbsDescription : []
  let mapped = 0
  for (const entry of verbs) {
    const verb = asRecord(entry)
    if (!verb) {
      continue
    }
    const action = typeof verb.action === 'string' && verb.action ? verb.action : '(action?)'
    const method = typeof verb.method === 'string' && verb.method ? verb.method.toUpperCase() : '(method?)'
    const path = typeof verb.path === 'string' && verb.path ? verb.path : '(path?)'
    lines.push(`${action} · ${method} ${path}`)
    mapped += 1
  }
  if (!mapped) {
    lines.push('no verbs mapped')
  }
  const identifiers = Array.isArray(resource?.identifiers)
    ? resource.identifiers.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  if (identifiers.length) {
    lines.push(`identifiers: ${identifiers.join(', ')}`)
  }
  return lines
}

export const REST_DEF_PREVIEW_CAPTION
  = 'Source preview — the RestDefinition draft, its mapped verbs/paths, and its validation against the RestDefinition CRD (all client-side; nothing touches the cluster).'

export const buildRestDefPreviewPayload = (restDefinition: Record<string, unknown>): AutopilotPreviewPayload => {
  const identity = metadataOf(restDefinition)
  // FE-K1: validate the draft against the LIVE CRD shape and surface the CEL-immutable
  // fields — the preview drawer is exactly where the user decides whether to publish,
  // so validation errors ("this would be rejected") and immutability warnings ("you
  // cannot change these later") belong HERE, before the gated write is even proposed.
  const problems = validateRestDefinitionDraft(restDefinition)
  // FE-P5 channel: the collector surfaces these in the page context (`previewProblems`)
  // so the model SEES its rejected mapping and self-corrects without the user asking.
  setPreviewProblems(problems.length ? problems : null)
  const warnings = restDefImmutabilityWarnings(restDefinition)
  return {
    caption: REST_DEF_PREVIEW_CAPTION,
    // FE-K(edit): the RestDefinition source is EDITABLE in the drawer. The user tweaks the held
    // draft's YAML (a human action on the held bytes — never a model round-trip); an accepted edit
    // re-validates against the live CRD shape and re-arms the preview gate so the subsequent publish
    // commits the edited bytes. `restDefKind` names the edit target for the edit-bus subscriber.
    editRestDef: true,
    ...(typeof restDefinition.kind === 'string' && restDefinition.kind ? { restDefKind: restDefinition.kind } : { restDefKind: 'RestDefinition' }),
    objects: [{
      kind: typeof restDefinition.kind === 'string' && restDefinition.kind ? restDefinition.kind : 'RestDefinition',
      ...identity,
      yaml: toYamlString(restDefinition),
    }],
    ...(problems.length ? { problems } : {}),
    summary: extractRestDefSummary(restDefinition),
    title: `RestDefinition preview${identity.name ? ` — ${identity.name}` : ''}`,
    ...(warnings.length ? { warnings } : {}),
  }
}

/**
 * The outcome of re-validating an EDITED RestDefinition source (drawer edit path). Pure — no
 * network, no side effects: the same client-side pipeline `buildRestDefPreviewPayload` runs, so an
 * accepted edit is byte-for-byte the draft the preview gate would arm and the publish would commit.
 *   - a YAML parse failure → { ok:false, problems:['could not parse…'] } (bad edit is data, not a crash);
 *   - a parseable-but-invalid draft → { ok:false, draft, problems, warnings, summary } (the drawer
 *     shows the exact CRD errors; the gate is NOT armed — same posture as an invalid model draft);
 *   - a clean draft → { ok:true, draft, problems:[], warnings, summary } (the caller re-arms the gate).
 */
export interface RestDefEditResult {
  ok: boolean
  /** The parsed draft object (present whenever the YAML parsed, even if invalid). */
  draft: Record<string, unknown> | null
  /** CRD-shape validation errors (empty iff ok). A parse failure is a single explanatory line. */
  problems: string[]
  /** The CEL-immutable-field warnings for the parsed draft (empty on a parse failure). */
  warnings: string[]
  /** The mapped verbs/paths summary for the parsed draft (empty on a parse failure). */
  summary: string[]
}

/** The parse-failure copy shown in the drawer when an edit is not valid YAML/JSON. */
export const REST_DEF_EDIT_PARSE_ERROR = 'the edited source is not valid YAML — fix the syntax and apply again'

/**
 * Re-validate an EDITED RestDefinition source string. Parses the YAML (js-yaml `load`, the same
 * loader the publish path uses), then runs the EXACT client-side validation
 * `buildRestDefPreviewPayload` runs. `ok` is true only when the draft parses AND has zero CRD-shape
 * errors — the single condition under which the caller re-arms the preview gate with the edited bytes.
 */
export const parseRestDefEdit = (source: string): RestDefEditResult => {
  let parsed: unknown
  try {
    parsed = load(source)
  } catch {
    return { draft: null, ok: false, problems: [REST_DEF_EDIT_PARSE_ERROR], summary: [], warnings: [] }
  }
  const draft = asRecord(parsed)
  if (!draft) {
    return { draft: null, ok: false, problems: [REST_DEF_EDIT_PARSE_ERROR], summary: [], warnings: [] }
  }
  const problems = validateRestDefinitionDraft(draft)
  return {
    draft,
    ok: problems.length === 0,
    problems,
    summary: extractRestDefSummary(draft),
    warnings: restDefImmutabilityWarnings(draft),
  }
}

/**
 * FE-K(edit), page/blueprint half — the outcome of re-validating an EDITED "Files"-tab file
 * (drawer per-file edit path). Pure — no network, no side effects. Mirrors `parseRestDefEdit`:
 *   - a YAML parse failure → { ok:false, problems:[…] } (a bad edit is data, not a crash);
 *   - a PAGE widget CR missing apiVersion/kind/metadata.name → { ok:false, problems:[…] } (it
 *     would be rejected / has no stable destination path — same posture as an invalid model draft);
 *   - a BLUEPRINT chart template → YAML-parse-only (a Helm template is not a CR: any parseable
 *     document is accepted — the render service is the correctness gate, not a CR-shape check);
 *   - a clean edit → { ok:true, content } (the caller writes it into the held tree + re-arms the gate).
 * `content` echoes the accepted source verbatim (the held-bytes invariant: what publishes == what
 * the human approved), so the caller never re-serializes the parsed object.
 */
export interface FileEditResult {
  ok: boolean
  /** The accepted edited bytes, verbatim, present only on success (held == previewed == published). */
  content?: string
  /** Validation errors (empty iff ok): a parse failure OR the missing CR-shape fields (page only). */
  problems: string[]
}

/** The parse-failure copy shown in the drawer when a per-file edit is not valid YAML. */
export const FILE_EDIT_PARSE_ERROR = 'the edited file is not valid YAML — fix the syntax and apply again'

/** The CR-shape failure copy for a PAGE widget file missing the required identity fields. */
export const FILE_EDIT_SHAPE_ERROR
  = 'a page widget CR needs apiVersion, kind and metadata.name — publishing this file would be rejected'

/**
 * Re-validate an EDITED "Files"-tab file. `requireCrShape` selects the two contexts:
 *   - true  (a PAGE widget CR): the parsed document MUST be an object carrying apiVersion + kind +
 *            metadata.name (the widget-CR identity — without it there is no stable destination path
 *            and snowplow would reject it). This is a lightweight, dependency-free shape check; the
 *            deeper live-CRD/ajv validation lives only in the v2 sandbox path (previewPageV2), which
 *            applies drafts to a quarantined cluster and is not reusable from this pure edit seam.
 *   - false (a BLUEPRINT chart template): YAML must PARSE, nothing more — a Helm template renders to
 *            objects server-side (the render service is the correctness gate), so a CR-shape check
 *            would be wrong here.
 */
export const parseFileEdit = (source: string, requireCrShape: boolean): FileEditResult => {
  let parsed: unknown
  try {
    parsed = load(source)
  } catch {
    return { ok: false, problems: [FILE_EDIT_PARSE_ERROR] }
  }
  if (!requireCrShape) {
    // A blueprint chart template: any parseable document is accepted (js-yaml `load` of an empty
    // document yields undefined — a wholly-empty file is still a valid, publishable template).
    return { content: source, ok: true, problems: [] }
  }
  const cr = asRecord(parsed)
  const name = asRecord(cr?.metadata)?.name
  if (!cr
    || typeof cr.apiVersion !== 'string' || !cr.apiVersion.trim()
    || typeof cr.kind !== 'string' || !cr.kind.trim()
    || typeof name !== 'string' || !name.trim()) {
    return { ok: false, problems: [FILE_EDIT_SHAPE_ERROR] }
  }
  return { content: source, ok: true, problems: [] }
}

/* ── explainUpgradeImpact (Wave 4) ───────────────────────────────────────────
 * A READ-ONLY dry-run of what a gated blueprint Update would change — reusing the
 * SAME server-side `upgrade-impact` RESTAction the on-page impact card uses
 * (restaction.upgrade-impact: fetch CompositionDefinition → helm-render /diff
 * installed-vs-target → shape), fetched over snowplow /call (the SAME transport widgets
 * use, so the ClusterIP-only render service is NEVER browser-exposed). Surfaced through
 * the Autopilot preview drawer so the agent can explain the update BEFORE proposing the
 * Update runAction. The Update itself still goes through useHandleAction + the blast-radius
 * gate — never from here. EVERY failure resolves into `{error}` content, never a throw. */

/** The composition identity + target version forwarded to the upgrade-impact RA via ?extras. */
export interface UpgradeImpactArgs {
  name: string
  namespace: string
  toVersion: string
}

/** One changed-object row from the upgrade-impact RA's shaped `.status`. */
export interface UpgradeImpactRow {
  kind: string
  name: string
  namespace: string
  change: string
  detail: string
}

/** The upgrade-impact RA's shaped `.status` (mirrors restaction.upgrade-impact's filter). */
export interface UpgradeImpactResult {
  error?: string
  from: string
  to: string
  summary: string
  rows: UpgradeImpactRow[]
  valuesSchemaChanged: boolean
}

/**
 * explainUpgradeImpact args: the composition {name, namespace} + a {toVersion}. All three
 * are required non-empty strings; anything else is null (denied). NOTE: no chart source is
 * needed here — the server-side RA fetches the CompositionDefinition and reads spec.chart.
 * A same-version request is NOT rejected here (the RA self-diffs to "no changes"); the model
 * is told to only propose this when a newer version exists.
 */
export const parseUpgradeImpactArgs = (proposal: PortalActionProposal): UpgradeImpactArgs | null => {
  const { name, namespace, toVersion } = proposal
  if (typeof name !== 'string' || !name.trim()) {
    return null
  }
  if (typeof namespace !== 'string' || !namespace.trim()) {
    return null
  }
  if (typeof toVersion !== 'string' || !toVersion.trim()) {
    return null
  }
  return { name, namespace, toVersion }
}

/** Serialize the composition identity + target version into the upgrade-impact RA's ?extras
 * envelope — snowplow forwards {namespace, name, to} into the RA's jq dict (the SAME keys the
 * blueprint detail-page route params supply), where it fetches the compdef + POSTs /diff. */
export const buildUpgradeImpactExtras = (args: UpgradeImpactArgs): string =>
  JSON.stringify({ name: args.name, namespace: args.namespace, to: args.toVersion })

const normalizeImpactRow = (entry: unknown): UpgradeImpactRow => {
  const row = asRecord(entry) ?? {}
  return {
    change: typeof row.change === 'string' ? row.change : '',
    detail: typeof row.detail === 'string' ? row.detail : '',
    kind: typeof row.kind === 'string' && row.kind ? row.kind : 'Object',
    name: typeof row.name === 'string' ? row.name : '',
    namespace: typeof row.namespace === 'string' ? row.namespace : '',
  }
}

/**
 * Fetch the upgrade-impact RA over snowplow /call — snowplow resolves the RESTAction
 * in-cluster (fetching the compdef, POSTing /diff to the ClusterIP render service) and
 * places its jq filter output DIRECTLY in `.status` (a RESTAction's status IS the filter
 * output — not `.status.widgetData`, which is the widget shape). EVERY failure mode
 * resolves into an `{error}` result — a 403/404/5xx transport failure, an unreachable
 * snowplow, or the RA's own honest `.status.error` (a render failure is data).
 */
export const callUpgradeImpactRA = async (
  snowplowBaseUrl: string,
  raNamespace: string,
  args: UpgradeImpactArgs,
): Promise<UpgradeImpactResult> => {
  const empty: UpgradeImpactResult = { from: args.toVersion, rows: [], summary: '', to: args.toVersion, valuesSchemaChanged: false }
  try {
    const url = new URL(`${snowplowBaseUrl.replace(/\/+$/, '')}/call`)
    url.searchParams.set('resource', 'restactions')
    url.searchParams.set('apiVersion', 'templates.krateo.io/v1')
    url.searchParams.set('name', 'upgrade-impact')
    url.searchParams.set('namespace', raNamespace)
    url.searchParams.set('extras', buildUpgradeImpactExtras(args))
    const response = await fetch(url.toString(), { headers: { ...authHeader() } })
    if (!response.ok) {
      return { ...empty, error: `upgrade-impact RESTAction responded ${response.status}` }
    }
    const cr = await response.json().catch(() => null) as { status?: unknown } | null
    const status = asRecord(cr?.status)
    if (!status) {
      return { ...empty, error: 'upgrade-impact RESTAction returned no status' }
    }
    const err = typeof status.error === 'string' && status.error ? status.error : undefined
    return {
      ...(err ? { error: err } : {}),
      from: typeof status.from === 'string' && status.from ? status.from : args.toVersion,
      rows: Array.isArray(status.rows) ? status.rows.map(normalizeImpactRow) : [],
      summary: typeof status.summary === 'string' ? status.summary : '',
      to: typeof status.to === 'string' && status.to ? status.to : args.toVersion,
      valuesSchemaChanged: status.valuesSchemaChanged === true,
    }
  } catch (error) {
    return { ...empty, error: `upgrade-impact RESTAction unreachable — ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * describeResource transport: GET the LIVE CRD via snowplow /call (cluster-scoped, so no
 * namespace). Returns the CRD object for client-side spec-field extraction, or an error
 * string AS content (a missing CRD / RBAC 403 / snowplow 5xx is data, never a throw).
 */
export const callDescribeResourceCRD = async (
  snowplowBaseUrl: string,
  crdName: string,
): Promise<{ crd?: Record<string, unknown>; error?: string }> => {
  try {
    const url = new URL(`${snowplowBaseUrl.replace(/\/+$/, '')}/call`)
    url.searchParams.set('resource', 'customresourcedefinitions')
    url.searchParams.set('apiVersion', 'apiextensions.k8s.io/v1')
    url.searchParams.set('name', crdName)
    const response = await fetch(url.toString(), { headers: { ...authHeader() } })
    if (!response.ok) {
      return { error: `CRD ${crdName} lookup responded ${response.status} (it may not be installed)` }
    }
    const crd = asRecord(await response.json().catch(() => null))
    return crd ? { crd } : { error: `CRD ${crdName} returned no object` }
  } catch (error) {
    return { error: `CRD ${crdName} unreachable — ${error instanceof Error ? error.message : String(error)}` }
  }
}

export const UPGRADE_IMPACT_CAPTION
  = 'helm-render dry-run diff of CHART DEFAULTS — nothing is applied. Real composition values are not used, so a live instance may differ; the Update itself still goes through the gated confirm.'

/** The one-line change marker per object row (mirrors the on-page impact table's semantics). */
const IMPACT_CHANGE_MARK: Record<string, string> = { added: '+', error: '!', modified: '~', removed: '-' }

/**
 * Shape an upgrade-impact result into the preview-drawer payload: the RA's own headline
 * summary line, then one `<mark> Kind ns/name — detail` line per changed object. A render
 * error is CONTENT (shown as the drawer error), never a throw.
 */
export const buildUpgradeImpactPayload = (result: UpgradeImpactResult): AutopilotPreviewPayload => {
  const title = `Upgrade impact — ${result.from} → ${result.to}`
  if (result.error) {
    return { caption: UPGRADE_IMPACT_CAPTION, error: result.error, title }
  }
  const rows = result.rows.map((row) => {
    const id = row.namespace ? `${row.namespace}/${row.name}` : row.name
    const mark = IMPACT_CHANGE_MARK[row.change] ?? '·'
    return `${mark} ${row.kind}${id ? ` ${id}` : ''}${row.detail ? ` — ${row.detail}` : ''}`
  })
  const body = rows.length ? rows : ['No changes between the two versions (chart defaults).']
  const summary = result.summary ? [result.summary, ...rows] : body
  return { caption: UPGRADE_IMPACT_CAPTION, summary, title }
}
