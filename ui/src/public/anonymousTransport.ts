/**
 * The ANONYMOUS widget transport: what a page rendered outside the signed-in shell reads with.
 *
 * snowplow (snowplow#1334) serves a request carrying NO Authorization header as the identity
 * `krateo:public`, and its answer is the authority: 200 means the public identity may read that
 * widget, 401 means public serving is off on this install, 403 means it was not granted. A stale or
 * invalid token is a 401 and never falls back to public — so a public page must never send one,
 * not even the one sitting in storage from an earlier sign-in.
 *
 * THE GUARANTEE IS STRUCTURAL. This module imports nothing that can reach the stored token
 * (utils/getAccessToken, the session resume, the SSE client): a test walks its import graph and
 * fails the moment such an edge appears (anonymousTransport.graph.test.ts), and eslint refuses
 * those imports under src/public. On top of that it builds every request's headers itself, sends
 * `credentials: 'omit'` so no cookie rides along either, and throws on an Authorization header a
 * caller hands it — a caller that tries is a bug, and failing loudly is how it gets found.
 *
 * It has no `session`, so nothing that needs one — a snowplow write, an upload, a live stream, an
 * audit record — can run on it. Its only write is `post`: a plain same-origin JSON POST to a path
 * the install allowlisted, for a public form (it is not a /call write).
 */
import type { TransportInit, TransportFetch, WidgetTransport } from '../transport/widgetTransport'

/** Thrown, synchronously, when a caller hands the anonymous transport a credential. */
export class AnonymousCredentialError extends Error {
  constructor() {
    super('The anonymous transport never sends an Authorization header; a caller passed one.')
    this.name = 'AnonymousCredentialError'
  }
}

/** A `post` the allowlist refused. No request was sent. */
export class PublicPostRefused extends Error {
  constructor(reason: string) {
    super(`Refused a public POST: ${reason}`)
    this.name = 'PublicPostRefused'
  }
}

const hasAuthorization = (headers: Record<string, string> | undefined): boolean =>
  !!headers && Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')

/**
 * A read with no credential. The headers are copied, never shared, and `credentials: 'omit'` is
 * set last so a caller cannot turn cookies back on.
 */
export const anonymousFetch: TransportFetch = (url: string, init: TransportInit = {}) => {
  if (hasAuthorization(init.headers)) {
    throw new AnonymousCredentialError()
  }
  return fetch(url, { ...init, credentials: 'omit', headers: { ...init.headers } })
}

/**
 * The install's allowlist for public POSTs, from config `PUBLIC_POST_PATHS`.
 *
 * Accepted as a comma-separated string because that is what the installer's config plumbing can
 * emit (every passthrough config value is a string), and as an array for a hand-written
 * config.json. An entry that is not an absolute path (`/…`), or that is protocol-relative (`//…`),
 * is dropped: it could only ever widen the allowlist past this origin's paths.
 */
export const parsePublicPostPaths = (value: unknown): string[] => {
  let raw: unknown[] = []
  if (Array.isArray(value)) { raw = value }
  if (typeof value === 'string') { raw = value.split(',') }
  return raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('/') && !entry.startsWith('//'))
}

/**
 * Whether `pathname` sits under an allowlisted prefix. Segment-aware: `/request-access/api/v1/`
 * admits `/request-access/api/v1/requests`, and an entry written without the trailing slash,
 * `/request-access`, still does not admit `/request-access-evil`.
 */
const underPrefix = (pathname: string, prefix: string): boolean => {
  const base = prefix.endsWith('/') ? prefix : `${prefix}/`
  return pathname === prefix || pathname === base.slice(0, -1) || pathname.startsWith(base)
}

/** Any whitespace (Unicode `\s`) or a C0/DEL control character. */
const hasWhitespaceOrControl = (text: string): boolean =>
  /\s/u.test(text) || [...text].some((char) => { const code = char.charCodeAt(0); return code < 0x20 || code === 0x7f })

/**
 * Resolve `path` against this origin and check it, or say why not. Pure: sends nothing.
 *
 * The check runs on the URL the browser WOULD request, after it has resolved `..` and `%2e%2e`
 * segments, so `/request-access/api/v1/../../call` is judged as the `/call` it really is.
 */
export const checkPublicPost = (path: unknown, allowlist: readonly string[], origin: string): { ok: true; url: string } | { ok: false; reason: string } => {
  if (typeof path !== 'string' || path === '') { return { ok: false, reason: 'the path is empty' } }
  // Refused before parsing, because the URL parser REMOVES tabs and newlines anywhere in its input:
  // `/\t/evil.example/x` would be judged as the `//evil.example/x` it becomes, not as what was written.
  if (hasWhitespaceOrControl(path)) { return { ok: false, reason: 'the path contains whitespace or a control character' } }
  if (!path.startsWith('/')) { return { ok: false, reason: `"${path}" is not a same-origin absolute path` } }
  if (path.startsWith('//') || path.includes('\\')) { return { ok: false, reason: `"${path}" could leave this origin` } }
  let resolved: URL
  try {
    resolved = new URL(path, origin)
  } catch {
    return { ok: false, reason: `"${path}" is not a valid path` }
  }
  if (resolved.origin !== origin) { return { ok: false, reason: `"${path}" resolves to another origin` } }
  if (!allowlist.some((prefix) => underPrefix(resolved.pathname, prefix))) {
    return { ok: false, reason: `"${resolved.pathname}" is not on this installation's public POST allowlist` }
  }
  return { ok: true, url: `${resolved.pathname}${resolved.search}` }
}

export interface AnonymousTransportOptions {
  /** The parsed `PUBLIC_POST_PATHS`. Empty (the default): every `post` is refused. */
  postAllowlist?: readonly string[]
  /** A read answered 401: public serving is off on this install. */
  onUnauthorized?: (body: unknown) => void
}

export const createAnonymousTransport = ({ onUnauthorized, postAllowlist = [] }: AnonymousTransportOptions = {}): WidgetTransport => ({
  fetch: anonymousFetch,
  identity: 'anonymous',
  live: false,
  onUnauthorized: (body: unknown) => { onUnauthorized?.(body) },
  post: (path: string, json: unknown): Promise<Response> => {
    const origin = typeof window === 'undefined' ? '' : window.location.origin
    const verdict = checkPublicPost(path, postAllowlist, origin)
    if (!verdict.ok) {
      return Promise.reject(new PublicPostRefused(verdict.reason))
    }
    return fetch(verdict.url, {
      body: JSON.stringify(json),
      credentials: 'omit',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
    })
  },
  writes: false,
})
