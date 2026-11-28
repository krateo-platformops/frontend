/**
 * FreshnessBadge — a tiny per-widget honesty pill that surfaces the react-query
 * lifecycle a widget is already in (produced by useWidgetQuery) so a widget never
 * silently shows pre-write or hung data. It reads the timestamps react-query
 * already computes — nothing is polled or fetched here.
 *
 * State machine (Petrol status language, see theme/tokens.ts):
 *   liveArmed && !isStale && !isFetching  → 'Live'         (cyan dot, glowing)
 *   isFetching (with prior data)          → 'Refreshing…'  (amber) — old data kept
 *   isStale && !isFetching                → 'Stale · N minutes ago' (muted/gray)
 *   else                                  → 'Updated N minutes ago' (muted/gray)
 *
 * `liveArmed` is true only once the widget's snowplow `/refreshes` subscription has
 * armed (see refreshSse.isWidgetArmed), so the green "Live" dot is honest — it means
 * a push channel is open, not merely that the last fetch succeeded.
 *
 * A manual refresh affordance (onRefresh) lets the user force a refetch when a
 * widget looks stale, without waiting for the next live signal.
 */

import { formatAgo } from '../../utils/dateFormat'

import styles from './FreshnessBadge.module.css'

/** The four honesty states, in Petrol status-colour terms. */
export type FreshnessTone = 'live' | 'refreshing' | 'stale'

export interface FreshnessState {
  /** Human label rendered in the pill (already includes the relative time when relevant). */
  label: string
  /** Whether to render the pulsing status dot (only the "live" tone shows it). */
  showDot: boolean
  /** Petrol tone → drives the pill/dot colour class. */
  tone: FreshnessTone
}

export interface FreshnessBadgeProps {
  /** react-query dataUpdatedAt (ms epoch of the last successful fetch); 0 before first success. */
  dataUpdatedAt: number
  /** react-query isFetching — true while a (background) fetch is in flight. */
  isFetching: boolean
  /** react-query isStale — true when the cached data is past its staleTime. */
  isStale: boolean
  /** True once this widget's `/refreshes` SSE subscription has armed (isWidgetArmed). */
  liveArmed: boolean
  /** Manual refresh affordance — force a refetch. Omit to hide the button. */
  onRefresh?: () => void
  /** Clock injection point for deterministic tests; defaults to Date.now. */
  now?: () => number
}

/**
 * Non-ticking time-ago, in a sentence ("just now", "2 minutes ago", "3 hours ago": utils/dateFormat, the
 * approved "Dates and ages" form). Never in the future: a clock a little ahead is "just now". Pure so
 * FreshnessBadge stays trivially testable. `updatedAt <= 0` (never fetched) → 'never'.
 */
export const formatRelative = (updatedAt: number, nowMs: number): string => {
  if (!updatedAt || updatedAt <= 0) { return 'never' }
  return formatAgo(Math.min(updatedAt, nowMs), { now: nowMs })
}

/**
 * Pure state machine — mapped from the react-query flags to a rendered label +
 * Petrol tone. Exported (and unit-tested) so the visual component stays a thin
 * wrapper. `isFetching` wins over staleness because a background refetch keeps the
 * OLD data on screen while it resolves (never a skeleton) — the honest signal there
 * is "Refreshing…", not "Stale".
 */
export const deriveFreshnessState = (
  { dataUpdatedAt, isFetching, isStale, liveArmed }: Pick<FreshnessBadgeProps, 'dataUpdatedAt' | 'isFetching' | 'isStale' | 'liveArmed'>,
  nowMs: number
): FreshnessState => {
  if (isFetching && dataUpdatedAt > 0) {
    return { label: 'Refreshing…', showDot: false, tone: 'refreshing' }
  }
  if (liveArmed && !isStale && !isFetching) {
    return { label: 'Live', showDot: true, tone: 'live' }
  }
  if (isStale && !isFetching) {
    return { label: `Stale · ${formatRelative(dataUpdatedAt, nowMs)}`, showDot: false, tone: 'stale' }
  }
  return { label: `Updated ${formatRelative(dataUpdatedAt, nowMs)}`, showDot: false, tone: 'stale' }
}

const TONE_CLASS: Record<FreshnessTone, string> = {
  live: styles.live,
  refreshing: styles.refreshing,
  stale: styles.stale,
}

export const FreshnessBadge = ({ dataUpdatedAt, isFetching, isStale, liveArmed, now = Date.now, onRefresh }: FreshnessBadgeProps) => {
  const { label, tone } = deriveFreshnessState({ dataUpdatedAt, isFetching, isStale, liveArmed }, now())

  // A quiet, color-coded dot — no text. The full label ("Stale · 2m ago" / "Refreshing…")
  // rides in the native tooltip so the widget surface stays calm.
  const dot = <span aria-hidden='true' className={`${styles.dot} ${TONE_CLASS[tone]}`} />

  // Stale is the one actionable state — make the dot itself the refresh control.
  if (onRefresh && tone === 'stale') {
    return (
      <button
        aria-label={`${label} — refresh`}
        className={`${styles.badge} ${styles.clickable}`}
        data-freshness={tone}
        data-testid='freshness-badge'
        onClick={onRefresh}
        title={`${label} · click to refresh`}
        type='button'
      >
        {dot}
      </button>
    )
  }
  return (
    <span className={styles.badge} data-freshness={tone} data-testid='freshness-badge' title={label}>
      {dot}
    </span>
  )
}

export default FreshnessBadge
