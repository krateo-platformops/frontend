/**
 * W4 BLUEPRINT-BUILDER (FE-BP1) — the authored-chart held-draft seam.
 *
 * THE INVARIANT (the blueprint analogue of the OAS attachment, see oasAttachment.ts):
 * the chart tree the user drafted + PREVIEWED goes to the git write VERBATIM, and is
 * never reproduced by the model at publish time. `previewBlueprint` already parses the
 * inline draft (blueprintDraft.parseRawTemplates) and helm-renders it; this store HOLDS
 * that exact `{path: content}` tree CLIENT-SIDE (owned by the provider — deliberately
 * NOT part of the page-context envelope, so collect() and the redactor never see it and
 * the collected context does not grow). The model's publish proposal carries only a scalar
 * verb; the host builds ONE BuilderPublish claim from the held files (heldPublishFiles) — BEFORE
 * the blast-radius confirm, so the human confirms the REAL file bytes and published bytes ==
 * previewed bytes.
 *
 * The 512 KiB cap is on the TOTAL tree: the claim carries every file inline in one object, so
 * the JSON-escaped payload must stay under snowplow's ~1 MiB `/call` body cap and etcd's object
 * cap. It is the only bound on a publish — there is no file-count limit.
 *
 * `{"$fileContent": "<path>"}` was the token the legacy GitHub path substituted into RepoContent
 * payloads. That path is gone (2026-09-25); the token is still RECOGNISED, so a model that emits
 * it is refused rather than having the literal token written into an object.
 *
 * Pure module: a tiny store factory + pure detection helpers. No React, no
 * network, no module-scoped state (the provider owns the store instance; newThread clears
 * it, exactly like the OAS store).
 */

import type { ApplyResourceSetOp } from './applyResourceSet'
import { regenerateArchitecture } from './blueprintDraft'
import { OAS_ATTACHMENT_MAX_BYTES, utf8ByteLength } from './oasAttachment'
import { heldKeyForDisplayedPath } from './pageDraft'

/** The substitution-token key. In an op payload the token is EXACTLY `{"$fileContent": "<path>"}`. */
export const FILE_CONTENT_KEY = '$fileContent'

/** Hard client-side cap on the held tree: 512 KiB of UTF-8 bytes across ALL files (spec §5). */
export const BLUEPRINT_DRAFT_MAX_BYTES = OAS_ATTACHMENT_MAX_BYTES

/**
 * WHICH BUILDER AUTHORED THE HELD DRAFT.
 *
 * Carried explicitly because the alternative was a shape sniff — `isPageDraft` was literally
 * `!('Chart.yaml' in files)`, resting on the observation that blueprint drafts always have one and
 * page drafts never do. That held exactly as long as a page was a bag of widget CRs. The moment a
 * page becomes a chart of its own, the sniff INVERTS: every caller silently reclassifies the page
 * as a blueprint, identity flips to the chart name, the page slug goes null, and the publish builds
 * blueprint ops under the wrong builder — none of it erroring, all of it wrong.
 *
 * A fact the writer knows should be recorded, not re-derived downstream from a coincidence.
 */
export type DraftKind = 'page' | 'blueprint'

/** A held chart tree: the verbatim `{path: content}` map, its total UTF-8 byte size, and who wrote it. */
/**
 * A held draft → the `{path, content}` list a BuilderPublish claim commits.
 *
 * ONE mapping for BOTH builders, which is the whole point of holding chart-relative keys: a page set
 * is its own chart now, so its keys carry their own location exactly as a blueprint's always did,
 * and neither branch has to re-derive a destination. The page branch that used to sit beside this
 * one is what let the legacy git-write path, the claim and the preview drawer drift apart.
 */
export const heldPublishFiles = (files: Record<string, string>): { content: string; path: string }[] =>
  Object.entries(files).map(([path, content]) => ({ content, path }))

