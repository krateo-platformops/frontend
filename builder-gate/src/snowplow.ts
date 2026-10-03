/**
 * Every judgement of a draft against the live cluster goes through snowplow, AS THE CALLER — the
 * person the agent works for, whose Krateo JWT kagent forwards on the MCP request
 * (KAGENT_PROPAGATE_TOKEN). The gate holds no RBAC for it and emulates nothing snowplow does.
 *
 * The contract is docs/snowplow-contract.md. ALL of it is ASSUMED (none of it is in snowplow
 * 1.12.33), and each call is only ever sent once snowplow ADVERTISES it:
 *   - `GET  /capabilities`                               what this snowplow offers (404 = nothing)
 *   - `GET  /call?…&raw=true`                            an existing widget or RESTAction, stored, not resolved
 *   - `POST /call?…&dryRun=All&fieldValidation=Strict`   the dry-run create
 *   - `POST /resolve?dryRun=All`                         an inline RESTAction resolved, persisting nothing
 *
 * WHY THE FEATURE CHECK IS LOAD-BEARING: today's snowplow ignores a `dryRun` query parameter on
 * POST /call — it would CREATE the object for real. So `dryRunCreate` refuses to send unless this
 * snowplow advertised `call.dryRun`, and a 2xx that does not carry the X-Krateo-Dry-Run: All
 * confirmation is reported as a contract violation, never as a pass.
 */
import { type HttpResponse, jsonOf, nodeTransport, type Transport } from './http'
import { safeSegment } from './kube'

export const CAPABILITY_RAW_READ = 'call.raw'
export const CAPABILITY_DRY_RUN = 'call.dryRun'
export const CAPABILITY_RESOLVE = 'resolve.inline'
/** The parameters every dry-run carries — a constant: no caller reaches this string. */
export const DRY_RUN_PARAMS = 'dryRun=All&fieldValidation=Strict'
/** The response header with which snowplow confirms it forwarded the dry run to the API server. */
export const DRY_RUN_CONFIRMATION = 'x-krateo-dry-run'

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

export class ContractError extends Error {}

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
      if (!offered?.has(CAPABILITY_RAW_READ)) {
        throw new ContractError(`refusing GET /call: this snowplow has not advertised ${CAPABILITY_RAW_READ}, and a resolving read would run the object`)
      }
      return reply(await transport({ method: 'GET', url: `${base}/call?${query(apiVersion, resource, namespace, name)}&raw=true`, headers: auth, timeoutMs }))
    },
    async dryRunCreate(apiVersion, resource, object, timeoutMs) {
      // Never on a snowplow that has not said it forwards dryRun: it would create for real.
      if (!offered?.has(CAPABILITY_DRY_RUN)) {
        throw new ContractError(`refusing to POST /call: this snowplow has not advertised ${CAPABILITY_DRY_RUN}`)
      }
      const url = `${base}/call?${query(apiVersion, resource, sandboxNamespace, nameOf(object))}&${DRY_RUN_PARAMS}`
      const res = await transport({ method: 'POST', url, headers: auth, body: JSON.stringify(object), timeoutMs })
      if (res.status >= 200 && res.status < 300 && String(res.headers[DRY_RUN_CONFIRMATION] ?? '') !== 'All') {
        throw new ContractError(`snowplow answered ${res.status} to the dry run without ${DRY_RUN_CONFIRMATION}: All — the object may have been PERSISTED in ${sandboxNamespace}`)
      }
      return reply(res)
    },
    async resolveInline(restAction, timeoutMs) {
      if (!offered?.has(CAPABILITY_RESOLVE)) {
        throw new ContractError(`refusing to POST /resolve: this snowplow has not advertised ${CAPABILITY_RESOLVE}`)
      }
      const body = JSON.stringify({ namespace: sandboxNamespace, restAction })
      const res = await transport({ method: 'POST', url: `${base}/resolve?dryRun=All`, headers: auth, body, timeoutMs })
      if (res.status >= 200 && res.status < 300 && String(res.headers[DRY_RUN_CONFIRMATION] ?? '') !== 'All') {
        throw new ContractError(`snowplow answered ${res.status} to the inline resolve without ${DRY_RUN_CONFIRMATION}: All — it may have persisted the RESTAction`)
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
