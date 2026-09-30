/**
 * Render a draft chart by WRITING it to the preview sandbox and reading it back by name — the page
 * builder's preview model, applied to a chart.
 *
 * WHY. `blueprint-render` takes the chart in ?extras, and a GET carries ?extras in its URL. The
 * gateway in front of snowplow refuses an HTTP/2 request whose headers pass 16 KB (431), and a chart
 * travels there as JSON in JSON in a URL — 1.6-2.6x its size — so a 12 KB chart written by
 * core-provider-agent could not be previewed at all. Written into the sandbox the chart travels in a
 * request BODY (up to a ConfigMap's 1 MiB), and only the ConfigMap's name rides the URL.
 *
 * HOW, in three steps, all under the user's own identity:
 *   1. WRITE — one ConfigMap, `data["chart.json"]` = the same body `blueprint-render` builds from
 *      ?extras (rawTemplates, values, lookupStubs), POSTed into the sandbox through the audited set
 *      fabric. The confirm is skipped only because runRestSet VERIFIES every op is confined to the
 *      sandbox namespace, as for a page preview; provenance is still recorded.
 *   2. RENDER — the portal's `blueprint-render-draft` RESTAction, extras = {namespace, name}.
 *   3. DELETE — the ConfigMap, as soon as the render has answered, whatever it answered. A tab that
 *      dies between 1 and 3 leaves one, labelled `krateo.io/purpose: blueprint-preview`; the
 *      sandbox's object-count quota bounds how many can pile up.
 *
 * FALLBACK. If the sandbox is not configured, the write is refused (no ConfigMap grant on an older
 * frontend chart, the quota full) or the RESTAction is not installed (an older portal), the answer is
 * null and the caller renders the old way — so no release order between frontend, frontend chart and
 * portal can take Preview away. A render that RAN and failed (a bad chart) is the answer, not a
 * fallback.
 */
import type { SetDispatchOptions, WriteOpResult } from '../../hooks/runRestSet'
import type { WriteOp } from '../BlastRadius/buildBlastRadius'

import { buildSetOpPath, type ApplyResourceSetOp } from './applyResourceSet'
import {
  type BlueprintPreviewArgs,
  callBlueprintRenderRA,
  callRenderRestAction,
  type HelmRenderResult,
  renderRequestBody,
} from './previewBridge'

/** The one key the chart rides in: ConfigMap keys cannot hold the `/` of chart paths. */
export const DRAFT_CHART_KEY = 'chart.json'
export const DRAFT_RENDER_RESTACTION = 'blueprint-render-draft'
export const DRAFT_PURPOSE_LABEL = 'blueprint-preview'

/** What the sandbox write needs: the namespace and the audited set dispatcher. */
export interface SandboxWriter {
  sandboxNamespace: string
  handleActionSet: (ops: readonly WriteOp[], options?: SetDispatchOptions) => Promise<WriteOpResult[] | null>
}

const CONFIGMAPS = { group: '', resource: 'configmaps', version: 'v1' }

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')

/** `<prefix>-<name>-<nonce>`, a DNS-1123 name within 63 characters. */
export const sandboxDraftName = (prefix: string, draftName: string, nonce: string): string => {
  const tail = `-${slug(nonce).slice(0, 8) || 'x'}`
  const head = `${prefix}-${slug(draftName) || 'chart'}`.slice(0, 63 - tail.length).replace(/-+$/, '')
  return `${head}${tail}`
}

/** `bp-preview-<chart>-<nonce>`, a DNS-1123 name within 63 characters. */
export const draftChartName = (chartName: string, nonce: string): string => sandboxDraftName('bp-preview', chartName, nonce)

/** The ConfigMap one render writes: the render body, whole, under one key, labelled for what it previews. */
export const sandboxDraftConfigMap = (name: string, namespace: string, key: string, purpose: string, body: unknown): Record<string, unknown> => ({
  apiVersion: 'v1',
  data: { [key]: JSON.stringify(body) },
  kind: 'ConfigMap',
  metadata: { labels: { 'krateo.io/purpose': purpose }, name, namespace },
})

/** The ConfigMap a chart render writes: the render body, whole, under one key. */
export const draftChartConfigMap = (name: string, namespace: string, body: Record<string, unknown>): Record<string, unknown> =>
  sandboxDraftConfigMap(name, namespace, DRAFT_CHART_KEY, DRAFT_PURPOSE_LABEL, body)