export interface BlueprintDraftHeld {
  files: Record<string, string>
  bytes: number
  kind: DraftKind
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
  /**
   * On a written edit, the bytes now held for the file — not always the ones sent: a chart's
   * architecture file is held with its graph block regenerated (see `settle`).
   */
  content?: string
  /** The one path a refusal is about, when it is about one (applyFiles). */
  path?: string
}

/** Several files as ONE change — see `applyFiles`. A path belongs to at most one list. */
export interface FilesChange {
  add?: Record<string, string>
  edit?: Record<string, string>
  remove?: string[]
}

/**
 * A tree as the store holds it. A CHART's architecture file is regenerated on every write
 * (blueprintDraft's regenerateArchitecture): every way a held chart changes comes through here — an
 * edit in Chart files, a file the composer adds, a removal, an Undo, a Start, an agent's rendered
 * proposal — so none of them can leave the `krateo:graph` block behind its descriptor. It stays one
 * ordinary write: the gate is disarmed and a render arms it, as for any other. A page set has no
 * architecture file, and is held as given.
 */
const settle = (files: Record<string, string>, kind: DraftKind): Record<string, string> =>
  (kind === 'blueprint' ? regenerateArchitecture(files) : files)

/**
 * Validate + measure a parsed chart tree (the map `parseRawTemplates` already produced).
 * Over the 512 KiB TOTAL cap → not held, with a size hint. An empty map is refused (there
 * is nothing to publish).
 */
export const createBlueprintDraft = (given: Record<string, string>, kind: DraftKind): BlueprintDraftResult => {
  const files = settle(given, kind)
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
  return { held: { bytes, files: { ...files }, kind }, ok: true }
}

/** Total UTF-8 byte size of a `{path: content}` tree (the held-tree cap is measured on this). */
const measureTreeBytes = (files: Record<string, string>): number =>
  Object.values(files).reduce((sum, text) => sum + utf8ByteLength(text), 0)

/** The tiny holder the provider owns. One chart tree at a time (a new preview replaces it). */
/**
 * Notified after every mutation that CHANGED the held tree, with the tree as it now is (null once
 * cleared). The store stays a plain data holder — the one subscriber is the provider, which turns
 * this into the window broadcast that surfaces outside the provider tree listen on. Keeping the
 * dispatch out here is what lets the store be tested without a DOM.
 */
export type DraftChangeListener = (held: BlueprintDraftHeld | null) => void

export interface BlueprintDraftStore {
  set: (files: Record<string, string>, kind: DraftKind) => BlueprintDraftResult
  get: () => BlueprintDraftHeld | null
  clear: () => void
  /**
   * FE-K(edit), page/blueprint half — replace the bytes of ONE already-held file in place
   * (a human edit on the held tree; the model never reproduces these bytes). Rejects — and
   * leaves the held tree UNMUTATED — when the path is not a held file or the edit pushes the
   * TOTAL tree over the 512 KiB cap. Returns the re-measured total byte size on success.
   */
  updateFile: (path: string, content: string) => FileUpdateResult
  /**
   * `updateFile` for bytes coming back from the preview drawer, which shows a file at its REPO
   * DESTINATION rather than under the key the draft holds it by. Resolving here rather than in the
   * caller is what keeps a page edit from being refused silently: `updateFile` matches on the held
   * key, and for a page that key is a bare identity token, never the routed path the user saw.
   */
  updateDisplayedFile: (displayedPath: string, content: string) => FileUpdateResult
  /**
   * ADD a file the draft does not hold yet.
   *
   * Deliberately separate from `updateFile` rather than relaxing it. `updateFile` refuses an
   * unknown path — "only previewed files can be edited" — and that refusal is load-bearing: it is
   * what stops an edit inventing a path the preview never validated and smuggling it into the
   * publish set. Making it upsert would delete that guarantee for every existing caller in order to
   * serve one new one.
   *
   * So this is the explicit, narrow counterpart: the composer creating a container or a widget it
   * has just authored. It refuses a path that ALREADY exists (that is an edit, and `updateFile` is
   * where edits belong, with its own checks) and it applies the same 512 KiB cap, leaving the held
   * tree untouched when it would be exceeded.
   */
  addFile: (path: string, content: string) => FileUpdateResult
  /**
   * DROP a file the draft holds.
   *
   * The counterpart `addFile` needed and did not have. Without it "remove" in the object tree could
   * only delete the parent's REFERENCE, leaving the child's file held — which `buildObjectTree` then
   * drew as a second page root with no controls on it, and which `pagePublish` shipped anyway.
   *
   * Refuses an unknown path rather than succeeding vacuously: "removed" and "was never there" are
   * different answers, and a caller that mis-addresses a file should hear about it instead of
   * believing the draft changed.
   */
  removeFile: (path: string) => FileUpdateResult
  /**
   * ADD, EDIT and REMOVE several files as ONE change — the composer's gestures (a placed node is its
   * template AND a rewritten descriptor). All or nothing: every precondition `addFile`, `updateFile`
   * and `removeFile` would check is checked FIRST, for every path, plus two of its own — a path may
   * appear in only one list, and an empty change is refused. The 512 KiB cap is measured once, over
   * the result. A refusal leaves the held tree exactly as it was; an acceptance announces once.
   */
  applyFiles: (change: FilesChange) => FileUpdateResult
}

