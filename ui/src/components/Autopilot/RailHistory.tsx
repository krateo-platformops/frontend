/**
 * The session-history column docked beside the transcript (not over it — see
 * HISTORY_EXTRA_WIDTH in railWidth.ts, which widens the rail to make room).
 *
 * Split out of AutopilotRail.tsx. It keeps rendering at width:0 while closed rather than
 * unmounting, so every tabbable element inside also takes `tabIndex={-1}`: without that,
 * Tab would walk through a search box and rows that are invisible and `aria-hidden`.
 */

import { useEffect, useState } from 'react'

import styles from './AutopilotRail.module.css'
import { EvidenceIcon } from './icons'
import { relativeTime, type ThreadSummary } from './sessionHistoryStore'

/**
 * Session history (item P, split-view iteration). A persistent column docked beside
 * the transcript — NOT a popover — so past threads stay browsable while the live conversation
 * remains visible.
 *
 * ALWAYS mounted (same convention as the rail itself, which never unmounts and instead
 * animates `.apRail`'s width 0→384): `open` drives a width-only CSS transition, 0→220,
 * in sync with the rail's own 384→640 `.split` transition (same duration/easing). Mounting it
 * only on `historyOpen` used to make it pop in at its full 220px width WHILE the rail was still
 * narrow — an instant hard squeeze of the transcript before the rail's own width caught up a
 * moment later. Animating both widths together keeps the transcript's width monotonic (it only
 * grows when opening, only shrinks when closing) instead of squeeze-then-grow.
 *
 * Re-reads the archive when it opens, and again whenever the active thread changes (a switch or
 * a new thread both change `currentSessionId`) — keeping the list in sync without a live
 * localStorage subscription. `aria-hidden` while closed, matching its zero width.
 *
 * The search box is a local, in-memory filter over `rows` (title substring match) — not
 * PageSearch's `?q=`-bound pattern, since this list isn't URL-addressable state — and the
 * query resets on close so reopening the column never lands on a stale filter. Every
 * tabbable element here also gets `tabIndex={-1}` while closed: the column keeps rendering
 * at width:0 rather than unmounting (see the rail's own convention), and without it Tab would
 * still walk through search + rows that are invisible and `aria-hidden`.
 */
export const HistoryColumn = ({ currentSessionId, onSwitch, open, sessions }: {
  currentSessionId: string
  onSwitch: (sessionId: string) => void
  open: boolean
  sessions: () => ThreadSummary[]
}) => {
  const [rows, setRows] = useState<ThreadSummary[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (open) {
      setRows(sessions())
    } else {
      setQuery('')
    }
  }, [sessions, currentSessionId, open])

  const trimmedQuery = query.trim()
  const filteredRows = trimmedQuery
    ? rows.filter((row) => row.title.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : rows

  let listContent: React.ReactNode
  if (rows.length === 0) {
    listContent = <div className={styles.apHistoryEmpty}>No past conversations yet. Your threads are saved here when you start a new one.</div>
  } else if (filteredRows.length === 0) {
    listContent = <div className={styles.apHistoryEmpty}>No conversations match &quot;{trimmedQuery}&quot;.</div>
  } else {
    listContent = filteredRows.map((row) => (
      <button
        className={`${styles.apHistoryRow} ${row.sessionId === currentSessionId ? styles.apHistoryRowActive : ''}`}
        key={row.sessionId}
        onClick={() => onSwitch(row.sessionId)}
        tabIndex={open ? 0 : -1}
        type='button'
      >
        <span className={styles.apHistoryTitle}>{row.title}</span>
        <span className={styles.apHistoryMeta}>{relativeTime(row.updatedAt)} · {row.messageCount} msg{row.messageCount === 1 ? '' : 's'}</span>
      </button>
    ))
  }

  return (
    <div aria-hidden={!open} className={`${styles.apHistoryCol} ${open ? styles.apHistoryColOpen : ''}`} data-testid='autopilot-history-panel'>
      <div className={styles.apHistoryHead}>Conversations</div>
      {rows.length > 0 ? (
        <div className={styles.apHistorySearchWrap}>
          <EvidenceIcon className={styles.apHistorySearchIcon} size={11} />
          <input
            aria-label='Search conversations'
            className={styles.apHistorySearchInput}
            data-testid='autopilot-history-search'
            onChange={(event) => setQuery(event.target.value)}
            placeholder='Search…'
            tabIndex={open ? 0 : -1}
            type='text'
            value={query}
          />
        </div>
      ) : null}
      <div className={styles.apHistoryList}>{listContent}</div>
    </div>
  )
}
