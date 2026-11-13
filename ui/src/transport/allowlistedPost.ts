/**
 * The ALLOW-LISTED POST: a plain same-origin JSON POST to a path the installation lists in config
 * `PUBLIC_POST_PATHS`, with no credential of any kind. It is not a snowplow /call write.
 *
 * Both widget transports carry it as `post`, the SAME function: a form that submits to an intake,
 * or checks a value against one, behaves alike on a public page and inside the signed-in shell.
 * Those endpoints are not snowplow's and authenticate by what the body carries (a link's token);
 * a bearer would hand a Krateo access token to a service that never needs it. So the request is
 * built here, from nothing the caller can widen: its own headers, `credentials: 'omit'`, and a
 * path checked against the allowlist after the browser's own resolution.
 *
 * This module imports nothing, so it can never reach the stored token (transport/tokenReach.test.ts).
 */

/** A `post` the allowlist refused. No request was sent. */
export class PublicPostRefused extends Error {
  constructor(reason: string) {
    super(`Refused a public POST: ${reason}`)
    this.name = 'PublicPostRefused'
  }
}

/** What a caller may pass besides the path and the body: only a way to cancel the request. */
export interface AllowlistedPostInit {
  signal?: AbortSignal
}

export type AllowlistedPost = (path: string, json: unknown, init?: AllowlistedPostInit) => Promise<Response>

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

/** The `post` both transports carry, bound to the install's allowlist (empty: every post is refused). */
export const createAllowlistedPost = (allowlist: readonly string[]): AllowlistedPost => (path, json, init = {}) => {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const verdict = checkPublicPost(path, allowlist, origin)
  if (!verdict.ok) {
    return Promise.reject(new PublicPostRefused(verdict.reason))
  }
  return fetch(verdict.url, {
    body: JSON.stringify(json),
    credentials: 'omit',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    method: 'POST',
    ...(init.signal ? { signal: init.signal } : {}),
  })
}