/** Own keys only: a file named `constructor` is not held because every object has one. */
const holds = (files: Record<string, string>, path: string): boolean => Object.prototype.hasOwnProperty.call(files, path)

/**
 * Why a change cannot be applied to `files`, or null when it can. Pure, and checked in full before
 * anything is written — that is what makes applyFiles all-or-nothing.
 */
const changeRefusal = (files: Record<string, string>, change: FilesChange): { error: string; path?: string } | null => {
  const adds = Object.keys(change.add ?? {})
  const edits = Object.keys(change.edit ?? {})
  const removes = change.remove ?? []
  if (!adds.length && !edits.length && !removes.length) {
    return { error: 'the change is empty — there is nothing to write' }
  }
  const seen = new Set<string>()
  for (const path of [...adds, ...edits, ...removes]) {
    if (seen.has(path)) {
      return { error: `"${path}" appears more than once in one change — add, edit or remove it, once`, path }
    }
    seen.add(path)
  }
  for (const path of adds) {
    if (!path) {
      return { error: 'a new file needs a path' }
    }
    if (holds(files, path)) {
      return { error: `"${path}" is already in the draft — edit it instead`, path }
    }
  }
  for (const path of edits) {
    if (!holds(files, path)) {
      return { error: `"${path}" is not a held file — only previewed files can be edited`, path }
    }
  }
  for (const path of removes) {
    if (!holds(files, path)) {
      return { error: `"${path}" is not in the draft`, path }
    }
  }
  return null
}

/** The tree after a change the caller has already found acceptable. `fromEntries` DEFINES each key. */
const changedTree = (files: Record<string, string>, change: FilesChange): Record<string, string> => {
  const dropped = new Set(change.remove ?? [])
  return Object.fromEntries([
    ...Object.entries(files).filter(([path]) => !dropped.has(path)).map(([path, content]) =>
      [path, holds(change.edit ?? {}, path) ? (change.edit ?? {})[path] : content] as const),
    ...Object.entries(change.add ?? {}),
  ])
}

