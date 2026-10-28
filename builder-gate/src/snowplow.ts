/**
 * Every judgement of a draft against the live cluster goes through snowplow, AS THE CALLER — the
 * person the agent works for, whose Krateo JWT kagent forwards on the MCP request
 * (KAGENT_PROPAGATE_TOKEN). The gate holds no RBAC for it and emulates nothing snowplow does.
 *
 * The contract is snowplow#443's design (confirmed 2026-10-04; lands in snowplow 1.12.36), written
 * up in docs/snowplow-contract.md:
 *   - `GET  /capabilities`                                  static tokens; 404 = none
 *   - `GET  /call?…&raw=true`                               the stored object  → echo X-Snowplow-Raw: true
 *   - `POST /call/dry-run?…&dryRun=All&fieldValidation=Strict`  the dry-run create
 *                                                           → echo X-Snowplow-Dry-Run: All, X-Snowplow-Field-Validation: Strict
 *   - `POST /call/read?…resource=restactions…` body {extras, object}  the inline resolve
 *                                                           → echo X-Snowplow-Dry-Run: All, X-Snowplow-Resolve-Source: request-body,
 *                                                             and X-Snowplow-Stage-Outcomes (snowplow PR #469)
 *
 * SAFETY, unchanged in posture:
 *   - each call is sent only once snowplow advertises its capability token — never by version;
 *   - the dry-run goes ONLY to /call/dry-run, a route an older snowplow does not serve (404,
 *     nothing written), never to /call, which an older snowplow would treat as a real create;
 *   - a reply without its echo is a FAILURE, never a pass: an older snowplow answering /call/read
 *     resolves the STORED RESTAction, and only the echo tells the two apart.
 */
import { type HttpResponse, jsonOf, nodeTransport, type Transport } from './http'
import { safeSegment } from './kube'

/** The capability tokens snowplow#443's design names. */
export const CAPABILITY_DRY_RUN = 'call.dryRun'
export const CAPABILITY_FIELD_VALIDATION = 'call.fieldValidation'
export const CAPABILITY_RAW_READ = 'call.raw'
export const CAPABILITY_RESOLVE = 'call.read.inline'

/**
 * The reason code of a write-verb stage an inline resolve refuses to run, by design (snowplow PR
 * #469). Its documented per-stage error message — `dry-run: stage "<id>" verb <V> is not
 * executed` — is stable too, and is accepted as a fallback (STAGE_NOT_EXECUTED_MESSAGE).
 */
export const STAGE_NOT_EXECUTED_REASON = 'StageNotExecuted'
/** A stage that never ran: the resolve stopped (truncated) at an earlier stage, in topological order. */
export const STAGE_NOT_RUN_REASON = 'NotRun'
/** The CLOSED set of stage reason codes (snowplow PR #469, stage_outcomes.go). Anything else is unknown. */
export const STAGE_REASONS: ReadonlySet<string> = new Set([STAGE_NOT_EXECUTED_REASON, 'Forbidden', 'NotFound', 'Unauthorized', STAGE_NOT_RUN_REASON, 'Error'])
export const STAGE_NOT_EXECUTED_MESSAGE = /^dry-run: stage .* is not executed$/

/**
 * The stage outcomes header on an inline resolve reply (snowplow PR #469): compact JSON in
 * topological stage order, `[{"name","ok":true},{"name","ok":false,"reason":"<code>"}]`, reason
 * codes only (STAGE_REASONS), no message text; past 4 KiB it becomes
 * `{"truncated":true,"failed":N}`. It is THE source of stage outcomes: unlike the body, no
 * spec.filter can drop it.
 */
export const STAGE_OUTCOMES = 'x-snowplow-stage-outcomes'

export interface StageOutcome {
  name: string
  ok: boolean
  reason?: string
}

export type StageOutcomes =
  | { kind: 'stages'; stages: StageOutcome[] }
  | { kind: 'truncated'; failed: number }
  | { kind: 'missing' }
  | { kind: 'invalid'; why: string }

