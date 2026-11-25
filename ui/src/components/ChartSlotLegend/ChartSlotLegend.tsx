import type { SlotLegendKeys } from '../../utils/chartSlots'
import { SO_FAR } from '../../utils/chartSlots'

import styles from './ChartSlotLegend.module.css'

/**
 * The legend entries for a chart's slot marks: "so far" (the slot still filling) and "no data" (a slot where
 * nothing was recorded), each only when the chart draws one. G2's own legend is keyed by the series colour, so
 * these two, which are not series, are written beneath it. Nothing at all when neither is drawn.
 */
const ChartSlotLegend = ({ keys }: { keys: SlotLegendKeys }) => {
  if (!keys.partial && !keys.missing) { return null }
  return (
    <ul aria-label='Chart marks' className={styles.legend}>
      {keys.partial ? <li className={styles.item}><span aria-hidden className={`${styles.swatch} ${styles.partial}`} />{SO_FAR}</li> : null}
      {keys.missing ? <li className={styles.item}><span aria-hidden className={`${styles.swatch} ${styles.missing}`} />no data</li> : null}
    </ul>
  )
}

export default ChartSlotLegend
