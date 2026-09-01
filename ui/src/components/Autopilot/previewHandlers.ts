/**
 * Wave-4 preview verbs (W0-1 extension seam) — THREE deny-by-default, READ-ONLY
 * registry entries that mutate NOTHING and auto-apply like navigate. Each shows the
 * user exactly what a builder will produce BEFORE any write, in the shared preview
 * drawer (previewSurface.tsx, opened via the previewBus event). The write that may
 * follow still goes through useHandleAction + the blast-radius gate — never from here.
 *
 *   - previewBlueprint {chart:{url,version?,repo?}, values?} OR — FE-B1 inline-draft
 *     mode — {rawTemplates:{"<path>":"<content>"}, values?} (exactly ONE source):
 *     renders the chart SERVER-SIDE via the `blueprint-render` RESTAction (fetched over
 *     snowplow `/call`, the SAME transport widgets use — so the ClusterIP-only render
 *     service is never browser-exposed) and lists the rendered child objects; a returned
 *     valuesSchema additionally renders as a read-only "Create form preview" section (the
 *     production SchemaForm — zero extra network). Legacy fallback: a DIRECT browser fetch
 *     to config api.RENDER_API_BASE_URL when the RA transport is unavailable. Inline drafts
 *     pass the FE-B2 crdgen lint FIRST: a values.schema.json carrying a non-empty
 *     object/array default (the core-provider#46 class that wedges CRD generation) — or a
 *     draft over the 512 KiB cap — is a HARD ERROR shown in the drawer, and NOTHING is
 *     fetched. Neither transport available → a graceful "preview unavailable" chip, ZERO
 *     network. A render error is CONTENT (a bad chart is data), shown in the drawer.
 *   - previewPage {widgets:[<widget CR objects>]}: ZERO network — an honest SOURCE
 *     preview (kind/name headline + collapsible YAML per proposed CR). Deliberately
 *     NOT a live render: WidgetRenderer requires a SERVED widgetEndpoint
 *     (useWidgetQuery fetches it), container widgets (Flex/Row/Col/Tabs…) resolve
 *     children through further served endpoints, and a draft CR only has an
 *     UNRESOLVED spec (snowplow compiles spec→status server-side: templates, apiRef
 *     data, resourcesRefs). An in-memory "render" would either fetch (violating
 *     read-only zero-network) or fake the resolution — so the fallback is honest
 *     source, and live draft rendering is a documented follow-up.
 *   - previewRestDef {restDefinition:<CR draft>}: pure client-side parsing — the
 *     draft's YAML plus a summary of the mapped verbs/paths (action · METHOD path),
 *     kind/group and identifiers. No network, no crdgen (v1 = structured source).
 *
 * Malformed args are DENIED (argSchema false / apply → null), matching every other
 * registry verb — never a crash, never a partial dispatch.
 */
import { buildFormSchemaText, DRAFT_REJECTED_CAPTION, draftDisplayName, lintBlueprintDraft } from './blueprintDraft'
import { buildDescribeResourcePayload, crdNameFromArgs, extractCrdSpecFields, parseDescribeResourceArgs } from './describeResource'
import {
  buildPagePreviewPayload,
  buildRestDefPreviewPayload,
  buildUpgradeImpactPayload,
  callBlueprintRenderRA,
  callDescribeResourceCRD,
  callHelmRender,
  callUpgradeImpactRA,
  chartDisplayName,
  parseBlueprintPreviewArgs,
  parsePagePreviewArgs,
  parseRestDefPreviewArgs,
  parseUpgradeImpactArgs,
} from './previewBridge'
import { openAutopilotPreview } from './previewBus'
import { registerReadOnlyVerb, type VerbSpec } from './verbRegistry'

/** The graceful-absence chip label when NEITHER previewBlueprint transport is available
 * (no snowplow RA reachable AND no direct RENDER_API_BASE_URL configured). */
export const RENDER_UNAVAILABLE_LABEL = 'preview unavailable — render service not configured'

/**
 * previewBlueprint → helm-render the chart against the values and show the rendered
 * child objects. Read-only end to end: the render is a dry-run (no cluster write), and
 * every failure mode resolves into drawer content or a chip — no throw.
 *
 * TRANSPORT: PREFER the server-side `blueprint-render` RESTAction (fetched via snowplow
 * `/call`, the same transport widgets use) so the ClusterIP-only render service is NEVER
 * browser-exposed. When the RA transport is unavailable (no snowplow base URL / no
 * frontend namespace) but a direct RENDER_API_BASE_URL IS configured, fall back to the
 * legacy direct browser fetch. When NEITHER is available → the graceful "unavailable"
 * chip, ZERO network.
 */
