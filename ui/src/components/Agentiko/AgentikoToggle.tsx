/** Header entry point for the agent — "Agentiko". It renders on every install, so the capability
 * is discoverable, in one of three states:
 *
 * - LICENSED and reachable: the Agentiko pill — the brand gradient under a white label — that
 *   opens and closes the rail.
 * - NOT LICENSED (licence.ts: no agent endpoint, or the installer's AGENTIKO_AVAILABLE="false"):
 *   locked — neutral, with a lock — but CLICKABLE: it opens the rail on the "Activate licence"
 *   panel, which says what the agent does and where to get it.
 * - LICENSED but not reachable (the first check has not answered yet, the probe failed, or
 *   agentgateway answered 401/403 for this user): grayed-out and non-clickable with a tooltip,
 *   as before — a dead click that 502s helps nobody, and there is nothing to buy.
 *
 * Sits in HeaderChrome's right slot. */

import { Tooltip } from 'antd'

import { useAgentiko } from './AgentikoProvider'
import styles from './AgentikoToggle.module.css'
import { AGENTIKO_CHECKING, AGENTIKO_UNAVAILABLE } from './copy'
import { AgentikoMark, LockIcon } from './icons'
import { railOpenerRef } from './railFocus'

// ⌘ on Mac, Ctrl elsewhere — for the visible hint only; AgentikoProvider's global handler
// accepts both. Mirrors CommandPalette's own ⌘K hint.
const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)
const shortcutHint = isMac ? '⌘G' : 'Ctrl G'

const AgentikoToggle = () => {
  const { checking, licensed, open, reachable, streaming, toggle } = useAgentiko()

  if (!licensed) {
    return (
      <button
        aria-label='Agentiko — locked, opens the licence panel'
        aria-pressed={open}
        className={`${styles.apToggle} ${styles.locked} ${open ? styles.active : ''}`}
        data-testid='agentiko-toggle-locked'
        onClick={toggle}
        ref={railOpenerRef}
        type='button'
      >
        <LockIcon size={13} />
        Agentiko
      </button>
    )
  }

  const button = (
    <button
      aria-busy={streaming}
      aria-disabled={!reachable}
      aria-pressed={open}
      className={`${styles.apToggle} ${open ? styles.active : ''} ${reachable ? '' : styles.disabled}`}
      disabled={!reachable}
      onClick={reachable ? toggle : undefined}
      ref={railOpenerRef}
      type='button'
    >
      <AgentikoMark size={15} />
      Agentiko
      {/* A8: the one permanently-visible entry point could not show that a turn was in flight —
          the in-rail caret did it correctly, with three separate comments guarding the token, and
          the toggle never consumed `streaming` at all. So a user who collapsed the rail mid-answer
          had no way to tell the agent was still working.

          Signal Yellow is Tier-2 locked to exactly "Agentiko is EXECUTING" (issue #49), which is
          precisely this state — the same token the rail's caret uses, for the same meaning.

          STATIC, not blinking. The rail's caret blinks because it sits at the end of streaming
          text where motion reads as "more is coming"; a permanent blink in the page header is the
          looping animation G13 objects to — reporting nothing after the first second and moving in
          the corner of the eye of someone trying to read. Presence is the signal here. */}
      {streaming ? <span aria-hidden className={styles.executing} /> : null}
      {/* No point advertising the shortcut while it can't do anything — the global handler
          itself is gated on the same `reachable` flag (AgentikoProvider.tsx). */}
      {reachable ? <kbd className={styles.kbd}>{shortcutHint}</kbd> : null}
    </button>
  )

  if (reachable) {
    return button
  }

  // A disabled <button> swallows pointer events, so wrap it in a span the Tooltip can hover over.
  return (
    <Tooltip title={checking ? AGENTIKO_CHECKING : AGENTIKO_UNAVAILABLE}>
      <span className={styles.disabledWrap}>{button}</span>
    </Tooltip>
  )
}

export default AgentikoToggle
