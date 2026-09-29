/**
 * "Saved · HH:MM" — the composer header's word on the held draft's record (useDraftAutosave).
 *
 * THREE STATES AND NOTHING ELSE. Saving while a write is in flight; Saved with the time of the last
 * write that LANDED; Not saved with the apiserver's reason when one did not — never silent, because
 * a person who believes their work is stored closes the tab. Before the first save, and when the
 * install has no sandbox to save into (`off`), it shows nothing: there is no claim to make yet.
 *
 * A composer shows only its OWN kind's status: a page held while the blueprint composer is open is
 * not this composer's draft, and its "Saved" would be read as the chart's.
 */
import { CheckOutlined } from '@ant-design/icons'

import type { DraftKind } from './blueprintDraftStore'
import styles from './DraftSaveIndicator.module.css'
import { draftKeptOnClose, type DraftSaveStatus, useDraftSaveStatus } from './draftSaveStatus'

/** HH:MM, 24-hour, local time — the mockup's format. */
export const savedClock = (iso: string): string => {
  const at = new Date(iso)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** The indicator's text for a status, or null when it shows nothing. Pure, so the states are testable. */
export const saveIndicatorText = (status: DraftSaveStatus, kind: DraftKind): string | null => {
  if (status.kind !== kind) {
    return null
  }
  switch (status.phase) {
    case 'saving':
      return 'Saving…'
    case 'saved':
      return status.savedAt ? `Saved · ${savedClock(status.savedAt)}` : 'Saved'
    case 'error':
      return `Not saved — ${status.reason ?? 'the save failed'}`
    default:
      return null
  }
}

const DraftSaveIndicator = ({ kind }: { kind: DraftKind }) => {
  const status = useDraftSaveStatus()
  const text = saveIndicatorText(status, kind)
  if (!text) {
    return null
  }
  const tone = { error: styles.error, saved: styles.saved }[status.phase as 'error' | 'saved'] ?? ''
  return (
    <span aria-live='polite' className={`${styles.indicator} ${tone}`.trim()} role='status'>
      {status.phase === 'saved' ? <CheckOutlined aria-hidden /> : null}
      {text}
    </span>
  )
}

/**
 * The Close-draft confirm's words. CLOSE IS NOT DISCARD when the draft has a record: it stays stored,
 * to resume from the drafts list, and only its preview goes. Without one (no sandbox, or the last
 * save failed) the files go with the close — and the confirm must still say that.
 */
const CLOSE_COPY: Record<DraftKind, { kept: string; lost: string }> = {
  blueprint: {
    kept: 'Close this chart draft? It stays saved in your drafts; only its preview is removed.',
    lost: 'Discard this chart draft? Its unpublished files are deleted.',
  },
  page: {
    kept: 'Close this draft? It stays saved in your drafts; only its sandbox preview is removed.',
    lost: 'Discard this draft? The sandbox and its unpublished files are deleted.',
  },
}

export const useCloseDraftCopy = (kind: DraftKind): { okText: string; title: string } => {
  const kept = draftKeptOnClose(useDraftSaveStatus(), kind)
  return kept ? { okText: 'Close draft', title: CLOSE_COPY[kind].kept } : { okText: 'Discard', title: CLOSE_COPY[kind].lost }
}

export default DraftSaveIndicator
