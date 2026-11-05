/**
 * DICTATION CHROME — the microphone button and the status row, kept out of
 * `AgentikoRail.tsx` so the rail stays inside its 500-line budget.
 * Voice spec FR 1, 7, 12, 18, 21, 25, 29–36.
 *
 * WHAT IS NOT HERE IS THE POINT: when dictation is unavailable this file renders
 * NOTHING — no greyed microphone, no explanatory copy, no tab stop, no wrapper element.
 * The composer's DOM is byte-identical to what it was before the feature existed (FR 1/4).
 * A permanently disabled microphone on every plain-HTTP portal would be a permanent
 * indicator for the DEFAULT state, which the house rule forbids; and the fix — TLS on the
 * portal and every backend origin — is not something the person looking at the button can
 * do. One `console.info` tells the operator, who can.
 *
 * BLOCKED IS THE OPPOSITE CASE and IS shown. A denied microphone permission is fixable by
 * the person in front of the screen, from the address bar, in seconds — so the control
 * stays visible, keeps its place in the tab order (`aria-disabled`, still focusable, FR 29)
 * and carries the instruction in a tooltip reachable by keyboard.
 *
 * Raw `<button>` + CSS modules + the inline stroke SVGs from `icons.tsx`: this is app
 * chrome under `src/components/`, where the antd-mirror rule does not bind. antd's
 * `Tooltip` is the one antd component used, for the one control that needs explaining.
 */

import { Tooltip } from 'antd'
import { useSyncExternalStore } from 'react'

import styles from '../AgentikoRail.module.css'
import { MicIcon, MicOffIcon, SpinnerIcon } from '../icons'

import { MICROPHONE_BLOCKED_HINT } from './permission'
import { MAX_RECORDING_MS } from './recorder'
import { agentikoVoiceStore } from './voiceStore'

const useVoice = () => useSyncExternalStore(agentikoVoiceStore.subscribe, agentikoVoiceStore.getSnapshot)

/** FR 25: the rail holds Send while a transcription is in flight. */
export const useVoiceBusy = (): boolean => useVoice().phase === 'transcribing'

/** FR 32: the id the blocked button's `aria-describedby` points at. */
export const VOICE_BLOCKED_HINT_ID = 'agentiko-voice-blocked-hint'

/** FR 30: one control, two meanings — the label has to say which one it currently has. */
const buttonLabel = (blocked: boolean, listening: boolean): string => {
  if (blocked) {
    return 'Dictate — microphone blocked'
  }
  return listening ? 'Stop dictating' : 'Dictate'
}

const VoiceGlyph = ({ blocked, busy }: { blocked: boolean; busy: boolean }) => {
  if (blocked) {
    return <MicOffIcon />
  }
  return busy ? <SpinnerIcon className={styles.apVoiceSpin} /> : <MicIcon />
}

const mmss = (elapsedMs: number): string => {
  const total = Math.floor(Math.max(0, elapsedMs) / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * The microphone, between the textarea and Send. Four states and one absence.
 *
 * `aria-pressed` reflects listening rather than a separate "stop" control, because there
 * is one affordance with two meanings and a screen-reader user needs to know which one it
 * currently has (FR 30).
 */
export const VoiceButton = () => {
  const { capability, permission, phase } = useVoice()
  if (!capability.available) {
    return null
  }

  const blocked = permission === 'denied'
  const listening = phase === 'listening'
  const busy = phase === 'transcribing'
  const label = buttonLabel(blocked, listening)
  const className = [
    styles.apVoice,
    listening ? styles.listening : '',
    busy ? styles.busy : '',
    blocked ? styles.blocked : '',
  ].filter(Boolean).join(' ')

  const button = (
    <button
      aria-busy={busy}
      aria-describedby={blocked ? VOICE_BLOCKED_HINT_ID : undefined}
      aria-disabled={blocked || busy}
      aria-label={label}
      aria-pressed={listening}
      className={className}
      data-testid='agentiko-voice-button'
      onClick={() => {
        // A blocked permission triggers NO prompt (FR 18): the browser will not show one,
        // so a press that appears to do nothing is the honest behaviour, and the tooltip
        // is where the actual fix lives.
        if (blocked || busy) {
          return
        }
        agentikoVoiceStore.toggle()
      }}
      title={blocked ? MICROPHONE_BLOCKED_HINT : label}
      type='button'
    >
      <VoiceGlyph blocked={blocked} busy={busy} />
    </button>
  )

  if (!blocked) {
    return button
  }
  // FR 32: the reason is reachable BOTH as a tooltip and via `aria-describedby`, because a
  // hover-only explanation is not an explanation for a keyboard or screen-reader user —
  // and this is the one voice state whose fix is entirely outside the page.
  //
  // The Tooltip wraps a SPAN rather than the button itself: rc-trigger clones its child and
  // writes its own `aria-describedby` (undefined while the tooltip is closed), which would
  // silently clobber the one pointing at the instruction below.
  return (
    <>
      <Tooltip title={MICROPHONE_BLOCKED_HINT}>
        <span className={styles.apVoiceTip}>{button}</span>
      </Tooltip>
      <span className={styles.apSrOnly} id={VOICE_BLOCKED_HINT_ID}>{MICROPHONE_BLOCKED_HINT}</span>
    </>
  )
}

/** The pill's word. "Still transcribing…" only after five seconds (FR 25). */
const phasePill = (listening: boolean, slow: boolean): string => {
  if (listening) {
    return 'listening'
  }
  return slow ? 'still transcribing…' : 'transcribing'
}

/**
 * The composer-side row: the live capture indicator, the neutral auto-stop note, and the
 * error line. Renders nothing at rest, so the resting composer is unchanged.
 *
 * The `role="alert"` on the error line is deliberate and narrow: a failed dictation is the
 * one moment a user MUST hear about, because the composer looking unchanged is exactly
 * what a silent failure and a successful one have in common.
 */
export const VoiceStatus = () => {
  const { capability, elapsedMs, error, info, level, phase, slow } = useVoice()
  if (!capability.available) {
    return null
  }

  const listening = phase === 'listening'
  const transcribing = phase === 'transcribing'
  // The meter is a coarse cue, not a measurement: RMS on speech sits well under 0.3, so
  // the bar is scaled to make ordinary talking fill most of it.
  const levelPercent = Math.min(100, Math.round((level / 0.3) * 100))

  return (
    <>
      {listening || transcribing ? (
        <div className={styles.apVoiceStatus} data-testid='agentiko-voice-status'>
          <span className={styles.apVoicePill}>{phasePill(listening, slow)}</span>
          {listening ? (
            <>
              <span className={styles.apVoiceTimer}>{mmss(elapsedMs)} / {mmss(MAX_RECORDING_MS)}</span>
              <span aria-hidden='true' className={styles.apVoiceLevel}>
                <span className={styles.apVoiceLevelFill} style={{ width: `${levelPercent}%` }} />
              </span>
            </>
          ) : null}
          <button
            className={styles.apVoiceCancel}
            data-testid='agentiko-voice-cancel'
            onClick={() => agentikoVoiceStore.cancel()}
            type='button'
          >Cancel</button>
        </div>
      ) : null}
      {info ? <div className={styles.apVoiceInfo} data-testid='agentiko-voice-info'>{info}</div> : null}
      {error ? (
        <div className={styles.apVoiceError} data-testid='agentiko-voice-error' role='alert'>{error.message}</div>
      ) : null}
    </>
  )
}
