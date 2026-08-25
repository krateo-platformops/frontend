/**
 * Secret-redaction chokepoint (cross-cutting invariant #2 / #5).
 *
 * A single PURE function that runs LAST, just before the page-context envelope is
 * serialized and sent. It deep-scrubs the envelope so no credential can leave the
 * browser in the request body:
 *   - denylisted keys (token / authorization / bearer / password / secret /
 *     credential / apiKey / jwt / passwordRef / accessToken) become "[redacted]"
 *   - JWT-shaped strings ("eyJ....") anywhere become "[redacted-jwt]"
 *   - long base64 blobs (Secret "data.*" payloads) become "[redacted]"
 *
 * The collector already builds compact, payload-free summaries; this is the
 * defensive last line so a future collector change cannot silently leak. The
 * portal Bearer is used ONLY as the fetch header (never in the body) — this
 * guards the body.
 */

import type { PageContextEnvelope } from './types'

/** Case-insensitive key substrings that must never carry a real value. */
const DENYLIST_KEYS = [
  'token',
  'authorization',
  'bearer',
  'password',
  'passwordref',
  'secret',
  'credential',
  'apikey',
  'api_key',
  'jwt',
  'exportjwt',
]

const REDACTED = '[redacted]'
const REDACTED_JWT = '[redacted-jwt]'

/** Three base64url segments separated by dots — a JWT. */
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
/** A long contiguous base64 run (>= 60 chars) — typical Secret "data" payload. */
const LONG_BASE64_PATTERN = /[A-Za-z0-9+/]{60,}={0,2}/g

const isDenylistedKey = (key: string): boolean => {
  const lowered = key.toLowerCase()
  return DENYLIST_KEYS.some((needle) => lowered.includes(needle))
}

const redactString = (value: string): string =>
  value.replace(JWT_PATTERN, REDACTED_JWT).replace(LONG_BASE64_PATTERN, REDACTED)

/** Deep-clone + scrub. Objects/arrays recurse; denylisted keys are replaced wholesale. */
const deepRedact = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return redactString(value)
  }
  if (Array.isArray(value)) {
    return value.map((entry) => deepRedact(entry))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key] = isDenylistedKey(key) ? REDACTED : deepRedact(entry)
    }
    return out
  }
  return value
}

/**
 * Scrub a page-context envelope. Pure: returns a new, redacted envelope and never
 * mutates the input. This is the ONLY place the envelope is sanitized.
 */
export const redactAutopilotContext = (envelope: PageContextEnvelope): PageContextEnvelope =>
  deepRedact(envelope) as PageContextEnvelope

/**
 * Scrub an arbitrary value with the same rules as the context redactor: denylisted
 * keys → "[redacted]", JWT-shaped strings and long base64 blobs masked. Pure. Used by
 * the Evidence panel so a rendered tool-call ARGUMENT can never surface a token, a
 * Secret body or a credential — the metadata-only boundary covers args too, not just
 * results.
 */
export const redactValue = (value: unknown): unknown => deepRedact(value)
