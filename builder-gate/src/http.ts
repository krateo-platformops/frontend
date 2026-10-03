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

/** GET for reads; POST only for the dry-run create and snowplow's /jq. No other verb exists here. */
export type Method = 'GET' | 'POST'

export interface HttpRequest {
  method: Method
  url: string
  headers?: Record<string, string>
  body?: string
  tls?: { ca?: string | Buffer; cert?: string | Buffer; key?: string | Buffer }
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
  const req = lib.request(url, {
    method: request.method,
    headers: {
      Accept: 'application/json',
      ...(request.body !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(request.body) } : {}),
      ...request.headers,
    },
    ...(url.protocol === 'https:' ? { ca: request.tls?.ca, cert: request.tls?.cert, key: request.tls?.key } : {}),
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
