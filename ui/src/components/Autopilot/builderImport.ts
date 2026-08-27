/**
 * UI-NATIVE BUILDER IMPORT (item C) — client-side file ingestion for the import/publish forms.
 *
 * The blueprint + page builders are IMPORT surfaces: the user supplies the artifact's files (a Helm
 * chart tree, or a portal page's widget-CR YAML + optional nav fragment). Both forms read those files
 * ENTIRELY CLIENT-SIDE (antd Upload's `beforeUpload` returns false — nothing is ever POSTed to a
 * server here) into the SAME `{path: content}` held-draft shape the Autopilot builders publish from,
 * then this module validates them: every file must parse as YAML, and the total tree must stay under
 * the 512 KiB held-tree cap (blueprintDraftStore's BLUEPRINT_DRAFT_MAX_BYTES). The publish machinery
 * (blueprintBuilderPublish / pageBuilderPublish) then treats the map exactly like an Autopilot-held
 * draft — published verbatim, never reproduced.
 *
 * Pure module (FileReader + js-yaml, no React). The forms own the map state; these helpers read/parse.
 */

import { load } from 'js-yaml'

import { BLUEPRINT_DRAFT_MAX_BYTES } from './blueprintDraftStore'
import { utf8ByteLength } from './oasAttachment'

/** Read one File's text CLIENT-SIDE (never uploaded). Rejects on a read error. */
export const readFileText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(`could not read ${file.name}`))
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsText(file)
  })

/**
 * Derive the held-draft KEY (the relative path) for an uploaded file. antd's `webkitRelativePath`
 * carries the in-folder path when a directory is chosen (e.g. `mychart/templates/x.yaml`); we strip
 * the LEADING top-level folder segment so the tree is chart-root-relative (`templates/x.yaml`,
 * `Chart.yaml`) — matching how the Autopilot draft holds it. A flat multi-file pick (no relative
 * path) keys by the bare file name.
 */
export const importFileKey = (file: File): string => {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  if (typeof rel === 'string' && rel.includes('/')) {
    const segments = rel.split('/')
    // Drop the top-level folder the OS prepends when a directory is chosen.
    return segments.slice(1).join('/') || file.name
  }
  return file.name
}

/** The result of validating an imported `{path: content}` tree. */
export type ImportValidation =
  | { ok: true; bytes: number }
  | { ok: false; errors: string[] }

/**
 * Validate an imported tree BEFORE it is handed to the publish machinery: non-empty, under the 512
 * KiB held-tree cap, and every file parses as YAML (a chart/page is YAML end-to-end — a values file,
 * a template, a widget CR). Returns the byte total on success, or the collected per-file errors. This
 * is the form-level gate; the publish compiler re-checks the cap + scope (defense in depth).
 */
export const validateImportedTree = (files: Record<string, string>): ImportValidation => {
  const paths = Object.keys(files)
  if (paths.length === 0) {
    return { errors: ['No files imported — upload the artifact\'s files or paste them below.'], ok: false }
  }
  const errors: string[] = []
  let bytes = 0
  for (const path of paths) {
    bytes += utf8ByteLength(files[path])
    try {
      // A parse that throws is a hard YAML error; an empty/whitespace file is allowed (e.g. a stub).
      load(files[path])
    } catch (error) {
      errors.push(`${path}: not valid YAML — ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (bytes > BLUEPRINT_DRAFT_MAX_BYTES) {
    const kib = Math.ceil(bytes / 1024)
    errors.push(`The imported tree is ${kib} KiB across ${paths.length} files — over the 512 KiB cap. Trim it (large assets belong in a hosted values file, not the imported tree).`)
  }
  return errors.length > 0 ? { errors, ok: false } : { bytes, ok: true }
}
