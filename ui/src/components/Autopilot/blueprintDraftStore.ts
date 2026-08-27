/**
 * W4 BLUEPRINT-BUILDER (FE-BP1) — the authored-chart held-draft seam.
 *
 * THE INVARIANT (the blueprint analogue of the OAS attachment, see oasAttachment.ts):
 * the chart tree the user drafted + PREVIEWED goes to the git write VERBATIM, and is
 * never reproduced by the model at publish time. `previewBlueprint` already parses the
 * inline draft (blueprintDraft.parseRawTemplates) and helm-renders it; this store HOLDS
 * that exact `{path: content}` tree CLIENT-SIDE (owned by the provider — deliberately
 * NOT part of the page-context envelope, so collect() and the redactor never see it and
 * the collected context does not grow). The model's publish proposal then carries only
 * a `{"$fileContent": "<path>"}` token per RepoContent value; the frontend substitutes
 * the held bytes for that path at publish-payload compile time — BEFORE the blast-radius
 * confirm, so the human confirms the REAL file bytes and published bytes == previewed
 * bytes.
 *
 * Difference from oasAttachment: OAS holds ONE document (token `{"$oasAttachment": true}`);
 * a chart is MANY files, so the token names WHICH file (`{"$fileContent": "<path>"}`) and
 * the store is a path→text MAP. The 512 KiB cap is on the TOTAL tree (same rationale: the
 * JSON-escaped payload stays under snowplow's ~1 MiB `/call` body cap and etcd's object
 * cap — though a real chart is chunked across sets, see FE-BP5).
 *
 * Pure module: a tiny store factory + pure detection/substitution helpers. No React, no
 * network, no module-scoped state (the provider owns the store instance; newThread clears
 * it, exactly like the OAS store).
 */

import type { ApplyResourceSetOp } from './applyResourceSet'
import { OAS_ATTACHMENT_MAX_BYTES, utf8ByteLength } from './oasAttachment'

/** The substitution-token key. In an op payload the token is EXACTLY `{"$fileContent": "<path>"}`. */
export const FILE_CONTENT_KEY = '$fileContent'

/** Hard client-side cap on the held tree: 512 KiB of UTF-8 bytes across ALL files (spec §5). */
export const BLUEPRINT_DRAFT_MAX_BYTES = OAS_ATTACHMENT_MAX_BYTES

/** How a substituted file's bytes are encoded into the op payload value. */
export type FileContentEncoding = 'text' | 'base64'

/** A held chart tree: the verbatim `{path: content}` map + its total UTF-8 byte size. */
export interface BlueprintDraftHeld {
  files: Record<string, string>
  bytes: number
}

export type BlueprintDraftResult =
  | { ok: true; held: BlueprintDraftHeld }
  | { ok: false; error: string }

/**
 * The outcome of a single-file in-place edit (FE-K(edit) page/blueprint half). A success
 * carries the re-measured total byte size of the held tree; a failure carries the reason
 * and — the invariant — leaves the held tree UNMUTATED (deny-by-default on the held bytes).
 */
export interface FileUpdateResult {
  ok: boolean
  bytes: number
  error?: string
}

/**
 * Validate + measure a parsed chart tree (the map `parseRawTemplates` already produced).
 * Over the 512 KiB TOTAL cap → not held, with a size hint. An empty map is refused (there
 * is nothing to publish).
 */
export const createBlueprintDraft = (files: Record<string, string>): BlueprintDraftResult => {
  const paths = Object.keys(files)
  if (paths.length === 0) {
    return { error: 'the blueprint draft is empty — draft the chart tree in the rail and preview it first', ok: false }
  }
  let bytes = 0
  for (const path of paths) {
    bytes += utf8ByteLength(files[path])
  }
  if (bytes > BLUEPRINT_DRAFT_MAX_BYTES) {
    const kib = Math.ceil(bytes / 1024)
    return {
      error: `the blueprint draft is ${kib} KiB across ${paths.length} files — over the 512 KiB draft cap. Trim the chart (large assets belong in a hosted values file, not the templates tree).`,
      ok: false,
    }
  }
  return { held: { bytes, files: { ...files } }, ok: true }
}

/** Total UTF-8 byte size of a `{path: content}` tree (the held-tree cap is measured on this). */
const measureTreeBytes = (files: Record<string, string>): number =>
  Object.values(files).reduce((sum, text) => sum + utf8ByteLength(text), 0)

/** The tiny holder the provider owns. One chart tree at a time (a new preview replaces it). */
export interface BlueprintDraftStore {
  set: (files: Record<string, string>) => BlueprintDraftResult
  get: () => BlueprintDraftHeld | null
  clear: () => void
  /**
   * FE-K(edit), page/blueprint half — replace the bytes of ONE already-held file in place
   * (a human edit on the held tree; the model never reproduces these bytes). Rejects — and
   * leaves the held tree UNMUTATED — when the path is not a held file or the edit pushes the
   * TOTAL tree over the 512 KiB cap. Returns the re-measured total byte size on success.
   */
  updateFile: (path: string, content: string) => FileUpdateResult
}