export const createBlueprintDraftStore = (onChange?: DraftChangeListener): BlueprintDraftStore => {
  let held: BlueprintDraftHeld | null = null
  /**
   * Announce the held tree after a mutation that took.
   *
   * Only on SUCCESS. A refused write leaves the draft exactly as it was, and announcing it anyway
   * would tell a surface to re-read bytes that did not move — harmless today, and precisely the
   * kind of thing that later gets mistaken for "the edit landed".
   */
  const announce = () => onChange?.(held)
  const store: BlueprintDraftStore = {
    addFile: (path, content) => {
      if (!held) {
        return { bytes: 0, error: 'no draft is held — start or preview a page first', ok: false }
      }
      if (!path) {
        return { bytes: held.bytes, error: 'a new file needs a path', ok: false }
      }
      if (path in held.files) {
        // An existing path is an EDIT, and edits go through updateFile so they get its checks.
        // Silently overwriting here would make "add" a way to bypass them.
        return { bytes: held.bytes, error: `"${path}" is already in the draft — edit it instead`, ok: false }
      }
      const nextFiles = settle({ ...held.files, [path]: content }, held.kind)
      const bytes = measureTreeBytes(nextFiles)
      if (bytes > BLUEPRINT_DRAFT_MAX_BYTES) {
        const kib = Math.ceil(bytes / 1024)
        // Same contract as updateFile: over-cap leaves the held tree EXACTLY as it was.
        return { bytes: held.bytes, error: `adding this file brings the draft to ${kib} KiB — over the 512 KiB cap`, ok: false }
      }
      // `held.kind` carries forward: an add or an edit never changes WHO authored the draft.
      held = { bytes, files: nextFiles, kind: held.kind }
      announce()
      return { bytes, ok: true }
    },
    applyFiles: (change) => {
      if (!held) {
        return { bytes: 0, error: 'no draft is held', ok: false }
      }
      const refusal = changeRefusal(held.files, change)
      if (refusal) {
        return { bytes: held.bytes, ok: false, ...refusal }
      }
      const nextFiles = changedTree(held.files, change)
      const bytes = measureTreeBytes(nextFiles)
      if (bytes > BLUEPRINT_DRAFT_MAX_BYTES) {
        const kib = Math.ceil(bytes / 1024)
        // Same contract as every other write: over the cap, the held tree is left EXACTLY as it was.
        return { bytes: held.bytes, error: `the change brings the draft to ${kib} KiB — over the 512 KiB cap`, ok: false }
      }
      held = { bytes, files: nextFiles, kind: held.kind }
      announce()
      return { bytes, ok: true }
    },
    clear: () => {
      held = null
      announce()
    },
    get: () => held,
    removeFile: (path) => {
      if (!held) {
        return { bytes: 0, error: 'no draft is held', ok: false }
      }
      if (!(path in held.files)) {
        return { bytes: held.bytes, error: `"${path}" is not in the draft`, ok: false }
      }
      const remaining = { ...held.files }
      delete remaining[path]
      const nextFiles = settle(remaining, held.kind)
      const bytes = measureTreeBytes(nextFiles)
      // `held.kind` carries forward, as it does for every other edit: removing a file never changes
      // WHO authored the draft.
      held = { bytes, files: nextFiles, kind: held.kind }
      announce()
      return { bytes, ok: true }
    },
    set: (files: Record<string, string>, kind: DraftKind) => {
      const result = createBlueprintDraft(files, kind)
      if (result.ok) {
        held = result.held
        announce()
      }
      return result
    },
    updateDisplayedFile: (displayedPath, content) => {
      const key = held ? heldKeyForDisplayedPath(displayedPath, held) : null
      return store.updateFile(key ?? displayedPath, content)
    },
    updateFile: (path, content) => {
      if (!held) {
        return { bytes: 0, error: 'no draft is held — preview a page or blueprint first', ok: false }
      }
      if (!(path in held.files)) {
        return { bytes: held.bytes, error: `"${path}" is not a held file — only previewed files can be edited`, ok: false }
      }
      const nextFiles = settle({ ...held.files, [path]: content }, held.kind)
      const bytes = measureTreeBytes(nextFiles)
      if (bytes > BLUEPRINT_DRAFT_MAX_BYTES) {
        const kib = Math.ceil(bytes / 1024)
        // Over-cap: the held tree is left EXACTLY as it was (the previously-held bytes stand).
        return { bytes: held.bytes, error: `the edit brings the draft to ${kib} KiB — over the 512 KiB cap; trim the file`, ok: false }
      }
      held = { bytes, files: nextFiles, kind: held.kind }
      announce()
      return { bytes, content: nextFiles[path], ok: true }
    },
  }
  return store
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

/** True iff any op payload carries a `{"$fileContent": …}` token — refused since the GitHub path went. */
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
