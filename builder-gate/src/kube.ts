/**
 * The gate's own API-server identity — its ServiceAccount in-cluster, or a kubeconfig off-cluster
 * — used for ONE thing: reading the Builder CR it validates for (the chart grants only `get` on
 * those Builders, by name). Every judgement of a draft against the cluster goes through snowplow
 * AS THE CALLER (snowplow.ts); the gate holds no other RBAC and sends nothing but GETs here.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import yaml from 'js-yaml'

import { type HttpResponse, jsonOf, nodeTransport, type Transport } from './http'

export const PER_REQUEST_TIMEOUT_MS = 20_000

const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount'

export interface KubeIdentity {
  server: string
  ca?: Buffer
  /** Re-read per request: a projected SA token rotates under a long-lived pod. */
  token?: () => string
  cert?: Buffer
  key?: Buffer
  /** Where the identity came from, for the envelope's notes. */
  source: string
}

export interface KubeReply {
  status: number
  json: unknown
  body: string
  warnings: string[]
}

const DNS1123_SUBDOMAIN = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/

/** A path segment the gate puts in a URL. Anything else is refused before a request is built. */
export const safeSegment = (value: string, pattern: RegExp = DNS1123_SUBDOMAIN): string => {
  if (!pattern.test(value) || value.length > 253) {
    throw new Error(`refusing an unsafe path segment: ${JSON.stringify(value)}`)
  }
  return value
}

export class KubeClient {
  constructor(
    readonly identity: KubeIdentity,
    private readonly transport: Transport = nodeTransport,
  ) {}

  private headers(): Record<string, string> {
    const token = this.identity.token?.()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  /** A read. GET, always: the gate's identity has nothing else to send. */
  async get(path: string, timeoutMs = PER_REQUEST_TIMEOUT_MS): Promise<KubeReply> {
    const res: HttpResponse = await this.transport({
      method: 'GET',
      url: `${this.identity.server}${path}`,
      headers: this.headers(),
      tls: { ca: this.identity.ca, cert: this.identity.cert, key: this.identity.key },
      timeoutMs,
    })
    const warning = res.headers.warning
    const warnings = (Array.isArray(warning) ? warning : warning ? [warning] : [])
    return { status: res.status, json: jsonOf(res.body), body: res.body, warnings }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Identity loading
// ────────────────────────────────────────────────────────────────────────────

/** In-cluster: the pod's own ServiceAccount, as client-go's rest.InClusterConfig reads it. */
export const inClusterIdentity = (): KubeIdentity | null => {
  const host = process.env.KUBERNETES_SERVICE_HOST
  const port = process.env.KUBERNETES_SERVICE_PORT
  if (!host || !port || !existsSync(`${SA_DIR}/token`)) {
    return null
  }
  return {
    server: `https://${host.includes(':') ? `[${host}]` : host}:${port}`,
    ca: readFileSync(`${SA_DIR}/ca.crt`),
    token: () => readFileSync(`${SA_DIR}/token`, 'utf8').trim(),
    source: 'in-cluster ServiceAccount',
  }
}

type Rec = Record<string, unknown>
const rec = (value: unknown): Rec => (value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : {})
const entryOf = (list: unknown, name: string, field: string): Rec =>
  rec(rec((Array.isArray(list) ? list : []).find((entry) => rec(entry).name === name))[field])

const b64 = (value: unknown): Buffer | undefined => (typeof value === 'string' ? Buffer.from(value, 'base64') : undefined)
const file = (value: unknown): Buffer | undefined => (typeof value === 'string' ? readFileSync(value) : undefined)

/**
 * A kubeconfig identity: server + CA from the context's cluster; token, token file, client
 * certificate or an exec credential plugin (GKE's gke-gcloud-auth-plugin) from its user.
 */
export const kubeconfigIdentity = (path: string, context?: string): KubeIdentity => {
  const config = rec(yaml.load(readFileSync(path, 'utf8')))
  const contextName = context ?? (typeof config['current-context'] === 'string' ? config['current-context'] : '')
  const ctx = entryOf(config.contexts, contextName, 'context')
  const cluster = entryOf(config.clusters, String(ctx.cluster ?? ''), 'cluster')
  if (typeof cluster.server !== 'string') {
    throw new Error(`kubeconfig ${path}: context ${JSON.stringify(contextName)} has no cluster server`)
  }
  const identity: KubeIdentity = {
    server: cluster.server.replace(/\/$/, ''),
    ca: b64(cluster['certificate-authority-data']) ?? file(cluster['certificate-authority']),
    source: `kubeconfig context ${contextName}`,
  }
  const user = entryOf(config.users, String(ctx.user ?? ''), 'user')
  if (typeof user.token === 'string') {
    const token = user.token
    identity.token = () => token
  } else if (typeof user.tokenFile === 'string') {
    const tokenFile = user.tokenFile
    identity.token = () => readFileSync(tokenFile, 'utf8').trim()
  } else if (user.exec) {
    identity.token = execCredential(rec(user.exec))
  }
  identity.cert = b64(user['client-certificate-data']) ?? file(user['client-certificate'])
  identity.key = b64(user['client-key-data']) ?? file(user['client-key'])
  return identity
}

/** client-go's exec credential plugin, cached until its expiry. */
const execCredential = (exec: Rec): (() => string) => {
  let cached: { token: string; until: number } | null = null
  return () => {
    if (cached && cached.until > Date.now() + 60_000) {
      return cached.token
    }
    const env = { ...process.env }
    for (const entry of Array.isArray(exec.env) ? exec.env : []) {
      env[String(rec(entry).name)] = String(rec(entry).value)
    }
    const run = spawnSync(String(exec.command), (Array.isArray(exec.args) ? exec.args : []).map(String), { env, encoding: 'utf8', timeout: 30_000 })
    const status = rec(rec(jsonOf(run.stdout ?? '')).status)
    if (run.status !== 0 || typeof status.token !== 'string') {
      throw new Error(`kubeconfig exec credential ${String(exec.command)} failed: ${(run.stderr ?? '').slice(0, 300)}`)
    }
    const until = typeof status.expirationTimestamp === 'string' ? Date.parse(status.expirationTimestamp) : Date.now() + 5 * 60_000
    cached = { token: status.token, until }
    return status.token
  }
}