const writeOp = (op: ApplyResourceSetOp): WriteOp => ({
  path: buildSetOpPath(op),
  verb: op.verb,
  ...(op.payload === undefined ? {} : { payload: op.payload }),
})

export const randomNonce = (): string => Math.random().toString(36).slice(2, 10)

/** One draft to render by name: the ConfigMap's name, the key its body rides in, and its purpose label. */
export interface SandboxDraft {
  name: string
  key: string
  purpose: string
  body: unknown
}

/**
 * The three steps every sandbox render takes — WRITE the draft as one ConfigMap in the sandbox (the
 * audited set fabric, confined there, so the confirm is skipped), RENDER it by name, DELETE it
 * whatever the render answered. `written: false` (with why) when the write was refused: nothing was
 * rendered, and the caller decides what that means for its builder.
 */
export const withSandboxDraft = async <T>(
  writer: SandboxWriter,
  draft: SandboxDraft,
  render: (ref: { name: string; namespace: string }) => Promise<T>,
): Promise<{ written: true; value: T } | { written: false; reason: string }> => {
  const namespace = writer.sandboxNamespace
  const { name } = draft
  const options: SetDispatchOptions = { silent: true, skipConfirmForSandbox: namespace }
  const written = await writer.handleActionSet([writeOp({
    gvr: CONFIGMAPS,
    namespace,
    payload: sandboxDraftConfigMap(name, namespace, draft.key, draft.purpose, draft.body),
    verb: 'POST',
  })], options)
  if (!written?.length || !written.every((result) => result.ok)) {
    const refused = written?.find((result) => !result.ok)
    return { reason: refused ? `${refused.status} ${refused.message}`.trim() : 'the write was not dispatched', written: false }
  }
  try {
    return { value: await render({ name, namespace }), written: true }
  } finally {
    // Whatever the render answered, the draft does not outlive it.
    await writer.handleActionSet([writeOp({ gvr: CONFIGMAPS, name, namespace, verb: 'DELETE' })], options).catch(() => null)
  }
}

/**
 * Render an inline draft through the sandbox. Null when that path is not available — the caller
 * then renders the old way (see FALLBACK above).
 */
export const renderDraftViaSandbox = async (
  snowplowBaseUrl: string,
  frontendNamespace: string,
  args: BlueprintPreviewArgs,
  writer: SandboxWriter,
  nonce: string = randomNonce(),
): Promise<HelmRenderResult | null> => {
  if (!args.rawTemplates) {
    return null
  }
  const chartName = typeof args.rawTemplates['Chart.yaml'] === 'string'
    ? (/^name:\s*["']?([^"'\s]+)/m.exec(args.rawTemplates['Chart.yaml'])?.[1] ?? 'chart')
    : 'chart'
  const draft = { body: renderRequestBody(args), key: DRAFT_CHART_KEY, name: draftChartName(chartName, nonce), purpose: DRAFT_PURPOSE_LABEL }
  const answered = await withSandboxDraft(writer, draft, (ref) =>
    callRenderRestAction(snowplowBaseUrl, frontendNamespace, DRAFT_RENDER_RESTACTION, JSON.stringify(ref)))
  if (!answered.written) {
    return null
  }
  // The RESTAction itself missing or refused (an older portal): not a render — fall back.
  return /^blueprint-render-draft RESTAction (responded|unreachable)/.test(answered.value.error ?? '') ? null : answered.value
}

/**
 * Render a blueprint preview: an inline draft through the sandbox when there is one, and the
 * ?extras RESTAction otherwise — a published chart's dry run (a URL, never large), or any draft the
 * sandbox path could not take.
 */
export const renderBlueprint = async (
  snowplowBaseUrl: string,
  frontendNamespace: string,
  args: BlueprintPreviewArgs,
  writer?: SandboxWriter,
): Promise<HelmRenderResult> => {
  if (writer && args.rawTemplates) {
    const viaSandbox = await renderDraftViaSandbox(snowplowBaseUrl, frontendNamespace, args, writer)
    if (viaSandbox) {
      return viaSandbox
    }
  }
  return callBlueprintRenderRA(snowplowBaseUrl, frontendNamespace, args)
}
