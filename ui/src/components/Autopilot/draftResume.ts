/**
 * RESUME — a draft record, read back into the composer it came from. Pure, but for one fetch.
 *
 * WHY. A draft record (draftRecord.ts) holds the whole held tree in the preview sandbox, so a tab
 * that died lost nothing. That is only half a promise until the tree can come BACK: "Your drafts"
 * links each record to its composer as `?resume=<record name>`, and this module is what the
 * composer does with that name — validate it, read the record as the person, and say in a sentence
 * why when it cannot. Loading it into the held-draft store is the provider's (useDraftResumeBus);
 * the page asks, on a bus, exactly as Start does.
 *
 * It replaces `resumePreviewDraft.ts`, which reopened only the RENDER of a page's sandbox CRs — no
 * files, no held draft, so nothing to edit and nothing to publish — and which nothing ever called.
 *
 * THE READ GOES THROUGH snowplow `/call`, UNDER THE CALLER'S OWN CREDENTIAL (the composer rule):
 * never a service identity, so a record this person may not read is a 403 they are told about, not
 * a draft they are handed. A null from `readDraftRecord`, a 403 and a 404 are all content — a
 * sentence where the draft would have been — never a crash.
 */
import { builderOf } from '../../builders/builderRegistry'
import { draftKindOf } from '../../builders/draftKinds'
import { getAccessToken } from '../../utils/getAccessToken'

import type { DraftKind } from './blueprintDraftStore'
import { readDraftRecord, type DraftRecordBody } from './draftRecord'

/** The query parameter "Your drafts" links carry: `?resume=<record name>`. */
export const RESUME_PARAM = 'resume'

/**
 * A record name as draftRecordName makes one: `draft-…`, a DNS-1123 label within 63 characters.
 *
 * Validated, not trusted: the name becomes the `name` of a `/call` read. A crafted value must
 * resolve to nothing rather than to a request for some other object in the sandbox — a page's
 * preview CR, a chart's render ConfigMap.
 */
const RECORD_NAME = /^draft-[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

export const isDraftRecordName = (name: unknown): name is string =>
  typeof name === 'string' && name.length <= 63 && RECORD_NAME.test(name)

/** The record name a resume link carries, or null when there is nothing valid to resume. */
export const resumeRecordNameFrom = (search: string): string | null => {
  let raw: string | null = null
  try {
    raw = new URLSearchParams(search).get(RESUME_PARAM)
  } catch {
    return null
  }
  return isDraftRecordName(raw) ? raw : null
}

export type RecordRead =
  | { ok: true; record: DraftRecordBody }
  | { ok: false; message: string }

export const RESUME_NOT_CONFIGURED = 'Drafts cannot be resumed here — this portal has no preview sandbox configured, so there is nowhere a draft could have been saved.'

/** The logged-in session's Bearer. Best-effort — no token (or no storage in tests) is no header. */
const authHeader = (): Record<string, string> => {
  try {
    return { Authorization: `Bearer ${getAccessToken()}` }
  } catch {
    return {}
  }
}

/**
 * Read one record ConfigMap from the sandbox, as the person. Never throws: every way it can fail is
 * a RecordRead that says why, in the person's words.
 */
export const readDraftRecordByName = async (
  snowplowBaseUrl: string | undefined,
  sandboxNamespace: string | undefined,
  name: string,
): Promise<RecordRead> => {
  if (!snowplowBaseUrl || !sandboxNamespace) {
    return { message: RESUME_NOT_CONFIGURED, ok: false }
  }
  if (!isDraftRecordName(name)) {
    return { message: `"${String(name)}" is not the name of a draft.`, ok: false }
  }
  try {
    const url = new URL(`${snowplowBaseUrl.replace(/\/+$/, '')}/call`)
    url.searchParams.set('apiVersion', 'v1')
    url.searchParams.set('resource', 'configmaps')
    url.searchParams.set('name', name)
    url.searchParams.set('namespace', sandboxNamespace)
    const response = await fetch(url.toString(), { headers: { ...authHeader() } })
    if (response.status === 404) {
      return { message: `The draft ${name} is not in your drafts any more — it was discarded, or it was never saved.`, ok: false }
    }
    if (response.status === 403) {
      return { message: `You are not allowed to read the draft ${name} — your role does not grant reading drafts in the preview sandbox.`, ok: false }
    }
    if (!response.ok) {
      return { message: `The draft ${name} could not be read — snowplow answered ${response.status}.`, ok: false }
    }
    const record = readDraftRecord(await response.json().catch(() => null))
    return record
      ? { ok: true, record }
      : { message: `The draft ${name} cannot be restored — its record is damaged, or was written by a newer version of the portal.`, ok: false }
  } catch (error) {
    return { message: `Could not reach snowplow to read the draft ${name} — ${error instanceof Error ? error.message : String(error)}.`, ok: false }
  }
}

/**
 * Where a record of this kind is resumed. A record opened in the OTHER composer is not loaded
 * there — a page tree in the Blueprint Composer is parked, not drawn — so it says where to go: the
 * label of the Builder that declares the record's draft kind, and the artifact its plugin names.
 */
export const wrongComposerMessage = (record: Pick<DraftRecordBody, 'kind' | 'name'>): string =>
  `${record.name} is ${draftKindOf(record.kind).nouns.artifact} draft — resume it from the ${builderOf(record.kind).label}.`

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * "today at 12:04" / "yesterday at 09:10" / "on 24/09/2026 at 17:30" — the banner's "last saved".
 * `now` is injectable so a test does not depend on the clock. An unreadable timestamp is said as
 * such, rather than as "Invalid Date".
 */
export const savedWhen = (iso: string, now: Date = new Date()): string => {
  const saved = new Date(iso)
  if (Number.isNaN(saved.getTime())) {
    return 'at an unknown time'
  }
  const at = `${pad(saved.getHours())}:${pad(saved.getMinutes())}`
  const day = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((day(now) - day(saved)) / 86_400_000)
  if (days === 0) { return `today at ${at}` }
  if (days === 1) { return `yesterday at ${at}` }
  return `on ${saved.toLocaleDateString()} at ${at}`
}

/** What the restored banner says (screen 3), from what the provider answered. */
export const restoredBannerCopy = (
  resumed: { kind: DraftKind; updatedAt: string; previewed: boolean; everPreviewed: boolean; relinked: boolean },
  now?: Date,
): { title: string; body: string } => {
  const sentences = [`The ${draftKindOf(resumed.kind).nouns.short} is exactly as you left it, and Undo starts here.`]
  if (!resumed.previewed) {
    sentences.push(resumed.everPreviewed
      ? 'It changed after its last Preview, so preview it again before publishing.'
      : 'It has not been previewed yet, so preview it before publishing.')
  }
  // Only when a conversation was actually found and switched to: a sentence about a thread that no
  // longer exists would send the person looking for it.
  if (resumed.relinked) {
    sentences.push('Autopilot\'s thread is re-linked.')
  }
  return { body: sentences.join(' '), title: `Restored from your drafts — last saved ${savedWhen(resumed.updatedAt, now)}.` }
}

/** "ready to publish" or "Preview needed" — one row of the replace prompt's summary (screen 4). */
export const readiness = (previewed: boolean): string => (previewed ? 'ready to publish' : 'Preview needed')
