/**
 * VOICE STORE — the dictation session, at module scope. Voice spec FR 42–45, 62, 63.
 *
 * WHY MODULE-LEVEL, exactly as `conversationStore.ts` and `composerDraftStore.ts` are.
 * The rail hangs under `<RouterProvider key={routerVersion}>`; a routes-as-data reload
 * remounts that whole subtree and resets every `useState`. Mid-dictation that would kill
 * the microphone with no UI left to stop it, or orphan an in-flight upload whose result
 * has nowhere to land. So the live `MediaStream`, the recorder handle and the in-flight
 * `AbortController` all live OUT HERE, and a rail that re-mounts while this store is
 * `listening` re-hydrates into `listening` with the same timer (FR 42, 63).
 *
 * KNOWN GAP, stated plainly: end to end in the app that remount still ENDS the dictation,
 * because two things outside this file kill it on the way through — `AgentikoProvider`'s
 * unmount cleanup, and the rail's `open` flag, which is component state and so comes back
 * `false`, firing the collapse teardown. Closing the gap means making `open` survive the
 * remount too; until then the microphone is stopped rather than left running behind a rail
 * that came back shut. See the comment on that cleanup in `AgentikoProvider.tsx`.
 *
 * THE ONE WAY IN AND OUT:
 *
 *     microphone ─► recorder.ts ─► transcribe.ts ─► composerDraftStore.appendDictatedSegment
 *
 * The last hop is the seam the composer draft store was built for. The transcript enters
 * the draft through the SAME path typed text uses (FR 62) — never by DOM mutation, so the
 * textarea's OpenAPI paste capture is not tripped by a transcript — and it lands with the
 * provenance that decides whether the answer is spoken back.
 *
 * CONVERSATION MODE (FR 11, revised by the owner). Pressing the microphone is a spoken
 * TURN, not a dictation aid: when the transcript lands and every word in the draft came
 * from speech, the turn is sent without a Send press, the answer is spoken back (FR 67),
 * and BOTH halves are written into the chat transcript like any typed turn — a spoken
 * exchange leaves exactly the same readable record, which is what an incident review
 * reads afterwards.
 *
 * That does NOT relax the fence. This directory still imports neither the transport nor
 * the provider, and the ESLint rule that makes that structural still stands: the store
 * cannot reach `send()`, it can only report that a spoken turn is COMPLETE. The decision
 * to submit is made outside the fence by the rail, which injects the handler through
 * `installConversationSink` — the same dependency arrow as `installTranscribeDeps`, which
 * carries the portal bearer, the rate-limit detector and the session resume in.
 *
 * A draft the keyboard has touched is never auto-sent. `appendDictatedSegment` keeps a
 * typed draft `typed` forever, so a half-written question you are dictating INTO stays
 * yours to send: the sink fires only on a `dictated` draft.
 *
 * BARGE-IN (FR 75): starting capture CANCELS speak-back first, before the microphone is
 * opened, so the synthesiser is never recorded reading the previous answer back.
 */

import { agentikoComposerDraftStore } from '../composerDraftStore'

import type { VoiceCapability } from './capability'
import { detectVoiceCapability, voiceUnavailableMessage } from './capability'
import type { VoiceErrorCode } from './errors'
import { asVoiceError, VoiceError } from './errors'
import type { MicrophonePermission } from './permission'
import type { RecorderDeps, RecordingResult, RecordingSession } from './recorder'
import { browserRecorderDeps, MAX_RECORDING_MS, startRecording } from './recorder'
import { agentikoSpeakBackStore } from './speak/speakBackStore'
import type { TranscribeDeps } from './transcribe'
import { transcribeRecording } from './transcribe'
import { textTokenEstimate } from './voicePrompt'

/** FR 25: the whole transcribing phase, including the one `content_filter` retry. */
export const PHASE_TIMEOUT_MS = 30_000
/** FR 25: after this the status copy admits it is taking a while. */
export const SLOW_NOTICE_MS = 5_000

export type VoicePhase = 'error' | 'idle' | 'listening' | 'transcribing'

