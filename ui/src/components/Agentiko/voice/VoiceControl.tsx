/**
 * DICTATION CHROME — the microphone button and the status row, kept out of
 * `AgentikoRail.tsx` so the rail stays inside its 500-line budget.
 * Voice spec FR 1, 7, 12, 18, 21, 25, 29–36.
 *
 * THE MICROPHONE IS ALWAYS THERE (decided 2026-11-10, superseding the original "render
 * nothing when unavailable"). A control that exists on one portal and silently does not on
 * another tells the person looking for it nothing — not that the feature exists, not why
 * it is off here, not who could turn it on. So wherever dictation cannot work the control
 * is rendered DISABLED AND EXPLAINED, and every reason gets the treatment the blocked
 * microphone already had:
 *
 *   · it keeps its place in the tab order (`aria-disabled`, still focusable, FR 29);
 *   · its accessible name says WHY ("Dictate — needs HTTPS"), because the name is the one
 *     string every assistive technology reads;
 *   · the full reason is in a tooltip reachable by keyboard AND behind `aria-describedby`.
 *
 * When several things are wrong the control names ONE, in a fixed precedence: not set up,
 * then needs HTTPS, then not supported here (that order is `detectVoiceCapability`'s), and
 * only then microphone blocked — a permission means nothing where nothing can record.
 *
 * A DISABLED CONTROL NEVER RECORDS. The press handler returns before touching the store,
 * and the store's own `start()` independently refuses an unavailable capability or a denied
 * permission, so neither layer alone stands between a click and an open microphone.
 *
 * Raw `<button>` + CSS modules + the inline stroke SVGs from `icons.tsx`: this is app
 * chrome under `src/components/`, where the antd-mirror rule does not bind. antd's
 * `Tooltip` is the one antd component used, for the one control that needs explaining.
 */

import { Tooltip } from 'antd'
import { useSyncExternalStore } from 'react'

import styles from '../AgentikoRail.module.css'
import { MicIcon, MicOffIcon, SpinnerIcon } from '../icons'

import type { VoiceCapability } from './capability'
import { VOICE_UNAVAILABLE_COPY } from './capability'
import type { MicrophonePermission } from './permission'
import { MICROPHONE_BLOCKED_HINT } from './permission'
import { MAX_RECORDING_MS } from './recorder'
import { agentikoVoiceStore } from './voiceStore'

const useVoice = () => useSyncExternalStore(agentikoVoiceStore.subscribe, agentikoVoiceStore.getSnapshot)

/** FR 25: the rail holds Send while a transcription is in flight. */
export const useVoiceBusy = (): boolean => useVoice().phase === 'transcribing'

/** FR 32: the id a disabled button's `aria-describedby` points at. */
export const VOICE_DISABLED_HINT_ID = 'agentiko-voice-disabled-hint'

/** What a disabled control says: its accessible name, and the reason behind it. */
export interface VoiceDisabledCopy {
  hint: string
  label: string
}

const BLOCKED_COPY: VoiceDisabledCopy = Object.freeze({
  hint: MICROPHONE_BLOCKED_HINT,
  label: 'Dictate — microphone blocked',
})

/**
 * Why the control cannot be pressed, or `null` when it can. The precedence IS the order of
 * these checks: the capability's own reason first (not set up → needs HTTPS → not supported
 * here, as `detectVoiceCapability` orders them), then a denied permission.
 */
export const voiceDisabledCopy = (
  capability: VoiceCapability,
  permission: MicrophonePermission,
): VoiceDisabledCopy | null => {
  if (!capability.available) {
    return VOICE_UNAVAILABLE_COPY[capability.reason]
  }
  return permission === 'denied' ? BLOCKED_COPY : null
}

const VoiceGlyph = ({ busy, disabled }: { busy: boolean; disabled: boolean }) => {
  if (disabled) {
    return <MicOffIcon />
  }
  return busy ? <SpinnerIcon className={styles.apVoiceSpin} /> : <MicIcon />
}

const mmss = (elapsedMs: number): string => {
  const total = Math.floor(Math.max(0, elapsedMs) / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * The microphone, between the textarea and Send. Always rendered: idle, listening,
 * transcribing, or disabled with its reason.
 *
 * `aria-pressed` reflects listening rather than a separate "stop" control, because there
 * is one affordance with two meanings and a screen-reader user needs to know which one it
 * currently has (FR 30).
 */
export const VoiceButton = () => {
  const { capability, permission, phase } = useVoice()
  const disabled = voiceDisabledCopy(capability, permission)
  const listening = phase === 'listening'
  const busy = phase === 'transcribing'
  const label = disabled?.label ?? (listening ? 'Stop dictating' : 'Dictate')
  const className = [
    styles.apVoice,
    listening ? styles.listening : '',
    busy ? styles.busy : '',
    disabled ? styles.blocked : '',
  ].filter(Boolean).join(' ')

  const button = (
    <button
      aria-busy={busy}
      aria-describedby={disabled ? VOICE_DISABLED_HINT_ID : undefined}
      aria-disabled={disabled !== null || busy}
      aria-label={label}
      aria-pressed={listening}
      className={className}
      data-testid='agentiko-voice-button'
      onClick={() => {
        // A disabled control does nothing on press: no prompt (FR 18 — for a blocked
        // permission the browser would not show one anyway), no microphone, no upload. The
        // tooltip is where the actual reason lives.
        if (disabled || busy) {
          return
        }
        agentikoVoiceStore.toggle()
      }}
      title={disabled ? disabled.hint : label}
      type='button'
    >
      <VoiceGlyph busy={busy} disabled={disabled !== null} />
    </button>
  )

  if (!disabled) {
    return button
  }
  // FR 32: the reason is reachable BOTH as a tooltip and via `aria-describedby`, because a
  // hover-only explanation is not an explanation for a keyboard or screen-reader user —
  // and every one of these reasons is fixed somewhere outside the page.
  //
  // The Tooltip wraps a SPAN rather than the button itself: rc-trigger clones its child and
  // writes its own `aria-describedby` (undefined while the tooltip is closed), which would
  // silently clobber the one pointing at the reason below.
  //
  // `focus` is in the trigger list because antd's default is hover ONLY: tabbing onto the
  // control showed nothing. React's `onFocus` bubbles (it is `focusin`), so the span's
  // trigger fires when the button inside it takes keyboard focus.
  return (
    <>
      <Tooltip title={disabled.hint} trigger={['hover', 'focus']}>
        <span className={styles.apVoiceTip}>{button}</span>
      </Tooltip>
      <span className={styles.apSrOnly} id={VOICE_DISABLED_HINT_ID}>{disabled.hint}</span>
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