export const previewBlueprintSpec: VerbSpec = {
  apply: async (proposal, deps) => {
    const args = parseBlueprintPreviewArgs(proposal)
    if (!args) {
      return null
    }
    // The RA transport needs both the snowplow base URL AND the RA's namespace (frontend
    // namespace); a direct render base URL is the fallback. Neither → graceful absence.
    const canUseRA = Boolean(deps.snowplowBaseUrl && deps.frontendNamespace)
    if (!canUseRA && !deps.renderBaseUrl) {
      // Graceful absence: no render path is configured. No fetch, no drawer — just an
      // honest chip saying the preview cannot be produced here.
      return { label: RENDER_UNAVAILABLE_LABEL, readOnly: true, verb: 'previewBlueprint' }
    }
    const name = args.chart ? chartDisplayName(args.chart.url) : draftDisplayName(args.rawTemplates ?? {})
    // FE-B2: inline drafts pass the client-side crdgen lint BEFORE any render fetch —
    // a #46-class schema default (or an over-cap draft) is a HARD ERROR: the drawer
    // shows the verdicts only and NOTHING leaves the browser.
    if (args.rawTemplates) {
      const problems = lintBlueprintDraft(args.rawTemplates)
      if (problems.length) {
        openAutopilotPreview({
          caption: DRAFT_REJECTED_CAPTION,
          problems,
          title: `Blueprint preview — ${name}`,
        })
        return { label: proposal.label ?? `preview ${name} (draft rejected)`, readOnly: true, verb: 'previewBlueprint' }
      }
    }
    // PREFER the RA (server-side render); DIRECT fetch is the config-absent fallback.
    const rendered = canUseRA
      ? await callBlueprintRenderRA(deps.snowplowBaseUrl!, deps.frontendNamespace!, args)
      : await callHelmRender(deps.renderBaseUrl!, args)
    // FE-B1: the create-form half — the raw values.schema.json string (verbatim from
    // the draft file when inline; the response's valuesSchema otherwise) rides the
    // payload and mounts as a read-only SchemaForm section in the drawer.
    const formSchema = buildFormSchemaText(args.rawTemplates, rendered.valuesSchema, rendered.error)
    openAutopilotPreview({
      // Name the artifact: a blueprint IS a Helm chart, and this caption + the "Chart files"
      // tab are where the user learns that (the #1 what-am-I-publishing question).
      caption: 'This blueprint is a Helm chart — Chart files is the tree the change request commits; Source is its helm-rendered objects (dry run, nothing applied to the cluster)',
      ...(rendered.error ? { error: rendered.error } : {}),
      // The authored chart tree IS the write-set a publishBlueprint commits — the unified files
      // tab (a catalog dry-run of an already-published chart has no rawTemplates, so no Files/target).
      ...(args.rawTemplates ? { files: Object.entries(args.rawTemplates).map(([path, content]) => ({ content, path })), filesLabel: 'Chart files' } : {}),
      ...(args.rawTemplates ? { publishTarget: { base: 'main', note: 'merged, CI publishes it as a versioned OCI Helm chart', repo: 'krateo-blueprints' } } : {}),
      ...(formSchema ? { formSchema } : {}),
      objects: rendered.objects,
      title: `Blueprint preview — ${name}`,
    })
    const outcome = rendered.error
      ? 'render failed'
      : `${rendered.objects.length} object${rendered.objects.length === 1 ? '' : 's'}`
    return { label: proposal.label ?? `preview ${name} (${outcome})`, readOnly: true, verb: 'previewBlueprint' }
  },
  argSchema: (proposal) => parseBlueprintPreviewArgs(proposal) !== null,
  name: 'previewBlueprint',
  sideEffect: 'read',
}

/**
 * previewPage → the honest SOURCE preview of the proposed widget CRs (see the module
 * header for why this is not a live render). ZERO network by construction: the
 * payload is built purely from the proposal and handed to the drawer.
 *
 * FE-P4: when config api.PREVIEW_SANDBOX_NAMESPACE is set, the bridge intercepts
 * `previewPage` BEFORE this registry entry and runs the v2 SANDBOX LIVE preview
 * instead (previewPageV2.ts — drafts applied to the quarantined sandbox, rendered
 * through the real widgetEndpoint). This v1 entry is the config-absent fallback and
 * stays byte-identical: read-only, zero network, source drawer.
 */
export const previewPageSpec: VerbSpec = {
  apply: (proposal) => {
    const widgets = parsePagePreviewArgs(proposal)
    if (!widgets) {
      return Promise.resolve(null)
    }
    openAutopilotPreview(buildPagePreviewPayload(widgets))
    const label = proposal.label ?? `preview page (${widgets.length} widget${widgets.length === 1 ? '' : 's'})`
    return Promise.resolve({ label, readOnly: true, verb: 'previewPage' })
  },
  argSchema: (proposal) => parsePagePreviewArgs(proposal) !== null,
  name: 'previewPage',
  sideEffect: 'read',
}

/**
 * previewRestDef → the RestDefinition draft's YAML + a client-side summary of its
 * mapped verbs/paths. Pure parsing, no network; v1 of the KOG-builder preview gate.
 */
