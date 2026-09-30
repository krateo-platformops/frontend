/**
 * T9 — the Controller Builder's PREVIEW (frontend#413): the held controller, rendered by oasgen-render
 * through the portal's `controller-render-draft` RESTAction (portal#277), and the verdict that decides
 * whether Publish may arm.
 *
 * THE BLUEPRINT PREVIEW'S TRANSPORT, WITH A CONTROLLER'S BODY. A controller carries its OpenAPI
 * document, so it cannot ride a GET's ?extras (the gateway's 16 KB header limit). It is written into
 * the preview sandbox as one ConfigMap by the same audited writer, under the same identity, and
 * deleted as soon as the render answers (blueprintRenderSandbox.withSandboxDraft); the RESTAction is
 * called over snowplow /call as the person, with only the ConfigMap's namespace and name in ?extras.
 * The one difference is the body, under `data["draft.json"]`:
 *
 *   { restDefinitions: [RestDefinition], oas: { "<spec.oasPath, spelled exactly>": "<document text>" } }
 *
 * — the RestDefinitions as the chart installs them (the release namespace read as the sandbox's, since
 * the preview renders there), and each document they point at, keyed by exactly the oasPath that names
 * it. oasgen-render reads nothing from the cluster, so a RestDefinition whose oasPath the chart does not
 * carry would be rendered against nothing: it is refused here, by name, before anything is written.
 *
 * NO FALLBACK. A blueprint whose sandbox write is refused falls back to the ?extras render; a controller
 * has no such path. A refused write, a portal without the RESTAction, or oasgen-render not installed is
 * said as it is — `unavailable`, with the sentence — and nothing is armed. Never a fake success.
 *
 * ARMS ONLY ON A POSITIVE RENDER WITH ZERO PROBLEMS: at least one generated CRD, and no problem (an
 * input the RESTAction refused, the service, or a severity:error finding — the controller would apply
 * nothing for that RestDefinition). Warnings (a skipped security scheme, a severity:warning finding)
 * do not stop it: they are what the controller logs and applies anyway, and they are shown.
 */
import { load } from 'js-yaml'

import {
  randomNonce,
  sandboxDraftName,
  type SandboxWriter,
  withSandboxDraft,
} from '../../components/Autopilot/blueprintRenderSandbox'
import { asRecord } from '../../components/Autopilot/kogRestDefSchema'
import { callRestActionStatus } from '../../components/Autopilot/previewBridge'
import type { PreviewObjectEntry } from '../../components/Autopilot/previewBus'

import { CONFIGMAP_PATH, readController, RELEASE_NAMESPACE, toYaml, unescapeHelm } from './controllerChart'

/** The key the controller draft rides in, as controller-render-draft reads it. */
export const CONTROLLER_DRAFT_KEY = 'draft.json'
/** The purpose label on the sandbox ConfigMap — a tab killed mid-render leaves one, labelled. */
export const CONTROLLER_PURPOSE_LABEL = 'controller-preview'
/** `ctl-preview-<controller>-<nonce>`. */
export const CONTROLLER_PREVIEW_PREFIX = 'ctl-preview'

/** What controller-render-draft renders: `data["draft.json"]` of the sandbox ConfigMap. */
export interface ControllerDraftJson {
  restDefinitions: Record<string, unknown>[]
  oas: Record<string, string>
}

/** A render as the composer keeps it: the CRDs (the objects), and what the render said about them. */
export interface ControllerRender {
  /** Every generated CRD — the Kinds first, then their Configurations; `yaml` is the CRD as JSON. */
  objects: PreviewObjectEntry[]
  /** Sentences that fail the preview. Any at all, and Publish stays off. */
  problems: string[]
  /** Sentences the controller logs and applies anyway (a skipped security scheme). */
  warnings: string[]
}

export type ControllerRenderAnswer =
  | { outcome: 'rendered'; render: ControllerRender }
  | { outcome: 'failed'; render: ControllerRender }
  | { outcome: 'unavailable'; message: string }
  | { outcome: 'refused'; message: string; problems: string[] }

/** The sentence controller-render-draft answers with when oasgen-render is not there to answer. */
const SERVICE_MISSING = /^Controller preview needs oasgen-render\b/

const REFUSED_MESSAGE = 'The controller cannot be previewed as it is — nothing was sent to the cluster.'

