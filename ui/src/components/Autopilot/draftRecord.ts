/**
 * DRAFT RECORDS — every held draft, stored where a dead tab cannot lose it. Pure.
 *
 * WHY. A held draft lived only in the tab: the blueprint composer's chart in memory, and a page's
 * live preview as sandbox CRs nobody owned, that a closed tab could neither clean up nor give back.
 * A draft record is ONE ConfigMap per user and draft in the preview sandbox, holding the whole held
 * tree. The record IS the draft; every preview artifact (a page's sandbox CRs, a chart's render
 * ConfigMap) is derived from it and rebuildable. See the plan: "Draft records — every preview is
 * stored, and restored when it is abandoned".
 *
 * THIS MODULE IS THE CONTRACT every other piece codes against — the autosave, Resume, the page
 * preview's owner-scoped names, and the portal's `my-drafts` RESTAction, whose jq must compute
 * `ownerOf` exactly as `draftOwner` does here (the sanitizer is written so both can).
 *
 * The record:
 *   name         draft-<kind>-<owner>-<slug>, a DNS-1123 name within 63 characters; <kind> is the
 *                Builder's spec.draftKind (page, blueprint, controller, …)
 *   labels       krateo.io/purpose=draft-record, krateo.io/draft-owner, krateo.io/draft-kind,
 *                krateo.io/draft-state, krateo.io/draft-previewed ("true"|"false")
 *   annotations  krateo.io/draft-name (the display name), krateo.io/draft-updated-at
 *   data         draft.json = DraftRecordBody (below)
 */
import { isDraftKind } from '../../builders/draftKinds'

import type { DraftKind } from './blueprintDraftStore'

export const DRAFT_RECORD_PURPOSE = 'draft-record'
export const DRAFT_RECORD_KEY = 'draft.json'
export const DRAFT_RECORD_VERSION = 1

export const LABEL_PURPOSE = 'krateo.io/purpose'
export const LABEL_OWNER = 'krateo.io/draft-owner'
export const LABEL_KIND = 'krateo.io/draft-kind'
export const LABEL_STATE = 'krateo.io/draft-state'
/** "true" when the tree is exactly the one the last Preview rendered — for listings, which cannot hash. */
export const LABEL_PREVIEWED = 'krateo.io/draft-previewed'
export const ANNOTATION_NAME = 'krateo.io/draft-name'
export const ANNOTATION_UPDATED = 'krateo.io/draft-updated-at'

/** The owner of a draft nobody can be matched to (drafts from before records existed). */
export const UNKNOWN_OWNER = 'unknown'

export type DraftState = 'open' | 'published'

export interface DraftRecordBody {
  version: typeof DRAFT_RECORD_VERSION
  kind: DraftKind
  /** The display name: a chart's Chart.yaml name, a page's slug. */
  name: string
  /** The whole held tree, `{path: content}` — exactly what the held-draft store holds. */
  files: Record<string, string>
  /** RFC 3339, set on every save. */
  updatedAt: string
  /** `treeHash` of the tree the last successful Preview rendered — Publish re-arms only on a match. */
  renderedHash?: string
  /** The Autopilot thread that produced it, when one did. */
  threadId?: string
  state: DraftState
  /**
   * Where it was published — and, for a draft kind whose plugin has one, the snapshot of what that
   * publish locked (publishedLocks.ts): opaque here, read back only by that kind's code.
   */
  publish?: { repo: string; prUrl?: string; locked?: Record<string, Record<string, unknown>> }
}

/**
 * The owner segment from a username: lower case, each run of anything but [a-z0-9-] one `-`, no
 * leading or trailing `-`, at most 40 characters; empty → `unknown`. The portal's jq computes the
 * same: `ascii_downcase | gsub("[^a-z0-9-]+"; "-") | gsub("^-+|-+$"; "") | .[0:40] | gsub("-+$"; "")`,
 * then `if . == "" then "unknown" else . end`.
 */
export const draftOwner = (username: string | undefined): string => {
  const cleaned = (username ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return cleaned || UNKNOWN_OWNER
}

const slugOf = (text: string): string => text.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'draft'

/** `draft-<kind>-<owner>-<slug>`, cut to 63 characters and never ending in `-`. */
export const draftRecordName = (kind: DraftKind, owner: string, name: string): string =>
  `draft-${kind}-${owner}-${slugOf(name)}`.slice(0, 63).replace(/-+$/g, '')

/** A stable hash of a tree — keys sorted, so two equal trees hash equal however they were built. */
export const treeHash = (files: Readonly<Record<string, string>>): string => {
  const canonical = JSON.stringify(Object.keys(files).sort().map((path) => [path, files[path]]))
  // FNV-1a, two 32-bit lanes (different offset bases) → 16 hex characters. Not a security hash: it
  // only has to tell "the tree Preview rendered" from "an edited tree".
  let laneA = 0x811c9dc5
  let laneB = 0x01000193 ^ 0x5bd1e995
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index)
    laneA = Math.imul(laneA ^ code, 0x01000193) >>> 0
    laneB = Math.imul(laneB ^ code, 0x01000193 ^ 0x2545) >>> 0
  }
  return `${laneA.toString(16).padStart(8, '0')}${laneB.toString(16).padStart(8, '0')}`
}

/** The ConfigMap a record is stored as. */
export const draftRecordConfigMap = (
  namespace: string,
  owner: string,
  body: DraftRecordBody,
): Record<string, unknown> => ({
  apiVersion: 'v1',
  data: { [DRAFT_RECORD_KEY]: JSON.stringify(body) },
  kind: 'ConfigMap',
  metadata: {
    annotations: { [ANNOTATION_NAME]: body.name, [ANNOTATION_UPDATED]: body.updatedAt },
    labels: {
      [LABEL_KIND]: body.kind,
      [LABEL_OWNER]: owner,
      [LABEL_PREVIEWED]: String(body.renderedHash !== undefined && body.renderedHash === treeHash(body.files)),
      [LABEL_PURPOSE]: DRAFT_RECORD_PURPOSE,
      [LABEL_STATE]: body.state,
    },
    name: draftRecordName(body.kind, owner, body.name),
    namespace,
  },
})

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The body out of a record ConfigMap, or null when it is not one this version can restore — never a
 * throw: a record someone hand-edited is content to report, not a crash.
 */
export const readDraftRecord = (configMap: unknown): DraftRecordBody | null => {
  if (!isRecord(configMap) || !isRecord(configMap.data)) { return null }
  const raw = configMap.data[DRAFT_RECORD_KEY]
  if (typeof raw !== 'string') { return null }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(body) || body.version !== DRAFT_RECORD_VERSION) { return null }
  // Any kind a loaded Builder declares (page, blueprint, controller, …) — and only those: a record of
  // a kind nothing here could preview, publish or resume is not handed out as a draft.
  if (!isDraftKind(body.kind)) { return null }
  if (typeof body.name !== 'string' || !isRecord(body.files)) { return null }
  if (!Object.values(body.files).every((content) => typeof content === 'string')) { return null }
  if (body.state !== 'open' && body.state !== 'published') { return null }
  return body as unknown as DraftRecordBody
}