export const createBlueprintDraftStore = (): BlueprintDraftStore => {
  let held: BlueprintDraftHeld | null = null
  return {
    clear: () => {
      held = null
    },
    get: () => held,
    set: (files: Record<string, string>) => {
      const result = createBlueprintDraft(files)
      if (result.ok) {
        held = result.held
      }
      return result
    },
    updateFile: (path, content) => {
      if (!held) {
        return { bytes: 0, error: 'no draft is held — preview a page or blueprint first', ok: false }
      }
      if (!(path in held.files)) {
        return { bytes: held.bytes, error: `"${path}" is not a held file — only previewed files can be edited`, ok: false }
      }
      const nextFiles = { ...held.files, [path]: content }
      const bytes = measureTreeBytes(nextFiles)
      if (bytes > BLUEPRINT_DRAFT_MAX_BYTES) {
        const kib = Math.ceil(bytes / 1024)
        // Over-cap: the held tree is left EXACTLY as it was (the previously-held bytes stand).
        return { bytes: held.bytes, error: `the edit brings the draft to ${kib} KiB — over the 512 KiB cap; trim the file`, ok: false }
      }
      held = { bytes, files: nextFiles }
      return { bytes, ok: true }
    },
  }
}

/**
 * The path a value references iff it is EXACTLY the token `{"$fileContent": "<path>"}`
 * — one key, a non-empty string path, no extra keys. Otherwise null.
 */
export const fileContentTokenPath = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1) {
    return null
  }
  const path = record[FILE_CONTENT_KEY]
  return typeof path === 'string' && path.length > 0 ? path : null
}

/** True iff any op payload carries a `{"$fileContent": …}` token (a blueprint git publish). */
export const opsCarryFileContentToken = (ops: readonly ApplyResourceSetOp[]): boolean => {
  const walk = (value: unknown): boolean => {
    if (fileContentTokenPath(value) !== null) {
      return true
    }
    if (Array.isArray(value)) {
      return value.some(walk)
    }
    if (value && typeof value === 'object') {
      return Object.values(value).some(walk)
    }
    return false
  }
  return ops.some((op) => walk(op.payload))
}

/** UTF-8-safe base64 of a string (chunked so a large file never overflows the call stack). */
export const encodeUtf8Base64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export type BlueprintSubstitutionResult =
  | { ok: true; ops: ApplyResourceSetOp[]; substituted: number }
  | { ok: false; error: string }

/**
 * PUBLISH-PAYLOAD COMPILE STEP: substitute every `{"$fileContent": "<path>"}` token in
 * the proposal's op payloads with the held verbatim file bytes for that path. Pure —
 * returns NEW ops, never mutates the proposal. Runs BEFORE dispatch (so before the
 * blast-radius confirm): the human confirms the real file content, and the model never
 * has to (and never can) reproduce the chart bytes.
 *
 * `encoding` selects how the held text lands in the payload value: `'text'` (verbatim,
 * the default — mirrors the OAS seam) or `'base64'` (for a RepoContent-style `content`
 * field). The final choice is FE-BP5's, once the git-provider CR shape is verified.
 *
 * Refusals (the publish is refused, not silently mis-published):
 *   - a token present but NOTHING held → the agent proposed a publish with no previewed
 *     draft (would write meaningless token objects);
 *   - a token names a path NOT in the held draft → the model referenced a file the user
 *     never drafted/previewed (drift — never fabricate its bytes).
 */
export const substituteFileContent = (
  ops: readonly ApplyResourceSetOp[],
  held: BlueprintDraftHeld | null,
  encoding: FileContentEncoding = 'text',
): BlueprintSubstitutionResult => {
  if (!opsCarryFileContentToken(ops)) {
    return { ok: true, ops: [...ops], substituted: 0 }
  }
  if (!held) {
    return {
      error: 'no blueprint draft is held — draft the chart in the rail and PREVIEW it first (the previewed tree is held client-side and substituted at publish).',
      ok: false,
    }
  }
  const miss: { path: string | null } = { path: null }
  const counter = { count: 0 }
  const encode = (text: string): string => (encoding === 'base64' ? encodeUtf8Base64(text) : text)
  const substituteInValue = (value: unknown): unknown => {
    const path = fileContentTokenPath(value)
    if (path !== null) {
      if (!(path in held.files)) {
        miss.path = miss.path ?? path
        return value
      }
      counter.count += 1
      return encode(held.files[path])
    }
    if (Array.isArray(value)) {
      return value.map(substituteInValue)
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value)) {
        out[key] = substituteInValue(entry)
      }
      return out
    }
    return value
  }
  const substitutedOps = ops.map((op) => (
    op.payload === undefined ? { ...op } : { ...op, payload: substituteInValue(op.payload) }
  ))
  if (miss.path !== null) {
    return {
      error: `the publish references a file the draft does not contain: "${miss.path}". Preview the full chart tree first — only previewed files can be published.`,
      ok: false,
    }
  }
  return { ok: true, ops: substitutedOps, substituted: counter.count }
}