export interface VoiceState {
  capability: VoiceCapability
  /** Milliseconds captured so far, for the m:ss timer. */
  elapsedMs: number
  error: { code: VoiceErrorCode; message: string } | null
  /** A non-error note — the 60-second auto-stop says so rather than failing (FR 12). */
  info: string | null
  /** 0..1, the live meter. */
  level: number
  permission: MicrophonePermission
  phase: VoicePhase
  /** FR 25: "Still transcribing…" after five seconds. */
  slow: boolean
}

export interface VoiceStore {
  /** FR 13/44/63: discard everything — no upload, nothing appended, draft untouched. */
  cancel: () => void
  /** FR 22: clear the error line (a keystroke in the textarea, or the next press). */
  dismissError: () => void
  getSnapshot: () => VoiceState
  /**
   * Wire the SEND half of conversation mode. Called with the full spoken draft the moment
   * a transcript completes a purely-dictated draft; the rail submits it. `null` unwires,
   * which returns the microphone to fill-the-composer dictation.
   */
  installConversationSink: (sink: ((text: string) => void) | null) => void
  /** Replace the capture seam. Production passes the browser deps; tests pass a fake. */
  installRecorderDeps: (deps: RecorderDeps | null) => void
  /** Wire the pieces that live outside the voice fence (bearer, rate limit, resume). */
  installTranscribeDeps: (deps: TranscribeDeps | null) => void
  /** FR 5: one console line naming why dictation is unavailable, at most once. */
  logUnavailableOnce: (origin: string) => void
  /** FR 6: re-evaluate capability (config load, window focus) without a reload. */
  setCapabilityInput: (input: { language?: string; transcribeUrl?: string }) => void
  /** Page-context names for the vocabulary bias (FR 54). Already redacted by the caller. */
  setContextNames: (names: readonly string[]) => void
  setPermission: (permission: MicrophonePermission) => void
  /** Begin capture. No-op when already active, unavailable, or blocked (FR 45). */
  start: () => void
  /** End capture and transcribe what was said. No-op unless listening. */
  stop: () => void
  subscribe: (listener: () => void) => () => void
  /** The control's single action: start when idle, stop when listening. */
  toggle: () => void
}

const IDLE: VoiceState = {
  capability: { available: false, reason: 'insecure-context' },
  elapsedMs: 0,
  error: null,
  info: null,
  level: 0,
  permission: 'prompt',
  phase: 'idle',
  slow: false,
}

/** FR 12: said as information, not as a failure — what was said is still transcribed. */
export const MAX_DURATION_NOTICE = 'Stopped at 60 s — transcribing what was said.'

/** FR 31: the live-region strings, announced once each as the phase moves. */
export const VOICE_ANNOUNCEMENTS = Object.freeze({
  cancelled: 'Dictation cancelled',
  listening: 'Listening',
  nothing: 'Nothing added',
  /** Conversation mode: the spoken turn went to the agent without a Send press. */
  sent: 'Sent',
  transcribing: 'Transcribing…',
})

/** The default language hint. Read at start so a language switch mid-session is honoured. */
const uiLanguage = (): string => {
  try {
    return (globalThis as { navigator?: { language?: string } }).navigator?.language || 'en-US'
  } catch {
    return 'en-US'
  }
}

