/**
 * SPEAK-BACK CHROME — the two surfaces the feature needs in the rail, kept out of
 * AgentikoRail.tsx so the rail stays inside its 500-line budget.
 *
 *   SpeakBackToggle  — the preference, in the rail header beside New thread and Collapse.
 *   SpeakBackStatus  — the speaking indicator + Stop, the FR 78 refusal recovery, the
 *                      FR 77 first-use line, and the FR 31 live region.
 *
 * WHY THE PREFERENCE IS HERE AND NOT ON A MESSAGE. The owner's trigger decision removes
 * the per-message "Read aloud" control the published spec proposed, so there is no
 * per-answer surface to hang an on/off switch on. And it cannot live behind a menu: there
 * is no `prefers-reduced-motion` equivalent for audio, and no reliable way to detect a
 * screen reader, so the off switch has to be findable BEFORE the first answer is ever
 * spoken by someone who does not want to be spoken to (FR 76/77).
 *
 * WHY STOP IS IN THE STATUS ROW AND NOT ON SEND. By the time speech runs, the turn has
 * finalized and the composer button has already reverted from the turn-level Stop back to
 * Send — reusing it would mean one control with two different meanings a second apart.
 *
 * Raw `<button>` + CSS modules + the inline stroke SVGs from `icons.tsx`: this is app
 * chrome under `src/components/`, where the antd-mirror rule does not bind.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'

import styles from '../../AgentikoRail.module.css'
import { SpeakerIcon, SpeakerOffIcon } from '../../icons'

import { agentikoSpeakBackStore } from './speakBackStore'

const useSpeakBack = () => useSyncExternalStore(agentikoSpeakBackStore.subscribe, agentikoSpeakBackStore.getSnapshot)

/** The header toggle's DOM id, so a control that unmounts itself can hand focus to it. */
export const SPEAK_BACK_TOGGLE_ID = 'agentiko-speakback-toggle'

/** The header preference. Absent entirely when speak-back is unavailable (FR 79) — no
 *  control and no copy, exactly as the capture half does when the context is insecure. */
export const SpeakBackToggle = () => {
  const { available, enabled } = useSpeakBack()
  if (!available) {
    return null
  }
  const label = enabled
    ? 'Reading answers aloud is on — answers to spoken questions are read back'
    : 'Reading answers aloud is off'
  return (
    <button
      aria-label={label}
      aria-pressed={enabled}
      className={`${styles.apIc} ${enabled ? styles.apIcActive : ''}`}
      data-testid='agentiko-speakback-toggle'
      id={SPEAK_BACK_TOGGLE_ID}
      onClick={() => agentikoSpeakBackStore.toggleEnabled()}
      title={label}
      type='button'
    >
      {enabled ? <SpeakerIcon /> : <SpeakerOffIcon />}
    </button>
  )
}

/**
 * The composer-side row. Renders nothing at all in the common case — a typed turn, or a
 * finished answer — so the composer's resting DOM is unchanged by this feature.
 *
 * The live region is the exception: FR 31 mounts it ALWAYS, even empty, because a region
 * added to the DOM at the moment it has something to say is announced unreliably. It is
 * visually hidden (its content duplicates what the row already shows sighted users) and
 * the store keeps it silent for the whole time speech is playing, so a screen-reader user
 * does not hear the answer twice.
 */
export const SpeakBackStatus = () => {
  const { announcement, available, enabled, noticeVisible, refusedMessageId, speaking } = useSpeakBack()
  const stopRef = useRef<HTMLButtonElement>(null)
  // Set only by the Play-answer click below. Speech that starts on its own must NEVER move
  // focus (FR 77) — this is the one case where the user pressed a button that then replaced
  // itself, and leaving them on <body> would put Stop at the far end of the tab order (the
  // rail renders after the whole app shell).
  const claimStopFocus = useRef(false)

  useEffect(() => {
    if (speaking && claimStopFocus.current) {
      stopRef.current?.focus()
    }
    claimStopFocus.current = false
  }, [speaking])

  // ESCAPE STOPS SPEECH FROM ANYWHERE (FR 75), not only from the textarea: a draft sent by
  // CLICKING Send leaves focus on the Send button, and a user re-reading the transcript has
  // focus somewhere else entirely — in both cases the composer's own key handler never sees
  // the key. Bound only while audio is actually playing, so it cannot swallow anyone else's
  // Escape, and it neither preventDefaults nor stops propagation.
  useEffect(() => {
    if (!speaking) {
      return undefined
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        agentikoSpeakBackStore.cancel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [speaking])

  return (
    <>
      <div aria-live='polite' className={styles.apSrOnly} data-testid='agentiko-live-region' role='status'>{announcement}</div>
      {speaking ? (
        <div className={styles.apSpeak} data-testid='agentiko-speaking'>
          <span aria-hidden='true' className={styles.apSpeakPulse} />
          <span>Reading the answer aloud</span>
          <button className={styles.apSpeakBtn} onClick={() => agentikoSpeakBackStore.cancel()} ref={stopRef} type='button'>Stop</button>
        </div>
      ) : null}
      {/* The replay is gated on the SAME capability + preference as the first attempt: an
          offer that the off switch or the operator kill-switch has already withdrawn must
          not still be on screen. */}
      {!speaking && refusedMessageId && available && enabled ? (
        <div className={styles.apSpeak} data-testid='agentiko-speak-refused'>
          <span>The browser would not start audio on its own.</span>
          <button
            className={styles.apSpeakBtn}
            onClick={() => { claimStopFocus.current = agentikoSpeakBackStore.replayRefused() }}
            type='button'
          >Play answer</button>
        </div>
      ) : null}
      {noticeVisible && enabled ? (
        <div className={styles.apSpeakNote} data-testid='agentiko-speak-notice'>
          <span>Answers to questions you ask by voice are read aloud.</span>
          {/* Turn off also unmounts its own button, so focus moves to the header control that
              now reflects the choice rather than being dropped on <body>. */}
          <button
            className={styles.apSpeakBtn}
            onClick={() => {
              agentikoSpeakBackStore.setEnabled(false)
              document.getElementById(SPEAK_BACK_TOGGLE_ID)?.focus()
            }}
            type='button'
          >Turn off</button>
          <button aria-label='Dismiss' className={styles.apIc} onClick={() => agentikoSpeakBackStore.dismissNotice()} title='Dismiss' type='button'>×</button>
        </div>
      ) : null}
    </>
  )
}
