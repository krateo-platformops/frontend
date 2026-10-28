/**
 * T8 — STARTING a controller (frontend#412): what the start modal validates and the files a start
 * holds. Pure. Split from controllerChart.ts, which reads and edits a held draft.
 *
 * WHAT A START GUARDS (review of #428):
 *   - the API group is not Kubernetes' or a Krateo system group (apiGroupProblem);
 *   - the base URL is absolute, with no `{variable}`, and EVERY `servers` list of the document —
 *     root, path, operation — is rewritten to it (withServers), and the modal says what was rewritten;
 *   - a spec over SPEC_TEXT_MAX_BYTES is not parsed at all, one using YAML aliases is refused by the
 *     parser (oasImport sharesNodes), and one whose written-out size is over ten times its text is
 *     refused rather than held;
 *   - a caller that has already read the spec passes the reading in, so a keystroke in another field
 *     does not parse the document again;
 *   - a document read from a URL (the modal's URL tab and the agent's controllerStart alike) is read as
 *     nobody, capped at SPEC_TEXT_MAX_BYTES and abandoned after SPEC_FETCH_TIMEOUT_MS (readSpecUrl);
 *   - the document's info.version is held as v1alpha1 — the version every Kind is served under — and
 *     the vendor's own is kept on Chart.yaml (servedVersion.ts; the store re-pins it on every write).
 */
import { CHART_YAML_PATH, VALUES_SCHEMA_PATH } from '../../components/Autopilot/blueprintDraft'
import { kogValuesSchema } from '../../components/Autopilot/kogChart'
import { KOG_MANAGED_BY_LABEL } from '../../components/Autopilot/kogMapping'
import { utf8ByteLength } from '../../components/Autopilot/oasAttachment'
import { chartIdentityProblems, publishNameProblem } from '../BlueprintComposer/chartIdentity'

import {
  BASE_URL_ANNOTATION,
  CONTROLLER_START_VERSION,
  escapeHelm,
  GROUP_ANNOTATION,
  oasConfigMapKey,
  oasConfigMapName,
  oasConfigMapPath,
  RELEASE_NAMESPACE,
  serverLocations,
  SPEC_BUDGET_BYTES,
  toYaml,
  VALUES_YAML_PATH,
  withServers,
} from './controllerChart'
import { type OasDocument, type OasFormat, type OasImport, parseOas, serializeOas, trimOas } from './oasImport'
import { pinDocVersion, SERVED_VERSION, SERVED_VERSION_COMMENT, SOURCE_SPEC_VERSION_ANNOTATION, specInfoVersion } from './servedVersion'
import { urlCredentialProblem } from './urlCredential'

// ── start ───────────────────────────────────────────────────────────────────────────────────────

export interface StartControllerInput {
  name: string
  apiGroup: string
  /** The OpenAPI document's text, however it arrived (pasted, uploaded, read from a URL). */
  spec: string
  baseUrl: string
  /** For a document over the budget: the paths to keep. Null: keep the whole document. */
  paths: string[] | null
}

export type StartControllerField = 'name' | 'apiGroup' | 'spec' | 'baseUrl' | 'paths'

export interface StartControllerProblem {
  field: StartControllerField
  message: string
}

