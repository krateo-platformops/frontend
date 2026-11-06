/**
 * W4 KOG-BUILDER (FE-K2) — the OAS attachment seam.
 *
 * THE INVARIANT: a pasted OpenAPI document goes user → cluster VERBATIM, and is never
 * reproduced by the model. The rail holds the paste CLIENT-SIDE (an attachment in the
 * provider — deliberately NOT part of the page-context envelope, so collect() and the
 * redactor never see it and the collected context does not grow); the model's publish
 * proposal carries only the `{"$oasAttachment": true}` token as the ConfigMap data
 * value; the frontend substitutes the held bytes at publish-payload compile time —
 * BEFORE the blast-radius confirm, so the human confirms the REAL payload.
 *
 * Size cap: 512 KiB (spec §5). The JSON-escaped ConfigMap payload of a 512 KiB doc
 * stays under snowplow's verified 1 MiB `/call` request-body cap and the ~1 MiB etcd
 * object cap. Over the cap the paste is NOT held — the user is told to host the doc
 * and use the URL path (oasPath: https://…, no ConfigMap at all).
 *
 * Pure module: a tiny store factory + pure detection/substitution helpers. No React,
 * no network, no module-scoped state (the provider owns the store instance, so its
 * lifetime is the provider's — and newThread clears it).
 */

import type { ApplyResourceSetOp } from './applyResourceSet'

/** The substitution-token key. In an op payload the token is EXACTLY `{"$oasAttachment": true}`. */
export const OAS_ATTACHMENT_KEY = '$oasAttachment'

/** Hard client-side cap on a held document (spec §5): 512 KiB of UTF-8 bytes. */
export const OAS_ATTACHMENT_MAX_BYTES = 512 * 1024

/** A held document: the verbatim text + its UTF-8 byte size (what the cap measures). */
export interface OasAttachment {
  text: string
  bytes: number
}

export type OasAttachmentResult =
  | { ok: true; attachment: OasAttachment }
  | { ok: false; error: string }

/** UTF-8 byte length (the cap is about wire/etcd bytes, not JS string length). */
export const utf8ByteLength = (text: string): number => new TextEncoder().encode(text).length

/**
 * Cheap OpenAPI-document sniff for the rail's paste capture: a JSON or YAML document
 * whose ROOT declares `openapi` (3.x) or `swagger` (2.x). Deliberately conservative —
 * an ordinary chat message must never be captured as an attachment.
 */
export const looksLikeOpenApiDocument = (text: string): boolean => {
  const head = text.slice(0, 4096)
  // YAML form: a top-of-line `openapi:`/`swagger:` key (not indented — a root key).
  if (/^(openapi|swagger)\s*:/m.test(head)) {
    return true
  }
  // JSON form: `"openapi"` / `"swagger"` as a quoted key near the document start.
  return /^\s*\{/.test(head) && /"(openapi|swagger)"\s*:/.test(head)
}

/** Validate + hold a pasted document. Over the 512 KiB cap → not held, with the URL-path hint. */
export const createOasAttachment = (text: string): OasAttachmentResult => {
  if (!text.trim()) {
    return { error: 'the pasted document is empty', ok: false }
  }
  const bytes = utf8ByteLength(text)
  if (bytes > OAS_ATTACHMENT_MAX_BYTES) {
    const kib = Math.ceil(bytes / 1024)
    return {
      error: `the pasted OpenAPI document is ${kib} KiB — over the 512 KiB attachment cap. Host it and give its http(s) URL instead (oasPath uses the URL directly, no ConfigMap needed).`,
      ok: false,
    }
  }
  return { attachment: { bytes, text }, ok: true }
}

/** The tiny holder the provider owns. One attachment at a time (a new paste replaces it). */
export interface OasAttachmentStore {
  set: (text: string) => OasAttachmentResult
  get: () => OasAttachment | null
  clear: () => void
}

export const createOasAttachmentStore = (): OasAttachmentStore => {
  let held: OasAttachment | null = null
  return {
    clear: () => {
      held = null
    },
    get: () => held,
    set: (text: string) => {
      const result = createOasAttachment(text)
      if (result.ok) {
        held = result.attachment
      }
      return result
    },
  }
}

/** True iff `value` is EXACTLY the substitution token: `{"$oasAttachment": true}`, no extra keys. */
const isOasToken = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return record[OAS_ATTACHMENT_KEY] === true && Object.keys(record).length === 1
}

/** Deep-walk a payload, replacing every exact token with the held text. Counts replacements. */
const substituteInValue = (value: unknown, text: string, counter: { count: number }): unknown => {
  if (isOasToken(value)) {
    counter.count += 1
    return text
  }
  if (Array.isArray(value)) {
    return value.map((entry) => substituteInValue(entry, text, counter))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key] = substituteInValue(entry, text, counter)
    }
    return out
  }
  return value
}

/** True iff any op payload carries the substitution token (a KOG paste-path publish). */
export const opsCarryOasToken = (ops: readonly ApplyResourceSetOp[]): boolean => {
  const probe = { count: 0 }
  for (const op of ops) {
    substituteInValue(op.payload, '', probe)
    if (probe.count > 0) {
      return true
    }
  }
  return false
}

export type OasSubstitutionResult =
  | { ok: true; ops: ApplyResourceSetOp[]; substituted: number }
  | { ok: false; error: string }

/**
 * PUBLISH-PAYLOAD COMPILE STEP: substitute every `{"$oasAttachment": true}` token in
 * the proposal's op payloads with the held verbatim document. Pure — returns NEW ops,
 * never mutates the proposal. Runs BEFORE dispatch (so before the blast-radius
 * confirm): the human confirms the real ConfigMap content, and the model never has to
 * (and never can) reproduce the document bytes.
 *
 * Token present + NOTHING held → an explicit error (the publish is refused): the
 * agent proposed a paste-path publish but the portal holds no document — publishing
 * would create a ConfigMap whose data is a meaningless token object.
 */
export const substituteOasAttachment = (
  ops: readonly ApplyResourceSetOp[],
  attachment: OasAttachment | null,
): OasSubstitutionResult => {
  if (!opsCarryOasToken(ops)) {
    return { ok: true, ops: [...ops], substituted: 0 }
  }
  if (!attachment) {
    return {
      error: 'no OpenAPI document is attached — paste the document in the rail first (it is held client-side and substituted at publish), or use its http(s) URL as the oasPath.',
      ok: false,
    }
  }
  const counter = { count: 0 }
  const substitutedOps = ops.map((op) => (
    op.payload === undefined ? { ...op } : { ...op, payload: substituteInValue(op.payload, attachment.text, counter) }
  ))
  return { ok: true, ops: substitutedOps, substituted: counter.count }
}
