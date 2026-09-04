/** Header entry point for the Autopilot rail. Renders whenever Autopilot is ENABLED (endpoint
 * configured / dev echo). When the agent is not REACHABLE (installer flag AUTOPILOT_AVAILABLE="false",
 * e.g. agents not deployed/licensed, or the runtime reachability probe fails — including a 401/403 from
 * agentgateway, i.e. this user may not drive the agent) the toggle stays visible
 * but grayed-out and non-clickable, with a tooltip — so the capability is discoverable without being a
 * dead click that 502s. Sits in HeaderChrome's right slot. */

import { Tooltip } from 'antd'

import { useAutopilot } from './AutopilotProvider'
import styles from './AutopilotToggle.module.css'
import { SparkIcon } from './icons'

// ⌘ on Mac, Ctrl elsewhere — for the visible hint only; AutopilotProvider's global handler
// accepts both. Mirrors CommandPalette's own ⌘K hint.
const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)
const shortcutHint = isMac ? '⌘G' : 'Ctrl G'

const AutopilotToggle = () => {
  const { enabled, open, reachable, toggle } = useAutopilot()

  if (!enabled) {
    return null
  }

  const button = (
    <button
      aria-disabled={!reachable}
      aria-pressed={open}
      className={`${styles.apToggle} ${open ? styles.active : ''} ${reachable ? '' : styles.disabled}`}
      disabled={!reachable}
      onClick={reachable ? toggle : undefined}
      type='button'
    >
      <SparkIcon size={13} />
      Autopilot
      {/* No point advertising the shortcut while it can't do anything — the global handler
          itself is gated on the same `reachable` flag (AutopilotProvider.tsx). */}
      {reachable ? <kbd className={styles.kbd}>{shortcutHint}</kbd> : null}
    </button>
  )

  if (reachable) {
    return button
  }

  // A disabled <button> swallows pointer events, so wrap it in a span the Tooltip can hover over.
  return (
    <Tooltip title='Autopilot is unavailable — the agent is not deployed, not reachable, or not permitted for your user'>
      <span className={styles.disabledWrap}>{button}</span>
    </Tooltip>
  )
}

export default AutopilotToggle
