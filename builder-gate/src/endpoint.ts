/**
 * A RESTAction stage's endpointRef, the way snowplow uses it — ported from snowplow 1.12.33
 * (internal/resolvers/restactions/api/endpoints.go, endpoints_cache.go) and plumbing v1.14.2
 * (endpoints, http/request: request.go, client.go, transport.go, util.go):
 *
 *   - the Secret's data keys: server-url (required), token, username, password,
 *     certificate-authority-data, client-certificate-data, client-key-data, insecure, proxy-url,
 *     aws-access-key, aws-secret-key, aws-region, aws-service;
 *   - the URL: server-url without its trailing "/", then "/", then the path without its leading
 *     "/" (request.go Do);
 *   - auth: at most ONE of bearer token, basic (password set), AWS SigV4 — more is an error
 *     (client.go); a client certificate is mTLS on top. As in plumbing's transport.go, the CA is
 *     applied only together with a client certificate, and `insecure` only without one;
 *   - a non-2xx answer is an error, and a 2xx answer that is not JSON is too (406).
 *
 * SECURITY, beyond snowplow (the gate runs untrusted drafts):
 *   - the host is the Secret's server-url, never the draft's: a path that is an absolute URL, or
 *     carries "//", "@", "\" or a control character, is refused before any request, and the
 *     joined URL must keep server-url's origin and path prefix;
 *   - every Secret value is registered for redaction: nothing the gate emits (problems, notes,
 *     samples) can carry one (`redact`);
 *   - the caller's bearer is never sent here: these requests carry only the endpoint's own
 *     credentials.
 */
import { createHash, createHmac } from 'node:crypto'

import type { HttpRequest } from './http'

export interface Endpoint {
  serverUrl: string
  token?: string
  username?: string
  password?: string
  /** base64 PEM, as stored */
  ca?: string
  cert?: string
  key?: string
  insecure: boolean
  proxyUrl?: string
  aws?: { accessKey: string; secretKey: string; region: string; service: string }
}

const CREDENTIAL_KEYS = ['token', 'username', 'password', 'client-certificate-data', 'client-key-data', 'aws-access-key', 'aws-secret-key']

const decode = (value: unknown): string | undefined =>
  (typeof value === 'string' ? Buffer.from(value, 'base64').toString('utf8') : undefined)

/** Go's strconv.ParseBool, errors read as false (snowplow ignores the parse error). */
const parseBool = (value: string | undefined): boolean => ['1', 't', 'T', 'TRUE', 'true', 'True'].includes(value ?? '')

/** The Endpoint a Secret (as the API server returns it: base64 `data`) describes, and every value to redact. */
export const endpointFromSecret = (secret: unknown): { endpoint?: Endpoint; problem?: string; secrets: string[] } => {
  const data = (secret && typeof secret === 'object' ? (secret as { data?: Record<string, unknown> }).data : undefined) ?? {}
  const values = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, decode(v)]))
  // The credentials, decoded and as stored (an echo of the raw Secret must not leak either). Not
  // server-url, insecure, debug, region or service: redacting "true" or a hostname would garble
  // the sample and protect nothing.
  const secrets = CREDENTIAL_KEYS.flatMap((k) => [values[k], data[k]])
    .filter((v): v is string => typeof v === 'string' && v.length >= 4)
  const serverUrl = values['server-url']
  if (!serverUrl) {
    return { problem: 'missed required attribute for endpoint: server-url', secrets }
  }
  const awsKeys = [values['aws-access-key'], values['aws-secret-key'], values['aws-region'], values['aws-service']]
  return {
    endpoint: {
      serverUrl,
      token: values.token || undefined,
      username: values.username || undefined,
      password: values.password || undefined,
      ca: values['certificate-authority-data'] || undefined,
      cert: values['client-certificate-data'] || undefined,
      key: values['client-key-data'] || undefined,
      insecure: parseBool(values.insecure),
      proxyUrl: values['proxy-url'] || undefined,
      aws: awsKeys.every(Boolean)
        ? { accessKey: awsKeys[0]!, secretKey: awsKeys[1]!, region: awsKeys[2]!, service: awsKeys[3]! }
        : undefined,
    },
    secrets,
  }
}

/**
 * server-url + path, with the host pinned to server-url. Throws, with a message that names only
 * the draft's path, when the path could steer the request anywhere else.
 */
