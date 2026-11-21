import { useEffect, useState } from 'react'

import styles from './PageHeader.module.css'

/**
 * PageHeader `progress`: "Re-analysis since 11:54 UTC · 12 min" (approved mockup, Diego's report that a
 * re-analysis showed "no sign of life"). The page itself updates live when the state changes; this
 * line keeps the WAIT visible in between. The minutes are computed in the browser, every 15 s, and
 * only while `live`: a server-side "12 min" would be cached with the page and stay "12 min". No ETA,
 * because the time an analysis takes is not knowable in advance (17 min there was rate limiting).
 */
export interface HeaderProgressData {
  hint?: string
  label: string
  live?: boolean
  since: string
}

const TICK_MS = 15_000

/** "11:54 UTC" for a time today (UTC), "2026-11-20 11:54 UTC" otherwise; '' when unparseable. */
export const clockLabel = (since: string, now: number): string => {
  const at = Date.parse(since)
  if (Number.isNaN(at)) { return '' }
  const iso = new Date(at).toISOString()
  const sameDay = iso.slice(0, 10) === new Date(now).toISOString().slice(0, 10)
  return `${sameDay ? '' : `${iso.slice(0, 10)} `}${iso.slice(11, 16)} UTC`
}

/** Whole minutes since `since`, never negative; null when unparseable. */
export const elapsedMinutes = (since: string, now: number): number | null => {
  const at = Date.parse(since)
  return Number.isNaN(at) ? null : Math.max(0, Math.floor((now - at) / 60_000))
}

const HeaderProgress = ({ progress }: { progress: HeaderProgressData }) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!progress.live) { return undefined }
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, TICK_MS)
    return () => { clearInterval(timer) }
  }, [progress.live, progress.since])

  const clock = clockLabel(progress.since, now)
  if (!clock) { return null }
  const minutes = progress.live ? elapsedMinutes(progress.since, now) : null

  return (
    <div className={styles.progress} data-page-header='progress'>
      <span className={styles.progressLine}>
        {progress.label} <span className={styles.progressValue}>{clock}</span>
        {minutes !== null && <> · <span className={styles.progressValue}>{minutes} min</span></>}
        {progress.live && <span className={styles.progressLive}><span aria-hidden className={styles.progressDot} />live</span>}
      </span>
      {progress.live && progress.hint && <span className={styles.progressHint}>{progress.hint}</span>}
    </div>
  )
}

export default HeaderProgress