export const createVoiceStore = (
  initialRecorderDeps: RecorderDeps | null = browserRecorderDeps(),
): VoiceStore => {
  const listeners = new Set<() => void>()
  let state: VoiceState = IDLE
  let recorderDeps = initialRecorderDeps
  let transcribeDeps: TranscribeDeps | null = null
  let transcribeUrl: string | undefined
  let languageOverride: string | undefined
  let contextNames: readonly string[] = []
  let session: RecordingSession | null = null
  // WHY AN ATTEMPT ID AND NOT JUST THE PHASE. `startRecording` is asynchronous — it is
  // pending for as long as the browser's permission bubble is on screen — and `cancel()`
  // returns the phase to `idle` without invalidating it. So press → Cancel → press, all
  // inside that window, leaves TWO pending opens whose `.then`s both find `phase ===
  // 'listening'` and both claim the single `session` slot. The loser is unreachable but
  // still wired to these handlers: its microphone stays open with the tab's recording
  // indicator lit, and at its silence auto-stop it uploads and appends a transcript from
  // the session the user cancelled. The id says WHICH attempt a callback belongs to; every
  // teardown bumps it, so a disowned attempt can only cancel itself.
  let attemptId = 0
  // A Stop pressed before the microphone finished opening has nothing to stop yet. Holding
  // the intent here (rather than dropping it) stops the press from being silently swallowed
  // and the recording from running on to its own auto-stop.
  let stopRequested = false
  let controller: AbortController | null = null
  let conversationSink: ((text: string) => void) | null = null
  let phaseTimer: ReturnType<typeof setTimeout> | null = null
  let slowTimer: ReturnType<typeof setTimeout> | null = null
  let logged = false

  const emit = (): void => {
    for (const listener of listeners) {
      listener()
    }
  }

  const set = (patch: Partial<VoiceState>): void => {
    const next = { ...state, ...patch }
    const changed = (Object.keys(next) as (keyof VoiceState)[]).some((key) => next[key] !== state[key])
    if (!changed) {
      return
    }
    state = next
    emit()
  }

  /** The live region is speak-back's (FR 31), and it stays silent while speech plays. */
  const announce = (text: string): void => agentikoSpeakBackStore.announce(text)

  const clearTimers = (): void => {
    if (phaseTimer !== null) {
      clearTimeout(phaseTimer)
      phaseTimer = null
    }
    if (slowTimer !== null) {
      clearTimeout(slowTimer)
      slowTimer = null
    }
  }

  const fail = (error: VoiceError): void => {
    clearTimers()
    attemptId += 1
    stopRequested = false
    session = null
    controller = null
    set({
      elapsedMs: 0,
      error: { code: error.code, message: error.message },
      info: null,
      level: 0,
      phase: 'error',
      slow: false,
    })
    // `no-speech` and `no-audio` both mean "nothing was added" — say so, because the
    // silence of an unchanged composer is exactly what a fabrication would also look like
    // if it had gone the other way.
    announce(error.code === 'no-speech' || error.code === 'no-audio' ? VOICE_ANNOUNCEMENTS.nothing : error.message)
  }

  const refreshCapability = (): void => set({ capability: detectVoiceCapability(transcribeUrl) })

  /** THE SEAM. Everything above this line exists to make these two lines trustworthy. */
  const commit = (text: string): void => {
    agentikoComposerDraftStore.appendDictatedSegment(text)
    const words = text.trim().split(/\s+/).filter(Boolean).length
    const draft = agentikoComposerDraftStore.getSnapshot()
    // CONVERSATION MODE. A draft that is entirely spoken completes a turn on its own: the
    // sink the rail injected sends it, so speaking IS the send gesture. The gate is the
    // draft's provenance rather than "did dictation just run", which is what keeps a
    // half-typed question the user is dictating into (`typed`, permanently) from being
    // sent out from under them mid-edit.
    if (conversationSink && draft.provenance === 'dictated' && draft.text.trim()) {
      // Announce the SEND, not the word count: in conversation mode the words are already
      // on their way, and "Added 7 words" would describe a composer the user never sees.
      announce(VOICE_ANNOUNCEMENTS.sent)
      conversationSink(draft.text)
      return
    }
    announce(`Added ${words} ${words === 1 ? 'word' : 'words'}`)
  }

  const transcribe = async (recording: RecordingResult): Promise<void> => {
    const deps = transcribeDeps
    if (!deps) {
      fail(new VoiceError('engine'))
      return
    }
    controller = new AbortController()
    const local = controller
    clearTimers()
    phaseTimer = setTimeout(() => {
      // Abort AND end the phase here. The abort alone unwinds only a promise that is
      // actually waiting on a fetch, and the longest stretch of this phase may not be:
      // between a 401 and its retry the call is parked on the session-resume modal, which
      // the user can leave open indefinitely. Without this the rail would sit in
      // `transcribing` for all of it, with Send held and no way out but Cancel.
      local.abort()
      if (controller === local && state.phase === 'transcribing') {
        fail(new VoiceError('timeout'))
      }
    }, PHASE_TIMEOUT_MS)
    slowTimer = setTimeout(() => {
      if (state.phase === 'transcribing') {
        set({ slow: true })
      }
    }, SLOW_NOTICE_MS)
    // `info` is deliberately NOT cleared here: the 60-second note reads "…transcribing what
    // was said", so it belongs to this phase, and it is the only signal the user has that
    // their sentence was cut short at the cap. It survives until the next press or keystroke.
    set({ elapsedMs: 0, error: null, level: 0, phase: 'transcribing', slow: false })
    announce(VOICE_ANNOUNCEMENTS.transcribing)

    try {
      const outcome = await transcribeRecording(
        deps,
        { contextNames, language: languageOverride ?? uiLanguage(), recording },
        local.signal,
      )
      if (local !== controller || local.signal.aborted) {
        // Cancelled, timed out, or superseded while in flight: the result belongs to a
        // session the user has already abandoned, so it is dropped rather than appended.
        return
      }
      clearTimers()
      controller = null
      // FR 61: the arithmetic, at debug, on EVERY call — not only on the failures. The
      // floor of 8 tokens/second is calibrated on one measurement, in WAV, a format FR 27
      // then forbids us from sending; nobody has measured the rate for the Opus we
      // actually ship. This line is the only thing that will produce that number from real
      // use (release check V11a), and without it a floor set too high looks exactly like
      // flaky transcription rather than like a threshold to move.
      // eslint-disable-next-line no-console
      console.debug('[agentiko] dictation transcribed', {
        audioTokensPerSecond: (outcome.promptTokens - textTokenEstimate(outcome.textPromptChars)) / Math.max(0.1, recording.seconds),
        promptTokens: outcome.promptTokens,
        seconds: recording.seconds,
        textPromptChars: outcome.textPromptChars,
        textTokenEstimate: textTokenEstimate(outcome.textPromptChars),
      })
      set({ error: null, phase: 'idle', slow: false })
      commit(outcome.text)
    } catch (thrown) {
      if (local !== controller) {
        return
      }
      // An abort is either the user's cancel (already reflected in state) or the phase
      // budget running out; only the latter is an error the user needs to see.
      if (local.signal.aborted) {
        if (state.phase === 'transcribing') {
          fail(new VoiceError('timeout'))
        }
        return
      }
      fail(asVoiceError(thrown))
    }
  }

  const start = (): void => {
    if (state.phase === 'listening' || state.phase === 'transcribing') {
      return
    }
    const { capability } = state
    const deps = recorderDeps
    if (!capability.available || state.permission === 'denied' || !deps) {
      return
    }
    // BARGE-IN (FR 75): silence the synthesiser BEFORE the microphone opens, so an answer
    // being read aloud is never recorded back into the next question.
    agentikoSpeakBackStore.cancel()
    const { mimeType } = capability
    // This attempt's identity. Every callback below is scoped to it, so a press that has
    // since been cancelled and replaced cannot speak for the store — see `attemptId`.
    attemptId += 1
    const mine = attemptId
    stopRequested = false
    const mineIsCurrent = (): boolean => mine === attemptId
    set({ elapsedMs: 0, error: null, info: null, level: 0, phase: 'listening', slow: false })
    announce(VOICE_ANNOUNCEMENTS.listening)

    void startRecording(deps, mimeType, {
      onAutoStop: (reason) => {
        if (mineIsCurrent()) {
          set({ info: reason === 'max-duration' ? MAX_DURATION_NOTICE : null })
        }
      },
      onError: (error) => {
        if (!mineIsCurrent()) {
          return
        }
        session = null
        fail(error)
      },
      onLevel: (level) => {
        if (mineIsCurrent() && state.phase === 'listening') {
          set({ level })
        }
      },
      onResult: (recording) => {
        // An abandoned attempt reaching its own auto-stop must NOT transcribe: that upload
        // is audio the user cancelled, and its transcript would land in a composer that has
        // moved on. Dropped here, before any network call.
        if (!mineIsCurrent()) {
          return
        }
        session = null
        void transcribe(recording)
      },
      onTick: (elapsedMs) => {
        if (mineIsCurrent() && state.phase === 'listening') {
          set({ elapsedMs: Math.min(elapsedMs, MAX_RECORDING_MS) })
        }
      },
    }).then((started) => {
      // A cancel that lands between the press and the microphone actually opening must not
      // leave a live recorder behind. The ATTEMPT is the authority, not the phase: a second
      // press inside the same window puts the phase back to `listening`, which would let
      // this stale resolution adopt a recorder nothing can reach.
      if (!mineIsCurrent() || state.phase !== 'listening') {
        started.cancel()
        return
      }
      session = started
      if (stopRequested) {
        stopRequested = false
        started.stop()
      }
    }).catch((thrown: unknown) => {
      if (!mineIsCurrent()) {
        return
      }
      session = null
      fail(asVoiceError(thrown))
    })
  }

  const stop = (): void => {
    if (state.phase !== 'listening') {
      return
    }
    if (!session) {
      // The microphone is still opening (the permission bubble is up). Record the intent;
      // the resolution above honours it. Dropping the press here would leave the user
      // pressing Stop on a rail that says LISTENING and recording for eight more seconds.
      stopRequested = true
      return
    }
    session.stop()
  }

  const cancel = (): void => {
    const wasActive = state.phase === 'listening' || state.phase === 'transcribing'
    clearTimers()
    // Disown any attempt still opening the microphone BEFORE clearing the slot, so its
    // resolution cancels itself instead of adopting the store.
    attemptId += 1
    stopRequested = false
    session?.cancel()
    session = null
    controller?.abort()
    controller = null
    set({ elapsedMs: 0, error: null, info: null, level: 0, phase: 'idle', slow: false })
    if (wasActive) {
      announce(VOICE_ANNOUNCEMENTS.cancelled)
    }
  }

  refreshCapability()

  return {
    cancel,
    dismissError: () => {
      if (state.phase === 'error' || state.error || state.info) {
        set({ error: null, info: null, phase: state.phase === 'error' ? 'idle' : state.phase })
      }
    },
    getSnapshot: () => state,
    installConversationSink: (sink) => {
      conversationSink = sink
    },
    installRecorderDeps: (deps) => {
      cancel()
      recorderDeps = deps
    },
    installTranscribeDeps: (deps) => {
      transcribeDeps = deps
    },
    logUnavailableOnce: (origin) => {
      const { capability } = state
      if (logged || capability.available) {
        return
      }
      logged = true
      // eslint-disable-next-line no-console
      console.info(voiceUnavailableMessage(capability.reason, origin))
    },
    setCapabilityInput: ({ language, transcribeUrl: url }) => {
      transcribeUrl = url
      languageOverride = language
      refreshCapability()
    },
    setContextNames: (names) => { contextNames = names },
    setPermission: (permission) => {
      if (permission === state.permission) {
        return
      }
      // FR 19: a revocation lands MID-RECORDING too — capture is aborted and the recording
      // discarded, and the draft is left exactly as it was.
      if (permission === 'denied' && (state.phase === 'listening' || state.phase === 'transcribing')) {
        cancel()
      }
      set({ permission })
    },
    start,
    stop,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    toggle: () => {
      if (state.phase === 'listening') {
        stop()
        return
      }
      if (state.phase === 'transcribing') {
        return
      }
      // FR 22: pressing Dictate clears the previous attempt's error line.
      if (state.error || state.info) {
        set({ error: null, info: null, phase: 'idle' })
      }
      start()
    },
  }
}

/**
 * The app-wide singleton. Module scope, so it outlives every rail/provider remount — the
 * whole reason this is a store and not component state. One rail per app → one microphone.
 */
export const agentikoVoiceStore = createVoiceStore()
