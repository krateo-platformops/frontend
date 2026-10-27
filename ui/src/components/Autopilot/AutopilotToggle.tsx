/** Header entry point for the Autopilot rail. Renders whenever Autopilot is ENABLED (endpoint
 * configured / dev echo). When the agent is not REACHABLE (installer flag AUTOPILOT_AVAILABLE="false",
 * e.g. agents not deployed/licensed, or the runtime reachability probe fails — including a 401/403 from
 * agentgateway, i.e. this user may not drive the agent) the toggle stays visible
 * but grayed-out and non-clickable, with a tooltip — so the capability is discoverable without being a
 * dead click that 502s. Sits in HeaderChrome's right slot. */

import { Tooltip } from 'antd'

import { useAutopilot } from './AutopilotProvider'
import styles from './AutopilotToggle.module.css'
import { AUTOPILOT_UNAVAILABLE } from './copy'
import { SparkIcon } from './icons'

// ⌘ on Mac, Ctrl elsewhere — for the visible hint only; AutopilotProvider's global handler
// accepts both. Mirrors CommandPalette's own ⌘K hint.
const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)
const shortcutHint = isMac ? '⌘G' : 'Ctrl G'

const AutopilotToggle = () => {
  const { enabled, open, reachable, streaming, toggle } = useAutopilot()

  if (!enabled) {
    return null
  }

  const button = (
    <button
      aria-busy={streaming}
      aria-disabled={!reachable}
      aria-pressed={open}
      className={`${styles.apToggle} ${open ? styles.active : ''} ${reachable ? '' : styles.disabled}`}
      disabled={!reachable}
      onClick={reachable ? toggle : undefined}
      type='button'
    >
      <SparkIcon size={13} />
      Autopilot
      {/* A8: the one permanently-visible entry point could not show that a turn was in flight —
          the in-rail caret did it correctly, with three separate comments guarding the token, and
          the toggle never consumed `streaming` at all. So a user who collapsed the rail mid-answer
          had no way to tell the agent was still working.

          Signal Yellow is Tier-2 locked to exactly "Autopilot is EXECUTING" (issue #49), which is
          precisely this state — the same token the rail's caret uses, for the same meaning.

          STATIC, not blinking. The rail's caret blinks because it sits at the end of streaming
          text where motion reads as "more is coming"; a permanent blink in the page header is the
          looping animation G13 objects to — reporting nothing after the first second and moving in
          the corner of the eye of someone trying to read. Presence is the signal here. */}
      {streaming ? <span aria-hidden className={styles.executing} /> : null}
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
    <Tooltip title={AUTOPILOT_UNAVAILABLE}>
      <span className={styles.disabledWrap}>{button}</span>
    </Tooltip>
  )
}

export default AutopilotToggle
