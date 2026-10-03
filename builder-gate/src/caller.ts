/**
 * The data step's identity: THE CALLER — the person the agent is working for — never the gate.
 *
 * The caller's Krateo JWT reaches the gate on the MCP request's Authorization header: kagent sets
 * it on every tool call when the agent runs with KAGENT_PROPAGATE_TOKEN (the agents' A2A and MCP
 * legs ride it through agentgateway on 057). The gate forwards it to two places and nowhere else:
 *   - the cert-replay hop (agentgateway-policies), an API-server front that verifies the JWT and
 *     replays the person's own client certificate. It is the path kagent-tools reads through
 *     (TOKEN_PASSTHROUGH + the hop kubeconfig), so the gate reads exactly what that person may;
 *   - snowplow `POST /jq`, which evaluates a jq query with snowplow's engine and modules under
 *     the same JWT.
 * A draft RESTAction's own stages are replayed as it defines them (Diego, 2026-10-03: preview runs
 * them anyway): an in-cluster stage through the hop as the caller, whatever its verb, and an
 * external stage with the endpoint Secret's OWN credentials only (`external`). The caller's token
 * is never logged, never stored, and never sent to an external host.
 */
import { type HttpRequest, type HttpResponse, jsonOf, nodeTransport, type Transport } from './http'
import type { KubeIdentity } from './kube'

/** snowplow's /jq body cap (internal/handlers/jq.go MaxBodySize). */
export const SNOWPLOW_JQ_MAX_BODY = 1024 * 1024

export interface CallerReply {
  status: number
  json: unknown
  body: string
}

export interface CallerReplyWithType extends CallerReply {
  contentType: string
}

export interface CallerClient {
  /** GET an API-server path as the caller, through the hop. */
  get(path: string, timeoutMs: number): Promise<CallerReply>
  /**
   * A draft RESTAction's own in-cluster stage, as the caller, through the hop, with the verb,
   * headers and payload the RESTAction defines (preview runs it too).
   */
  replay(method: string, path: string, headers: Record<string, string>, payload: string | undefined, timeoutMs: number): Promise<CallerReplyWithType>
  /**
   * A draft RESTAction's external stage, sent EXACTLY as built from the endpoint Secret
   * (endpoint.ts externalRequest) — the caller's token is never added to it.
   */
  external(request: HttpRequest): Promise<CallerReplyWithType>
  /** snowplow POST /jq as the caller. */
  jq(query: string, data: unknown, timeoutMs: number): Promise<CallerReply>
}

export interface CallerConfig {
  /** The hop: server + CA (its kubeconfig's user is empty — the caller's token rides each call). */
  hop: KubeIdentity
  snowplowUrl: string
}

export const callerClient = (config: CallerConfig, token: string, transport: Transport = nodeTransport): CallerClient => {
  const auth = { Authorization: `Bearer ${token}` }
  const reply = (res: HttpResponse): CallerReplyWithType => ({
    status: res.status,
    json: jsonOf(res.body),
    body: res.body,
    contentType: String(res.headers['content-type'] ?? ''),
  })
  return {
    async get(path, timeoutMs) {
      return reply(await transport({ method: 'GET', url: `${config.hop.server}${path}`, headers: auth, tls: { ca: config.hop.ca }, timeoutMs }))
    },
    async replay(method, path, headers, payload, timeoutMs) {
      // The caller's token last, so a draft header can never replace whose identity this is.
      const named = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'authorization'))
      return reply(await transport({ method, url: `${config.hop.server}${path}`, headers: { ...named, ...auth }, body: payload, tls: { ca: config.hop.ca }, timeoutMs }))
    },
    async external(request) {
      return reply(await transport(request))
    },
    async jq(query, data, timeoutMs) {
      return reply(await transport({
        method: 'POST',
        url: `${config.snowplowUrl.replace(/\/$/, '')}/jq`,
        headers: auth,
        body: JSON.stringify({ query, data }),
        timeoutMs,
      }))
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
