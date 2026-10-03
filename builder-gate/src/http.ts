/**
 * The one HTTP primitive every outbound call goes through (API server, the caller-identity hop,
 * snowplow). node:http(s) rather than fetch because the API server and the hop present cluster
 * CAs, which fetch cannot be handed without a dispatcher package.
 *
 * It is a TRANSPORT, swappable in tests, so a test can record every request the gate makes and
 * assert that nothing but the dry-run ever leaves with a mutating verb.
 */
import http from 'node:http'
import https from 'node:https'

/**
 * The gate's OWN requests are GET, plus POST for the dry-run create and snowplow's /jq. The data
 * step also replays a draft RESTAction's own verb (as the caller, or with the endpoint's own
 * credentials) — that is the only way any other verb gets here (dryRunGuard.test.ts).
 */
export type Method = string

export interface HttpRequest {
  method: Method
  url: string
  headers?: Record<string, string>
  body?: string
  tls?: { ca?: string | Buffer; cert?: string | Buffer; key?: string | Buffer; rejectUnauthorized?: boolean }
  timeoutMs: number
  /** Cap on the response body; a larger body fails the request rather than exhausting memory. */
  maxBytes?: number
}

export interface HttpResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

export type Transport = (request: HttpRequest) => Promise<HttpResponse>

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024

export class HttpError extends Error {
  constructor(message: string, readonly code: 'timeout' | 'unreachable' | 'too-large') {
    super(message)
  }
}

export const nodeTransport: Transport = (request) => new Promise((resolve, reject) => {
  const url = new URL(request.url)
  const lib = url.protocol === 'https:' ? https : http
  const maxBytes = request.maxBytes ?? DEFAULT_MAX_BYTES
  // A header the request names itself (a RESTAction's own Content-Type) wins over the default.
  const named = new Set(Object.keys(request.headers ?? {}).map((k) => k.toLowerCase()))
  const req = lib.request(url, {
    method: request.method,
    headers: {
      ...(named.has('accept') ? {} : { Accept: 'application/json' }),
      ...(request.body !== undefined ? { 'Content-Length': Buffer.byteLength(request.body) } : {}),
      ...(request.body !== undefined && !named.has('content-type') ? { 'Content-Type': 'application/json' } : {}),
      ...request.headers,
    },
    ...(url.protocol === 'https:'
      ? { ca: request.tls?.ca, cert: request.tls?.cert, key: request.tls?.key, rejectUnauthorized: request.tls?.rejectUnauthorized ?? true }
      : {}),
  }, (res) => {
    const chunks: Buffer[] = []
    let size = 0
    res.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        req.destroy(new HttpError(`response larger than ${maxBytes} bytes`, 'too-large'))
        return
      }
      chunks.push(chunk)
    })
    res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    res.on('error', reject)
  })
  // A socket-level deadline: the whole request, not just the connect, has to finish in time.
  req.setTimeout(request.timeoutMs, () => req.destroy(new HttpError(`no answer within ${request.timeoutMs} ms`, 'timeout')))
  req.on('error', (error) => reject(error instanceof HttpError ? error : new HttpError(error.message, 'unreachable')))
  if (request.body !== undefined) {
    req.write(request.body)
  }
  req.end()
})

/** Parse a JSON body, or null when it is not JSON (an HTML error page, an empty 5xx). */
export const jsonOf = (body: string): unknown => {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}
