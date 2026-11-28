import { useEffect, useState } from 'react'

import TimeText from '../../components/TimeText'
import { formatAge, toInstant } from '../../utils/dateFormat'

import styles from './PageHeader.module.css'

/**
 * PageHeader `progress`: "Re-analysis since 21 Nov, 12:54 · 12 minutes" (approved mockup, Diego's report
 * that a re-analysis showed "no sign of life"; times as the approved "Dates and ages" design writes them:
 * the start a moment in the viewer's zone, full date on hover, the wait an age). The page itself updates
 * live when the state changes; this line keeps the WAIT visible in between. The age is computed in the
 * browser, every 15 s, and only while `live`: a server-side "12 min" would be cached with the page and
 * stay "12 min". No ETA, because the time an analysis takes is not knowable in advance (17 min there was
 * rate limiting).
 */
export interface HeaderProgressData {
  hint?: string
  label: string
  live?: boolean
  since: string
}

const TICK_MS = 15_000

const HeaderProgress = ({ progress }: { progress: HeaderProgressData }) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!progress.live) { return undefined }
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, TICK_MS)
    return () => { clearInterval(timer) }
  }, [progress.live, progress.since])

  const since = toInstant(progress.since)
  if (!since) { return null }
  // A start a little ahead of this browser's clock is a wait that has just begun, never "in 1 minute".
  const elapsed = progress.live ? formatAge(progress.since, { now: Math.max(now, since.getTime()) }) : null

  return (
    <div className={styles.progress} data-page-header='progress'>
      <span className={styles.progressLine}>
        {progress.label} <TimeText className={styles.progressValue} form='moment' value={progress.since} />
        {elapsed !== null && <> · <span className={styles.progressValue}>{elapsed}</span></>}
        {progress.live && <span className={styles.progressLive}><span aria-hidden className={styles.progressDot} />live</span>}
      </span>
      {progress.live && progress.hint && <span className={styles.progressHint}>{progress.hint}</span>}
    </div>
  )
}

export default HeaderProgress