export const externalUrl = (serverUrl: string, path: string): URL => {
  let base: URL
  try {
    base = new URL(serverUrl)
  } catch {
    throw new Error('the endpoint Secret\'s server-url is not a URL')
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new Error(`the endpoint Secret's server-url scheme ${base.protocol} is not http or https`)
  }
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.includes('//') || path.includes('@') || path.includes('\\') || /[\u0000-\u001f\u007f\s]/.test(path)) {
    throw new Error(`path ${JSON.stringify(path)} could change the endpoint's scheme or host — a path must be a plain path below server-url`)
  }
  const joined = new URL(path ? `${serverUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}` : serverUrl.replace(/\/$/, ''))
  const prefix = base.pathname.replace(/\/$/, '')
  if (joined.origin !== base.origin || !joined.pathname.startsWith(prefix)) {
    throw new Error(`path ${JSON.stringify(path)} leaves the endpoint's server-url`)
  }
  return joined
}

const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest()

/** plumbing's ComputeAwsSignature: SigV4 with the canonical URI the path, an empty query string. */
const awsHeaders = (aws: NonNullable<Endpoint['aws']>, url: URL, method: string, path: string, payload: string | undefined, headers: Record<string, string>): Record<string, string> => {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const dateStamp = now.slice(0, 8)
  const payloadHash = sha256(payload ?? '')
  const signed: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    signed[k.toLowerCase().trim()] = v.trim()
  }
  Object.assign(signed, { host: url.host || 'localhost', 'x-amz-content-sha256': payloadHash, 'x-amz-date': now })
  const keys = Object.keys(signed).sort()
  const canonical = [method, path || '/', '', keys.map((k) => `${k}:${signed[k]}\n`).join(''), keys.join(';'), payloadHash].join('\n')
  const scope = `${dateStamp}/${aws.region}/${aws.service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', now, scope, sha256(canonical)].join('\n')
  let key = hmac(`AWS4${aws.secretKey}`, dateStamp)
  for (const part of [aws.region, aws.service, 'aws4_request']) {
    key = hmac(key, part)
  }
  const signature = hmac(key, toSign).toString('hex')
  return {
    ...signed,
    Authorization: `AWS4-HMAC-SHA256 Credential=${aws.accessKey}/${scope},SignedHeaders=${keys.join(';')},Signature=${signature}`,
  }
}

/** RESTAction headers ("Key: value") as a record; malformed entries are skipped, as plumbing does. */
export const headersOf = (lines: readonly string[]): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const line of lines) {
    const at = line.indexOf(':')
    if (at > 0) {
      out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
    }
  }
  return out
}

/** The request snowplow would send to this endpoint. Throws on a refused path or an ambiguous auth. */
export const externalRequest = (endpoint: Endpoint, opts: { method: string; path: string; headers: Record<string, string>; payload?: string; timeoutMs: number }): HttpRequest => {
  if (endpoint.proxyUrl) {
    throw new Error('notChecked: the endpoint names a proxy-url, which the gate cannot dial through')
  }
  const url = externalUrl(endpoint.serverUrl, opts.path)
  const auths = [Boolean(endpoint.password), Boolean(endpoint.token), Boolean(endpoint.aws)].filter(Boolean).length
  if (auths > 1) {
    throw new Error('the endpoint Secret sets more than one of username/password, bearer token and AWS — only one must be set')
  }
  // The draft's own headers, then the endpoint's credentials over them (plumbing's round-trippers
  // set Authorization last). Nothing of the caller's is here: the gate never puts the caller's
  // token where a draft could reach it.
  let headers: Record<string, string> = { ...opts.headers }
  if (auths === 1) {
    headers = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'authorization'))
  }
  if (endpoint.token) {
    headers.Authorization = `Bearer ${endpoint.token}`
  } else if (endpoint.password) {
    headers.Authorization = `Basic ${Buffer.from(`${endpoint.username ?? ''}:${endpoint.password}`).toString('base64')}`
  } else if (endpoint.aws) {
    headers = awsHeaders(endpoint.aws, url, opts.method, opts.path, opts.payload, headers)
  }
  const hasCert = Boolean(endpoint.cert && endpoint.key)
  return {
    method: opts.method,
    url: url.toString(),
    headers,
    body: opts.payload,
    timeoutMs: opts.timeoutMs,
    tls: hasCert
      ? {
          cert: Buffer.from(endpoint.cert!, 'base64'),
          key: Buffer.from(endpoint.key!, 'base64'),
          ...(endpoint.ca ? { ca: Buffer.from(endpoint.ca, 'base64') } : {}),
        }
      : { rejectUnauthorized: !endpoint.insecure },
  }
}

/** Replace every registered secret value in a text the gate is about to emit. */
export const redact = (text: string, secrets: Iterable<string>): string => {
  let out = text
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= 4) {
      out = out.split(secret).join('[redacted]')
    }
  }
  return out
}
