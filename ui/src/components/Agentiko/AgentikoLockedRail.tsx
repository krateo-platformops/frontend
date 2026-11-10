/**
 * The rail when the agent is NOT LICENSED (licence.ts). Same dock, width and header as the live
 * rail, so opening it from the locked toggle — or from an "Ask Agentiko →" button, via the `?ask=`
 * deep-link — reads as the agent's own surface, switched off. It says what Agentiko does and
 * links to where the licence is bought; nothing else is live (no composer, no history).
 *
 * Neutral on purpose: no brand gradient, the gecko in grey. The one coloured control is
 * "Activate licence", in the brand gradient under white — it IS the way to switch the agent on.
 */

import gekoThinking from '../../assets/images/agentiko/geko-thinking.webp'

import styles from './AgentikoRail.module.css'
import { CheckIcon, CloseIcon, CollapseIcon, LockIcon } from './icons'
import { AGENTIKO_LICENCE_URL } from './licence'
import { railRef } from './railFocus'

const CAPABILITIES = [
  'Explains why a composition is failing, from what is on your screen',
  'Proposes a fix, and applies it only after you approve',
  'Drafts pages, charts and controllers for you to review',
]

// `width` is px, or '100%' when the rail takes the whole width (a phone); `sheet` lays it over the
// page on a tablet, closed by a ✕ (railLayout.ts, AgentikoRail.tsx).
const AgentikoLockedRail = ({ onClose, open, sheet, width }: { onClose: () => void; open: boolean; sheet: boolean; width: number | string }) => (
  <aside
    aria-label='Agentiko'
    className={`${styles.apRail} ${styles.apLockedRail} ${open ? styles.open : ''} ${open && sheet ? styles.sheet : ''}`}
    data-testid='agentiko-locked-rail'
    inert={!open}
    ref={railRef}
    style={open ? { width } : undefined}
  >
    <div className={styles.apRailInner}>
      <div className={styles.apHead}>
        <span className={styles.apTitle}><LockIcon className={styles.apLockedIcon} size={16} />Agentiko</span>
        <span className={styles.apSpacer} />
        <button aria-label={sheet ? 'Close Agentiko' : 'Collapse rail'} className={styles.apIc} onClick={onClose} title={sheet ? 'Close Agentiko' : 'Collapse rail'} type='button'>
          {sheet ? <CloseIcon /> : <CollapseIcon />}
        </button>
      </div>
      <div className={styles.apLocked}>
        <img alt='' className={styles.apLockedMascot} decoding='async' height={110} src={gekoThinking} width={92} />
        <div className={styles.apLockedTitle}>Agentiko is part of the licence</div>
        <p className={styles.apLockedText}>An agent that works on this portal with you, on the page you are looking at.</p>
        <ul className={styles.apLockedList}>
          {CAPABILITIES.map((capability) => (
            <li key={capability}><CheckIcon className={styles.apLockedCheck} size={14} />{capability}</li>
          ))}
        </ul>
        <a className={styles.apLockedCta} href={AGENTIKO_LICENCE_URL} rel='noopener noreferrer' target='_blank'>
          Activate licence
        </a>
        <p className={styles.apLockedNote}>The rest of the portal is open source and stays fully available.</p>
      </div>
    </div>
  </aside>
)

export default AgentikoLockedRail