/** The X-Snowplow-Stage-Outcomes header, parsed — and anything that is not the documented shape, named. */
export const stageOutcomesOf = (headers: HttpResponse['headers'] | undefined): StageOutcomes => {
  const raw = headerOf(headers, STAGE_OUTCOMES)
  if (!raw) {
    return { kind: 'missing' }
  }
  const parsed = jsonOf(raw)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as { truncated?: unknown }).truncated === true) {
    const failed = (parsed as { failed?: unknown }).failed
    return { kind: 'truncated', failed: typeof failed === 'number' ? failed : NaN }
  }
  if (!Array.isArray(parsed)) {
    return { kind: 'invalid', why: 'not a JSON array' }
  }
  const stages: StageOutcome[] = []
  for (const entry of parsed) {
    const e = entry as { name?: unknown; ok?: unknown; reason?: unknown } | null
    if (!e || typeof e.name !== 'string' || typeof e.ok !== 'boolean' || (e.reason !== undefined && typeof e.reason !== 'string')) {
      return { kind: 'invalid', why: `an entry is not {name, ok, reason}: ${JSON.stringify(entry).slice(0, 120)}` }
    }
    stages.push({ name: e.name, ok: e.ok, ...(typeof e.reason === 'string' && e.reason ? { reason: e.reason } : {}) })
  }
  return { kind: 'stages', stages }
}

/** The parameters every dry-run carries — a constant: no caller reaches this string. */
export const DRY_RUN_PARAMS = 'dryRun=All&fieldValidation=Strict'

/** The echo headers (lower-case, as node delivers them) and the value each must carry. */
export const ECHO_DRY_RUN = 'x-snowplow-dry-run'
export const ECHO_FIELD_VALIDATION = 'x-snowplow-field-validation'
export const ECHO_RESOLVE_SOURCE = 'x-snowplow-resolve-source'
export const ECHO_RAW = 'x-snowplow-raw'

const GROUP_VERSION = /^([a-z0-9.-]+\/)?v[0-9]+[a-z0-9]*$/
const PLURAL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

export interface SnowplowReply {
  status: number
  json: unknown
  body: string
  headers: HttpResponse['headers']
}

export type Capabilities = { ok: true; offered: Set<string> } | { ok: false; reason: string }

export interface SnowplowClient {
  readonly url: string
  /** The only namespace a dry-run or an inline resolve names (the preview sandbox). */
  readonly sandboxNamespace: string
  capabilities(timeoutMs: number): Promise<Capabilities>
  read(apiVersion: string, resource: string, namespace: string, name: string, timeoutMs: number): Promise<SnowplowReply>
  dryRunCreate(apiVersion: string, resource: string, object: Record<string, unknown>, timeoutMs: number): Promise<SnowplowReply>
  resolveInline(restAction: Record<string, unknown>, timeoutMs: number): Promise<SnowplowReply>
}

/** The contract was not kept (or not offered): the request was refused, or its reply cannot be trusted. */
export class ContractError extends Error {}