export const previewRestDefSpec: VerbSpec = {
  apply: (proposal) => {
    const restDefinition = parseRestDefPreviewArgs(proposal)
    if (!restDefinition) {
      return Promise.resolve(null)
    }
    const payload = buildRestDefPreviewPayload(restDefinition)
    openAutopilotPreview(payload)
    // FE-P5 for KOG: a problems-carrying draft yields the page-path's "preview blocked" chip
    // convention — the provider's preview-validation trampoline + the every-turn directive
    // then drive an autonomous re-preview of a CORRECTED draft (previewProblems rides the
    // page context via previewBridge's setPreviewProblems).
    const problemCount = payload.problems?.length ?? 0
    const label = problemCount
      ? `preview blocked — ${problemCount} validation error${problemCount === 1 ? '' : 's'}`
      : proposal.label ?? payload.title
    return Promise.resolve({ label, readOnly: true, verb: 'previewRestDef' })
  },
  argSchema: (proposal) => parseRestDefPreviewArgs(proposal) !== null,
  name: 'previewRestDef',
  sideEffect: 'read',
}

/** The graceful-absence chip label when the RA transport is unavailable (no snowplow base
 * URL / no frontend namespace) — the upgrade-impact RA is the ONLY transport (the render
 * service is never browser-exposed), so absence means no diff can be produced here. */
export const UPGRADE_IMPACT_UNAVAILABLE_LABEL = 'upgrade impact unavailable — render service not reachable'

/**
 * explainUpgradeImpact → what a gated blueprint Update would change, BEFORE proposing the
 * Update runAction. Read-only end to end: it fetches the server-side `upgrade-impact`
 * RESTAction over snowplow /call (which helm-render /diffs installed-vs-target), and renders
 * the added/removed/modified objects + the values-schema flag into the shared preview drawer.
 * The Update itself still goes through useHandleAction + the blast-radius gate — never here.
 *
 * TRANSPORT: the server-side RA over snowplow /call is the ONLY path (the ClusterIP render
 * service is never browser-exposed). No snowplow base URL / frontend namespace → a graceful
 * "unavailable" chip, ZERO network. A render/diff failure is CONTENT (shown in the drawer).
 */
export const explainUpgradeImpactSpec: VerbSpec = {
  apply: async (proposal, deps) => {
    const args = parseUpgradeImpactArgs(proposal)
    if (!args) {
      return null
    }
    if (!deps.snowplowBaseUrl || !deps.frontendNamespace) {
      return { label: UPGRADE_IMPACT_UNAVAILABLE_LABEL, readOnly: true, verb: 'explainUpgradeImpact' }
    }
    const result = await callUpgradeImpactRA(deps.snowplowBaseUrl, deps.frontendNamespace, args)
    openAutopilotPreview(buildUpgradeImpactPayload(result))
    const outcome = result.error
      ? 'diff failed'
      : (result.summary || `${result.rows.length} change${result.rows.length === 1 ? '' : 's'}`)
    return { label: proposal.label ?? `upgrade impact → ${args.toVersion} (${outcome})`, readOnly: true, verb: 'explainUpgradeImpact' }
  },
  argSchema: (proposal) => parseUpgradeImpactArgs(proposal) !== null,
  name: 'explainUpgradeImpact',
  sideEffect: 'read',
}

/** The graceful-absence chip when the CRD-read transport is unavailable (no snowplow base URL). */
export const DESCRIBE_UNAVAILABLE_LABEL = 'schema check unavailable — snowplow not reachable'

/**
 * describeResource → CHECK THE LIVE CRD SCHEMA BEFORE GENERATING A CR. Reads the actual
 * CRD from the cluster (snowplow /call GET, cluster-scoped) for the proposal's gvr and
 * renders its real `spec` fields in the drawer, so the model generates the custom resource
 * against the cluster's truth instead of a (possibly stale) prompt guess. Read-only, zero
 * writes; a missing CRD / RBAC failure is shown AS content.
 */
export const describeResourceSpec: VerbSpec = {
  apply: async (proposal, deps) => {
    const args = parseDescribeResourceArgs(proposal)
    if (!args) {
      return null
    }
    if (!deps.snowplowBaseUrl) {
      return { label: DESCRIBE_UNAVAILABLE_LABEL, readOnly: true, verb: 'describeResource' }
    }
    const crdName = crdNameFromArgs(args)
    const { crd, error } = await callDescribeResourceCRD(deps.snowplowBaseUrl, crdName)
    const extract = crd ? extractCrdSpecFields(crd, args.version) : null
    openAutopilotPreview(buildDescribeResourcePayload(crdName, extract, error))
    const outcome = error || !extract ? 'not found' : `${extract.fields.length} spec field${extract.fields.length === 1 ? '' : 's'}`
    return { label: proposal.label ?? `schema: ${extract?.kind ?? crdName} (${outcome})`, readOnly: true, verb: 'describeResource' }
  },
  argSchema: (proposal) => parseDescribeResourceArgs(proposal) !== null,
  name: 'describeResource',
  sideEffect: 'read',
}

// Seed the preview verbs into the shared read-only registry (one-line entries). This
// runs on module load; actionBridge.ts imports this module so the entries are present
// before any apply() dispatch.
registerReadOnlyVerb(previewBlueprintSpec)
registerReadOnlyVerb(previewPageSpec)
registerReadOnlyVerb(previewRestDefSpec)
registerReadOnlyVerb(explainUpgradeImpactSpec)
registerReadOnlyVerb(describeResourceSpec)