/** A DNS subdomain with at least one dot — what the generated CRDs' group must be. */
const GROUP_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)+$/
/** Absolute http(s), no whitespace and no braces: a `{host}` variable is a URL nobody chose yet. */
const URL_PATTERN = /^https?:\/\/[^\s/?#{}]+[^\s{}]*$/

/**
 * API groups a controller may not serve its Kinds in: Krateo's own (the CRDs the portal, the
 * composition engine and oasgen itself are made of) and Kubernetes'. A Kind generated there would sit
 * beside — or collide with — a system CRD, and every install would own a piece of the platform.
 */
export const RESERVED_KRATEO_GROUPS = [
  'krateo.io',
  'core.krateo.io',
  'composition.krateo.io',
  'ogen.krateo.io',
  'swaggergen.krateo.io',
  'templates.krateo.io',
  'widgets.templates.krateo.io',
  'builders.templates.krateo.io',
  'git.krateo.io',
] as const

export const apiGroupProblem = (raw: string): string | null => {
  const group = raw.trim()
  if (!group) { return 'Required — the API group the Kinds are served in. The core (empty) group is Kubernetes\' own.' }
  if (group === 'core' || group === 'v1') {
    return `"${group}" names the Kubernetes core group — a controller's Kinds need a group of their own (e.g. petstore.example.io).`
  }
  if (/(^|\.)(x-)?k8s\.io$/.test(group) || /(^|\.)kubernetes\.io$/.test(group)) {
    return `${group} is reserved for Kubernetes itself — the apiserver refuses CRDs there without an approved API review. Choose a group you own (e.g. petstore.example.io).`
  }
  const reserved = RESERVED_KRATEO_GROUPS.find((entry) => group === entry || (entry !== 'krateo.io' && group.endsWith(`.${entry}`)))
  if (reserved) {
    return `${group} is a Krateo system group (${reserved}) — the platform's own CRDs live there, and a generated Kind beside them could shadow or collide with one. Choose a group you own (e.g. petstore.example.io).`
  }
  if (group.length > 253 || !GROUP_PATTERN.test(group)) {
    return 'A DNS subdomain with at least one dot, lower-case (e.g. petstore.example.io) — the generated CRDs are refused otherwise.'
  }
  return null
}

export const baseUrlProblem = (raw: string): string | null => {
  const url = raw.trim()
  if (!url) { return 'Required — the URL the controller sends every request to.' }
  if (/[{}]/.test(url)) { return 'A server URL with a variable ({…}) is not a destination — write the URL the controller calls, with no braces.' }
  const credential = urlCredentialProblem(url)
  if (credential) { return credential }
  return URL_PATTERN.test(url) ? null : 'An absolute http(s) URL (e.g. https://petstore3.swagger.io/api/v3).'
}

/** The largest spec text read at all — past it, nothing is parsed (a paste, an upload, a URL body). */
export const SPEC_TEXT_MAX_BYTES = 8 * 1024 * 1024

/** What the start modal shows about the document, once it reads. */
export interface SpecReading {
  oas: OasImport | null
  /** The one sentence a paste that does not read gets (with its line, when the parser named one). */
  error: string | null
  /** The document as it would be held, with `servers` set to the base URL — before any trim. */
  bytes: number
  overBudget: boolean
}

/** What Start will rewrite, in one sentence — or null when the document names no server beside the root. */
export const serverRewriteSentence = (doc: OasDocument, baseUrl: string): string | null => {
  const nested = serverLocations(doc).filter((where) => where !== 'servers')
  if (!nested.length || !baseUrl.trim()) { return null }
  const listed = nested.length > 3 ? `${nested.slice(0, 3).join(', ')} and ${nested.length - 3} more` : nested.join(', ')
  return `The document names its own servers beside the root (${listed}); each is rewritten to ${baseUrl.trim()}, so every request — and its credential — goes only there.`
}

export const readSpec = (text: string, baseUrl = ''): SpecReading => {
  if (!text.trim()) {
    return { bytes: 0, error: null, oas: null, overBudget: false }
  }
  const textBytes = utf8ByteLength(text)
  if (textBytes > SPEC_TEXT_MAX_BYTES) {
    return { bytes: textBytes, error: `The spec is ${Math.ceil(textBytes / 1024 / 1024)} MiB — over the ${SPEC_TEXT_MAX_BYTES / 1024 / 1024} MiB this builder reads. Trim it to the paths this controller serves first.`, oas: null, overBudget: false }
  }
  const parsed = parseOas(text)
  if (!parsed.ok) {
    return { bytes: utf8ByteLength(text), error: parsed.error, oas: null, overBudget: false }
  }
  if (parsed.documents.length !== 1) {
    return { bytes: utf8ByteLength(text), error: `The spec holds ${parsed.documents.length} documents; a controller reads one — paste one of them.`, oas: null, overBudget: false }
  }
  const [oas] = parsed.documents
  const bytes = utf8ByteLength(serializeOas(withServers(oas.doc, baseUrl), oas.format))
  if (bytes > textBytes * 10 + 64 * 1024) {
    return { bytes, error: `The spec reads as ${Math.ceil(bytes / 1024)} KiB from ${Math.ceil(textBytes / 1024)} KiB of text — more than ten times its size. It is refused rather than written out.`, oas: null, overBudget: false }
  }
  return { bytes, error: null, oas, overBudget: bytes > SPEC_BUDGET_BYTES }
}

/** The document a start holds: servers set to the base URL, trimmed to the chosen paths when asked. */
const heldDocument = (oas: OasImport, input: StartControllerInput): { doc: OasDocument; bytes: number } => {
  const doc = withServers(oas.doc, input.baseUrl)
  if (!input.paths) {
    return { bytes: utf8ByteLength(serializeOas(doc, oas.format)), doc }
  }
  const trimmed = trimOas(doc, input.paths, oas.format)
  return { bytes: trimmed.bytes, doc: trimmed.doc }
}

/** `reading` is readSpec(input.spec, input.baseUrl) when the caller already has it — it is not parsed again. */
export const validateStartController = (input: StartControllerInput, reading: SpecReading = readSpec(input.spec, input.baseUrl)): StartControllerProblem[] => {
  const problems: StartControllerProblem[] = []
  const name = input.name.trim()
  const nameProblems = chartIdentityProblems({ name, version: CONTROLLER_START_VERSION }).filter((problem) => problem.field === 'name')
  if (nameProblems.length) {
    problems.push({ field: 'name', message: nameProblems[0].message })
  } else {
    const publish = publishNameProblem(name)
    if (publish) { problems.push({ field: 'name', message: publish }) }
  }
  const group = apiGroupProblem(input.apiGroup)
  if (group) { problems.push({ field: 'apiGroup', message: group }) }
  if (!input.spec.trim()) {
    problems.push({ field: 'spec', message: 'Required — paste the OpenAPI 3.x document, upload it, or read it from a URL.' })
  } else if (reading.error) {
    problems.push({ field: 'spec', message: reading.error })
  } else if (reading.oas) {
    if (reading.overBudget && !input.paths) {
      problems.push({ field: 'paths', message: `The document is ${Math.ceil(reading.bytes / 1024)} KiB, over the ${Math.floor(SPEC_BUDGET_BYTES / 1024)} KiB a draft can hold beside its chart — choose the paths this controller serves.` })
    } else if (input.paths) {
      if (!input.paths.length) {
        problems.push({ field: 'paths', message: 'Choose at least one path.' })
      } else {
        const { bytes } = heldDocument(reading.oas, input)
        if (bytes > SPEC_BUDGET_BYTES) {
          problems.push({ field: 'paths', message: `Trimmed to these paths it is still ${Math.ceil(bytes / 1024)} KiB — over ${Math.floor(SPEC_BUDGET_BYTES / 1024)} KiB. Choose fewer.` })
        }
      }
    }
  }
  const base = baseUrlProblem(input.baseUrl)
  if (base) { problems.push({ field: 'baseUrl', message: base }) }
  return problems
}

/**
 * The icon a started controller chart carries, the same brand path a started BLUEPRINT uses (#454).
 * The Marketplace's blueprints index (krateo-blueprints/charts publish-chart.yaml) REFUSES a chart
 * without an https icon — it logs "it needs an https icon in Chart.yaml" and the release's index job
 * is skipped — so without this a merged controller is released and silently left out of the
 * Marketplace, and nobody can Install it from there. #454 fixed that for the Blueprint Composer only.
 * The author can point it at another image in the Files tab like any other Chart.yaml line.
 */
const CHART_ICON = 'https://raw.githubusercontent.com/krateo-platformops/.github/main/brand/logo.svg'

/** Chart.yaml in the order Helm's own files read — built by assignment, since the order is the file's. */
const chartYaml = (name: string, group: string, baseUrl: string, title: string, sourceVersion: string | null): string => {
  const chart: Record<string, unknown> = {}
  chart.apiVersion = 'v2'
  chart.name = name
  chart.description = title ? `Krateo controller for ${title}, served in ${group}.` : `Krateo controller, served in ${group}.`
  chart.icon = CHART_ICON
  chart.type = 'application'
  chart.version = CONTROLLER_START_VERSION
  const annotations: Record<string, string> = {}
  annotations[GROUP_ANNOTATION] = group
  annotations[BASE_URL_ANNOTATION] = baseUrl
  // The vendor's info.version: the held document says v1alpha1 (servedVersion.ts), this says what it was.
  if (sourceVersion && sourceVersion !== SERVED_VERSION) { annotations[SOURCE_SPEC_VERSION_ANNOTATION] = sourceVersion }
  chart.annotations = annotations
  return toYaml(chart)
}

const VALUES_YAML = '# This controller chart ships its RestDefinitions and the OpenAPI document they read.\n'
  + '# Nothing is parameterised: every manifest is created in the release namespace.\n'
  + '{}\n'

/**
 * The ConfigMap template carrying the document under the key its format names — verbatim but for two
 * rewrites: its servers (the base URL) and its info.version, pinned to v1alpha1 (servedVersion.ts),
 * which the comment at its head explains to whoever opens the file.
 */
export const oasConfigMapYaml = (name: string, doc: OasDocument, format: OasFormat): string => {
  const configMap: Record<string, unknown> = {}
  configMap.apiVersion = 'v1'
  configMap.kind = 'ConfigMap'
  configMap.metadata = { labels: { ...KOG_MANAGED_BY_LABEL }, name: oasConfigMapName(name), namespace: RELEASE_NAMESPACE }
  configMap.data = { [oasConfigMapKey(format)]: escapeHelm(serializeOas(pinDocVersion(doc), format)) }
  return `${SERVED_VERSION_COMMENT}\n${toYaml(configMap)}`
}

export type StartControllerResult =
  | { ok: true; files: Record<string, string> }
  | { ok: false; problems: StartControllerProblem[] }

export const startController = (input: StartControllerInput, reading: SpecReading = readSpec(input.spec, input.baseUrl)): StartControllerResult => {
  const problems = validateStartController(input, reading)
  if (problems.length || !reading.oas) {
    return { ok: false, problems: problems.length ? problems : [{ field: 'spec', message: 'The spec did not read.' }] }
  }
  const name = input.name.trim()
  const { doc } = heldDocument(reading.oas, input)
  const files: Record<string, string> = {}
  files[CHART_YAML_PATH] = chartYaml(name, input.apiGroup.trim(), input.baseUrl.trim(), reading.oas.summary.title, specInfoVersion(reading.oas.doc))
  files[VALUES_YAML_PATH] = VALUES_YAML
  files[VALUES_SCHEMA_PATH] = kogValuesSchema(name)
  files[oasConfigMapPath(name)] = oasConfigMapYaml(name, doc, reading.oas.format)
  return { files, ok: true }
}

// ── reading a document from a URL ─────────────────────────────────────────────────────────────────

/** How long a URL read may take before it is abandoned. */
export const SPEC_FETCH_TIMEOUT_MS = 20_000

/**
 * Read a document from a URL, as nobody: no cookies or credentials ride along (`credentials: 'omit'`),
 * no referrer is sent (`referrerPolicy: 'no-referrer'`), and a redirect is refused rather than
 * followed (`redirect: 'error'`) — the URL read is the one that was given. A URL that carries a
 * credential of its own (user:pass@, a key or token in the query) is refused before anything is sent.
 * A declared Content-Length over the cap is refused before the body is read; the body itself is
 * STREAMED with a byte counter and abandoned the moment it passes SPEC_TEXT_MAX_BYTES, so a server
 * that lies about its length, or sends none, never makes this read more than the cap. The whole read
 * is abandoned after SPEC_FETCH_TIMEOUT_MS.
 */
export const readSpecUrl = async (url: string, timeoutMs = SPEC_FETCH_TIMEOUT_MS): Promise<{ text: string } | { problem: string }> => {
  const credential = urlCredentialProblem(url)
  if (credential) {
    return { problem: credential }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const cap = `${SPEC_TEXT_MAX_BYTES / 1024 / 1024} MiB`
  const over = { problem: `The URL served more than ${cap} — over what this builder reads. Nothing more was downloaded.` }
  try {
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal })
    if (!response.ok) {
      return { problem: `The URL answered ${response.status} — paste or upload the document instead.` }
    }
    const declared = Number(response.headers.get('content-length') ?? NaN)
    if (Number.isFinite(declared) && declared > SPEC_TEXT_MAX_BYTES) {
      controller.abort()
      return { problem: `The URL serves ${Math.ceil(declared / 1024 / 1024)} MiB — over the ${cap} this builder reads. Nothing more was downloaded.` }
    }
    const reader = response.body?.getReader()
    if (!reader) {
      // No stream to count (a runtime without ReadableStream bodies): the text, measured after.
      const text = await response.text()
      return utf8ByteLength(text) > SPEC_TEXT_MAX_BYTES ? over : { text }
    }
    const decoder = new TextDecoder()
    let bytes = 0
    let text = ''
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- a stream is read chunk by chunk, counting as it goes.
      const { done, value } = await reader.read()
      if (done) { break }
      bytes += value.byteLength
      if (bytes > SPEC_TEXT_MAX_BYTES) {
        controller.abort()
        void reader.cancel().catch(() => undefined)
        return over
      }
      text += decoder.decode(value, { stream: true })
    }
    return { text: text + decoder.decode() }
  } catch (error) {
    if (controller.signal.aborted) {
      return { problem: `The URL did not answer within ${Math.round(timeoutMs / 1000)} s — paste or upload the document instead.` }
    }
    return { problem: `This browser could not read the URL (${error instanceof Error ? error.message : String(error)}) — the server may not allow it, or it redirected, which is not followed. Paste or upload the document instead.` }
  } finally {
    clearTimeout(timer)
  }
}

/** The Start modal's "served as" line: `<group>/v1alpha1`, and what the document's own version was. */
export const servedAsSentence = (group: string, doc: OasDocument | null): string => {
  const source = doc ? specInfoVersion(doc) : null
  const served = `${group.trim() || '<group>'}/${SERVED_VERSION}`
  return source && source !== SERVED_VERSION
    ? `${served} — pinned: the document says ${source}, and a vendor bump must not move the served version (kept as ${SOURCE_SPEC_VERSION_ANNOTATION})`
    : served
}