/** The value of a response header, or '' (node lower-cases names). */
export const headerOf = (headers: HttpResponse['headers'] | undefined, name: string): string => {
  const value = headers?.[name]
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

/** Whether every echo in `expected` is present with its value. */
export const echoed = (headers: HttpResponse['headers'] | undefined, expected: Record<string, string>): boolean =>
  Object.entries(expected).every(([name, value]) => headerOf(headers, name) === value)

/**
 * snowplow as `token`'s owner. `sandboxNamespace` is the only namespace a dry-run or an inline
 * resolve may name; it is fixed here, not by the caller of these methods.
 */
export const snowplowClient = (url: string, token: string, sandboxNamespace: string, transport: Transport = nodeTransport): SnowplowClient => {
  const base = url.replace(/\/$/, '')
  safeSegment(sandboxNamespace)
  const auth = { Authorization: `Bearer ${token}` }
  let offered: Set<string> | null = null
  let probe: Promise<Capabilities> | null = null
  const reply = (res: HttpResponse): SnowplowReply => ({ status: res.status, json: jsonOf(res.body), body: res.body, headers: res.headers })
  const query = (apiVersion: string, resource: string, namespace: string, name: string): string => {
    safeSegment(apiVersion, GROUP_VERSION)
    safeSegment(resource, PLURAL)
    safeSegment(namespace)
    safeSegment(name)
    return `apiVersion=${encodeURIComponent(apiVersion)}&resource=${resource}&namespace=${namespace}&name=${name}`
  }
  const nameOf = (object: Record<string, unknown>): string => {
    const name = (object.metadata as { name?: unknown } | undefined)?.name
    if (typeof name !== 'string') {
      throw new ContractError('the object has no metadata.name')
    }
    return name
  }
  const requireCapabilities = (...tokens: string[]): void => {
    const missing = tokens.filter((t) => !offered?.has(t))
    if (missing.length > 0) {
      throw new ContractError(`refusing to send: this snowplow has not advertised ${missing.join(', ')}`)
    }
  }
  const probeCapabilities = async (timeoutMs: number): Promise<Capabilities> => {
    try {
      const res = await transport({ method: 'GET', url: `${base}/capabilities`, headers: auth, timeoutMs })
      if (res.status === 404) {
        offered = new Set()
        return { ok: true, offered }
      }
      if (res.status !== 200) {
        return { ok: false, reason: `snowplow GET /capabilities answered ${res.status}` }
      }
      const list = (jsonOf(res.body) as { capabilities?: unknown } | null)?.capabilities
      offered = new Set(Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string') : [])
      return { ok: true, offered }
    } catch (error) {
      return { ok: false, reason: `snowplow could not be reached (${(error as Error).message})` }
    }
  }
  return {
    url: base,
    sandboxNamespace,
    capabilities(timeoutMs) {
      // Asked once per gate call (one client per call), whichever step asks first.
      probe ??= probeCapabilities(timeoutMs)
      return probe
    },
    async read(apiVersion, resource, namespace, name, timeoutMs) {
      // Raw: the stored object, NOT resolved — a resolving GET /call would run a RESTAction (and
      // could pull Secrets into snowplow's informers) just to learn that it exists.
      requireCapabilities(CAPABILITY_RAW_READ)
      const res = await transport({ method: 'GET', url: `${base}/call?${query(apiVersion, resource, namespace, name)}&raw=true`, headers: auth, timeoutMs })
      if ([200, 403, 404].includes(res.status) && !echoed(res.headers, { [ECHO_RAW]: 'true' })) {
        throw new ContractError(`snowplow answered ${res.status} to a raw read without ${ECHO_RAW}: true — it may have resolved the object instead`)
      }
      return reply(res)
    },
    async dryRunCreate(apiVersion, resource, object, timeoutMs) {
      // Only on /call/dry-run: a snowplow that does not serve it answers 404 and writes nothing.
      requireCapabilities(CAPABILITY_DRY_RUN, CAPABILITY_FIELD_VALIDATION)
      const url = `${base}/call/dry-run?${query(apiVersion, resource, sandboxNamespace, nameOf(object))}&${DRY_RUN_PARAMS}`
      const res = await transport({ method: 'POST', url, headers: auth, body: JSON.stringify(object), timeoutMs })
      if (res.status >= 200 && res.status < 300 && !echoed(res.headers, { [ECHO_DRY_RUN]: 'All', [ECHO_FIELD_VALIDATION]: 'Strict' })) {
        throw new ContractError(`snowplow answered ${res.status} to the dry run without ${ECHO_DRY_RUN}: All and ${ECHO_FIELD_VALIDATION}: Strict — the object may have been PERSISTED in ${sandboxNamespace}`)
      }
      return reply(res)
    },
    async resolveInline(restAction, timeoutMs) {
      requireCapabilities(CAPABILITY_RESOLVE)
      const url = `${base}/call/read?${query('templates.krateo.io/v1', 'restactions', sandboxNamespace, nameOf(restAction))}`
      // The draft resolves in the sandbox namespace: the design requires metadata to match the query.
      const object = { ...restAction, metadata: { ...(restAction.metadata as Record<string, unknown>), namespace: sandboxNamespace } }
      const res = await transport({ method: 'POST', url, headers: auth, body: JSON.stringify({ extras: {}, object }), timeoutMs })
      if (res.status >= 200 && res.status < 300 && !echoed(res.headers, { [ECHO_DRY_RUN]: 'All', [ECHO_RESOLVE_SOURCE]: 'request-body' })) {
        throw new ContractError(`snowplow answered ${res.status} to the inline resolve without ${ECHO_DRY_RUN}: All and ${ECHO_RESOLVE_SOURCE}: request-body — it resolved something other than this draft (an older snowplow resolves the STORED RESTAction)`)
      }
      return reply(res)
    },
  }
}

/** The bearer token on an MCP request's headers, or null. */
export const bearerOf = (headers: Record<string, string | string[] | undefined> | undefined): string | null => {
  const raw = headers?.authorization ?? headers?.Authorization
  const value = Array.isArray(raw) ? raw[0] : raw
  const match = typeof value === 'string' ? /^Bearer\s+(\S+)$/i.exec(value.trim()) : null
  return match ? match[1] : null
}