/** Every `{{` action left after the release namespace is resolved: the preview cannot evaluate it. */
const TEMPLATE_ACTION = /\{\{/

const resolveNamespace = <T>(value: T, namespace: string): T =>
  JSON.parse(JSON.stringify(value).split(RELEASE_NAMESPACE).join(namespace)) as T

/**
 * Every document the chart carries, keyed by the oasPath that names it once installed in `namespace`:
 * `configmap://<namespace>/<ConfigMap name>/<data key>` → the document as Helm renders it (the `{{`
 * the chart escapes, unescaped).
 */
const chartDocuments = (files: Readonly<Record<string, string>>, namespace: string): { docs: Record<string, string>; problems: string[] } => {
  const docs: Record<string, string> = {}
  const problems: string[] = []
  for (const path of Object.keys(files).filter((entry) => CONFIGMAP_PATH.test(entry)).sort()) {
    let configMap: Record<string, unknown> | null
    try {
      configMap = asRecord(load(files[path]))
    } catch (error) {
      problems.push(`${path} is not YAML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
      continue
    }
    const metadata = resolveNamespace(asRecord(configMap?.metadata) ?? {}, namespace)
    const name = typeof metadata.name === 'string' ? metadata.name : ''
    const cmNamespace = typeof metadata.namespace === 'string' && metadata.namespace ? metadata.namespace : namespace
    if (!name || TEMPLATE_ACTION.test(name) || TEMPLATE_ACTION.test(cmNamespace)) {
      problems.push(`${path}: its metadata.name and namespace must be literal (only {{ .Release.Namespace }} is resolved), so no RestDefinition can name it.`)
      continue
    }
    for (const [key, text] of Object.entries(asRecord(configMap?.data) ?? {})) {
      if (typeof text === 'string') {
        docs[`configmap://${cmNamespace}/${name}/${key}`] = unescapeHelm(text)
      }
    }
  }
  return { docs, problems }
}

/**
 * The body controller-render-draft renders, from the held files — or the sentences that say why the
 * held files cannot be rendered as they are. `namespace` is what `{{ .Release.Namespace }}` is read
 * as: the sandbox's, since that is where the preview renders.
 */
export const controllerDraftJson = (
  files: Readonly<Record<string, string>>,
  namespace: string,
): { ok: true; draft: ControllerDraftJson } | { ok: false; problems: string[] } => {
  const model = readController(files)
  const { docs, problems } = chartDocuments(files, namespace)
  if (!model.kinds.length) {
    problems.push('No Kind is placed yet — place one from the palette, then preview the controller.')
  }
  const restDefinitions: Record<string, unknown>[] = []
  const oas: Record<string, string> = {}
  for (const entry of model.kinds) {
    const restDefinition = resolveNamespace(entry.restDefinition, namespace)
    if (TEMPLATE_ACTION.test(JSON.stringify(restDefinition))) {
      problems.push(`${entry.kind} (${entry.path}): carries a Helm template action the preview cannot evaluate — only {{ .Release.Namespace }} is resolved.`)
      continue
    }
    const oasPath = asRecord(restDefinition.spec)?.oasPath
    if (typeof oasPath !== 'string' || !Object.prototype.hasOwnProperty.call(docs, oasPath)) {
      problems.push(`${entry.kind} (${entry.path}): spec.oasPath ${typeof oasPath === 'string' ? oasPath : '(unset)'} names no document this chart carries — the preview renders only the documents in the chart's ConfigMaps (${Object.keys(docs).join(', ') || 'none'}).`)
      continue
    }
    oas[oasPath] = docs[oasPath]
    restDefinitions.push(restDefinition)
  }
  return problems.length ? { ok: false, problems } : { draft: { oas, restDefinitions }, ok: true }
}

const sentences = (value: unknown): string[] =>
  (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : [])

/** The RESTAction carries each CRD as JSON (which is YAML); Source reads it as YAML. */
const asYaml = (text: string): string => {
  try {
    return toYaml(JSON.parse(text))
  } catch {
    return text
  }
}

/** controller-render-draft's answer (its `.status`), as the render the composer keeps. */
export const readControllerRender = (status: Record<string, unknown> | null): ControllerRender => {
  const objects = (Array.isArray(status?.objects) ? status.objects : []).flatMap((raw): PreviewObjectEntry[] => {
    const entry = asRecord(raw)
    if (!entry || typeof entry.yaml !== 'string') { return [] }
    return [{
      kind: typeof entry.kind === 'string' && entry.kind ? entry.kind : 'CustomResourceDefinition',
      yaml: asYaml(entry.yaml),
      ...(typeof entry.apiVersion === 'string' && entry.apiVersion ? { apiVersion: entry.apiVersion } : {}),
      ...(typeof entry.name === 'string' && entry.name ? { name: entry.name } : {}),
    }]
  })
  const problems = sentences(status?.problems)
  // An `error` with no problems listed (an older filter) still fails the preview.
  if (!problems.length && typeof status?.error === 'string' && status.error.trim()) {
    problems.push(status.error)
  }
  return { objects, problems, warnings: sentences(status?.warnings) }
}

/** The verdict on one render: armed only on at least one CRD and no problem at all. */
export const controllerVerdict = (render: ControllerRender): ControllerRenderAnswer => {
  const missing = render.problems.filter((problem) => SERVICE_MISSING.test(problem))
  if (missing.length) {
    return { message: missing.join(' '), outcome: 'unavailable' }
  }
  if (render.problems.length) {
    return { outcome: 'failed', render: { ...render, objects: [] } }
  }
  if (!render.objects.length) {
    return { outcome: 'failed', render: { ...render, problems: ['oasgen-render generated no CRD for this controller, so there is nothing to publish yet.'] } }
  }
  return { outcome: 'rendered', render }
}

/** Where the render runs: snowplow, and the RESTAction the Controller Builder names. */
export interface ControllerRenderTarget {
  snowplowBaseUrl: string
  /** The namespace the RESTAction is installed in. */
  namespace: string
  restAction: string
}

/**
 * Render the held controller: build draft.json, write it into the sandbox, call the RESTAction by
 * name, delete the ConfigMap, and answer with the verdict. Never throws.
 */
export const renderController = async (
  files: Readonly<Record<string, string>>,
  target: ControllerRenderTarget,
  writer: SandboxWriter,
  controllerName: string,
  nonce: string = randomNonce(),
): Promise<ControllerRenderAnswer> => {
  const built = controllerDraftJson(files, writer.sandboxNamespace)
  if (!built.ok) {
    return { message: REFUSED_MESSAGE, outcome: 'refused', problems: built.problems }
  }
  const draft = {
    body: built.draft,
    key: CONTROLLER_DRAFT_KEY,
    name: sandboxDraftName(CONTROLLER_PREVIEW_PREFIX, controllerName, nonce),
    purpose: CONTROLLER_PURPOSE_LABEL,
  }
  const answered = await withSandboxDraft(writer, draft, (ref) =>
    callRestActionStatus(target.snowplowBaseUrl, target.namespace, target.restAction, JSON.stringify(ref)))
  if (!answered.written) {
    return {
      message: `The controller could not be written into the preview sandbox (${writer.sandboxNamespace}: ${answered.reason}), so it was not rendered. It is still held; Publish stays off.`,
      outcome: 'unavailable',
    }
  }
  if ('error' in answered.value) {
    return {
      message: `${answered.value.error} — this portal cannot preview a controller without its ${target.restAction} RESTAction (portal#277). The controller is still held; Publish stays off.`,
      outcome: 'unavailable',
    }
  }
  if (!answered.value.status) {
    return { message: `${target.restAction} answered nothing, so the controller was not rendered. It is still held; Publish stays off.`, outcome: 'unavailable' }
  }
  return controllerVerdict(readControllerRender(answered.value.status))
}

// ── the Rendered tab ──────────────────────────────────────────────────────────────────────────────

/** One generated Kind's create form: the `spec` schema of its CRD, as the form machinery reads it. */
export interface RenderedForm {
  kind: string
  /** The CRD's name, e.g. `pets.petstore.example.io`. */
  crd: string
  /** The raw JSON schema string buildFormPreviewModel reads. */
  schema: string
}

/**
 * The create form of every generated CRD, read from the render's objects: the `spec` of the served
 * (storage first) version's openAPIV3Schema — what a person fills in to create one. A CRD with no such
 * schema has no form, and is left to Source.
 */
export const renderedForms = (objects: readonly PreviewObjectEntry[]): RenderedForm[] => objects.flatMap((object) => {
  let crd: Record<string, unknown> | null
  try {
    crd = asRecord(load(object.yaml))
  } catch {
    return []
  }
  const spec = asRecord(crd?.spec)
  const versions = (Array.isArray(spec?.versions) ? spec.versions : []).map((version) => asRecord(version) ?? {})
  const version = versions.find((entry) => entry.storage === true) ?? versions.find((entry) => entry.served !== false) ?? versions[0]
  const specSchema = asRecord(asRecord(asRecord(asRecord(version?.schema)?.openAPIV3Schema)?.properties)?.spec)
  const kind = asRecord(spec?.names)?.kind
  if (!specSchema || typeof kind !== 'string' || !kind) { return [] }
  const metadataName = asRecord(crd?.metadata)?.name
  return [{ crd: object.name ?? (typeof metadataName === 'string' && metadataName ? metadataName : kind), kind, schema: JSON.stringify(specSchema) }]
})
