// @vitest-environment jsdom
/**
 * SPEAK-BACK STORE — the trigger, the capability, the stop triggers, the autoplay refusal
 * and the live region, driven against a FAKE synthesiser.
 *
 * jsdom has no `speechSynthesis` at all, which is exactly why the engine is injectable:
 * these tests hand in a fake and assert on what was spoken, in what order, and what
 * happened when the browser refused.
 *
 * The three trigger cases the owner's decision names — dictated-only speaks,
 * dictated-then-typed does not, typed-only does not — are exercised end to end through the
 * composer store in speakBack.test.tsx; here they are pinned at the `modality` seam.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createComposerDraftStore } from '../../composerDraftStore'

import { createSpeakBackStore, REFUSAL_ANNOUNCEMENT, SPEAK_BACK_NOTICE_KEY, SPEAK_BACK_PREF_KEY } from './speakBackStore'
import type { Speaker, SpeechDeps, SpeechUtteranceLike, SpeechVoiceLike } from './speechEngine'

const LOCAL_EN: SpeechVoiceLike = { lang: 'en-US', localService: true, name: 'Samantha' }
const LOCAL_IT: SpeechVoiceLike = { lang: 'it-IT', localService: true, name: 'Alice' }
/** The trap FR 69 exists for: identical in the picker, synthesises on a vendor's servers. */
const REMOTE_EN: SpeechVoiceLike = { lang: 'en-US', localService: false, name: 'Google US English' }

const fakeSynthesis = (voices: SpeechVoiceLike[]) => {
  const spoken: SpeechUtteranceLike[] = []
  const voicesChanged = new Set<() => void>()
  let cancels = 0
  let inventory = voices
  const deps: SpeechDeps = {
    createUtterance: (text) => ({ onend: null, onerror: null, text }),
    synthesis: {
      addEventListener: (_type, listener) => { voicesChanged.add(listener) },
      cancel: () => { cancels += 1 },
      getVoices: () => inventory,
      removeEventListener: (_type, listener) => { voicesChanged.delete(listener) },
      speak: (utterance) => { spoken.push(utterance) },
    },
  }
  return {
    cancels: () => cancels,
    deps,
    /** Finish every queued utterance, as a real synthesiser would. */
    finish: () => {
      for (let guard = 0; guard < 50 && spoken.length; guard += 1) {
        const utterance = spoken[spoken.length - 1]
        const before = spoken.length
        utterance.onend?.()
        if (spoken.length === before) {
          return
        }
      }
    },
    loadVoices: (next: SpeechVoiceLike[]) => {
      inventory = next
      for (const listener of voicesChanged) {
        listener()
      }
    },
    refuse: () => spoken[spoken.length - 1]?.onerror?.({ error: 'not-allowed' }),
    spoken,
  }
}

const VOICE_TURN = { id: 'a1', modality: 'voice' as const, text: 'Two replicas are Ready.' }

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('capability (FR 69 / 79)', () => {
  it('is available on a plain-HTTP page with a local voice — no secure context needed', () => {
    const store = createSpeakBackStore(fakeSynthesis([LOCAL_EN]).deps)
    expect(store.getSnapshot()).toMatchObject({ available: true, reason: null })
  })

  it('is unavailable when the browser has no speechSynthesis at all', () => {
    const store = createSpeakBackStore(null)
    expect(store.getSnapshot()).toMatchObject({ available: false, reason: 'no-synthesis' })
  })

  it('treats a machine with ONLY remote voices as unavailable — never a silent vendor fallback', () => {
    const fake = fakeSynthesis([REMOTE_EN])
    const store = createSpeakBackStore(fake.deps)
    expect(store.getSnapshot()).toMatchObject({ available: false, reason: 'no-local-voice' })
    expect(store.speakAnswer(VOICE_TURN)).toBe(false)
    expect(fake.spoken).toHaveLength(0)
  })

  it('picks up voices that arrive late, via voiceschanged (0 immediately, 210 after ~800 ms)', () => {
    const fake = fakeSynthesis([])
    const store = createSpeakBackStore(fake.deps)
    expect(store.getSnapshot().available).toBe(false)
    fake.loadVoices([LOCAL_EN])
    expect(store.getSnapshot()).toMatchObject({ available: true, reason: null })
  })

  it('the operator kill-switch removes the feature entirely', () => {
    const store = createSpeakBackStore(fakeSynthesis([LOCAL_EN]).deps)
    store.setConfigValue('off')
    expect(store.getSnapshot()).toMatchObject({ available: false, reason: 'disabled' })
    expect(store.speakAnswer(VOICE_TURN)).toBe(false)
    store.setConfigValue('on')
    expect(store.getSnapshot().available).toBe(true)
  })

  it('logs exactly one console line naming why nothing will be spoken', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const store = createSpeakBackStore(fakeSynthesis([REMOTE_EN]).deps)
    store.logUnavailableOnce()
    store.logUnavailableOnce()
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toMatch(/no local \(on-device\) voice/)
  })
})

describe('the trigger — voice-initiated turns only', () => {
  it('speaks a turn asked BY VOICE', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    expect(store.speakAnswer(VOICE_TURN)).toBe(true)
    expect(store.getSnapshot().speaking).toBe(true)
    expect(fake.spoken.map((utterance) => utterance.text).join(' ')).toContain('Two replicas are Ready.')
  })

  it('never speaks a TYPED turn, however long the answer', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    expect(store.speakAnswer({ ...VOICE_TURN, modality: 'text' })).toBe(false)
    expect(fake.spoken).toHaveLength(0)
    expect(store.getSnapshot().speaking).toBe(false)
  })

  it('a draft the keyboard touched sends a TEXT turn, so the answer stays silent', () => {
    const draft = createComposerDraftStore()
    draft.appendDictatedSegment('scale payments')
    draft.setTypedDraft('scale payments?')
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    expect(store.speakAnswer({ ...VOICE_TURN, modality: draft.turnModality() })).toBe(false)
    expect(fake.spoken).toHaveLength(0)
  })

  it('a purely dictated draft sends a VOICE turn, and the answer is spoken', () => {
    const draft = createComposerDraftStore()
    draft.appendDictatedSegment('scale payments to three replicas')
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    expect(store.speakAnswer({ ...VOICE_TURN, modality: draft.turnModality() })).toBe(true)
    expect(fake.spoken).not.toHaveLength(0)
  })

  it('says nothing when the preference is off, and stops mid-answer when it is turned off', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.speakAnswer(VOICE_TURN)
    store.setEnabled(false)
    expect(store.getSnapshot().speaking).toBe(false)
    expect(store.speakAnswer(VOICE_TURN)).toBe(false)
  })

  it('does NOT speak the chip label — the chip is in the chat, and speech is not the confirm surface', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.speakAnswer({ ...VOICE_TURN, actions: [{ label: 'scale payments to 3', readOnly: false, verb: 'runAction' }] })
    fake.finish()
    const heard = fake.spoken.map((utterance) => utterance.text).join(' ')
    expect(heard).not.toContain('scale payments to 3')
    expect(heard).not.toContain('proposes an action')
  })

  it('speaks with a LOCAL voice, preferring the exact language, never the remote one', () => {
    const fake = fakeSynthesis([REMOTE_EN, LOCAL_IT, LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.speakAnswer(VOICE_TURN)
    expect(fake.spoken[0].voice).toBe(LOCAL_EN)
  })
})

describe('stopping (FR 45 / 75)', () => {
  it('cancel() silences the queue and clears the speaking flag', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.speakAnswer({ ...VOICE_TURN, text: 'One. Two. Three. Four.' })
    const before = fake.cancels()
    store.cancel()
    expect(fake.cancels()).toBeGreaterThan(before)
    expect(store.getSnapshot().speaking).toBe(false)
  })

  it('a cancelled queue never speaks its remaining chunks, even if the engine reports end late', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.speakAnswer({ ...VOICE_TURN, text: `${'A sentence of some length. '.repeat(20)}` })
    const spokenBefore = fake.spoken.length
    store.cancel()
    fake.spoken[fake.spoken.length - 1].onend?.()
    expect(fake.spoken).toHaveLength(spokenBefore)
  })

  it('a new turn cancels the previous queue before enqueuing (one queue at a time)', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.speakAnswer({ ...VOICE_TURN, text: 'First answer. Second sentence.' })
    const before = fake.cancels()
    store.speakAnswer({ ...VOICE_TURN, id: 'a2', text: 'A newer answer.' })
    expect(fake.cancels()).toBeGreaterThan(before)
    expect(fake.spoken[fake.spoken.length - 1].text).toContain('A newer answer.')
  })

  it('a stalled utterance that reports neither end nor error is cancelled and reset', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.speakAnswer(VOICE_TURN)
    expect(store.getSnapshot().speaking).toBe(true)
    vi.advanceTimersByTime(120_000)
    expect(store.getSnapshot().speaking).toBe(false)
  })

  it('clears the speaking flag when the whole queue finishes', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.speakAnswer({ ...VOICE_TURN, text: 'One. Two. Three.' })
    fake.finish()
    expect(store.getSnapshot().speaking).toBe(false)
  })
})

describe('the autoplay refusal (FR 78)', () => {
  it('surfaces a replay for a refused answer instead of failing silently, and does not retry itself', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.speakAnswer(VOICE_TURN)
    const attempts = fake.spoken.length
    fake.refuse()
    expect(store.getSnapshot()).toMatchObject({ refusedMessageId: 'a1', speaking: false })
    expect(fake.spoken).toHaveLength(attempts)
  })

  it('replays the SAME words on the fresh gesture, and clears the refusal', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.speakAnswer(VOICE_TURN)
    fake.refuse()
    store.replayRefused()
    expect(store.getSnapshot()).toMatchObject({ refusedMessageId: null, speaking: true })
    expect(fake.spoken[fake.spoken.length - 1].text).toContain('Two replicas are Ready.')
  })

  it('has nothing to replay when nothing was refused', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.replayRefused()
    expect(fake.spoken).toHaveLength(0)
  })

  it('announces the refusal, since a listener learns nothing otherwise', () => {
    // The one FR 31 announcement that has a producer today: no audio plays, the transcript is
    // (deliberately) in no live region, and the recovery is a button that just appeared.
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.speakAnswer(VOICE_TURN)
    expect(store.getSnapshot().announcement).toBe('')
    fake.refuse()
    expect(store.getSnapshot().announcement).toBe(REFUSAL_ANNOUNCEMENT)
  })

  /**
   * The offer to finish speaking ONE answer must not outlive the thread that answer is in.
   * Every stop trigger funnels through cancel(), so cancel() is where the offer is withdrawn
   * — otherwise "Play answer" sits in a brand-new empty thread and reads out words that are
   * no longer written anywhere on screen.
   */
  describe('does not outlive its answer', () => {
    const refusedStore = () => {
      const fake = fakeSynthesis([LOCAL_EN])
      const store = createSpeakBackStore(fake.deps)
      store.speakAnswer(VOICE_TURN)
      fake.refuse()
      expect(store.getSnapshot().refusedMessageId).toBe('a1')
      fake.spoken.length = 0
      return { fake, store }
    }

    it('is dropped when the thread is torn down (newThread / switchToThread call cancel)', () => {
      const { fake, store } = refusedStore()
      store.cancel()
      expect(store.getSnapshot().refusedMessageId).toBeNull()
      store.replayRefused()
      expect(fake.spoken).toHaveLength(0)
    })

    it('is dropped when a following TYPED turn finalizes', () => {
      const { fake, store } = refusedStore()
      store.speakAnswer({ id: 'a2', modality: 'text', text: 'A typed answer.' })
      expect(store.getSnapshot().refusedMessageId).toBeNull()
      expect(fake.spoken).toHaveLength(0)
    })

    it('will not replay once the preference is off — the off switch is not bypassable', () => {
      const { fake, store } = refusedStore()
      store.setEnabled(false)
      store.replayRefused()
      expect(fake.spoken).toHaveLength(0)
    })

    it('will not replay once the operator kill-switch removes the feature', () => {
      const { fake, store } = refusedStore()
      store.setConfigValue('off')
      expect(store.getSnapshot()).toMatchObject({ available: false, reason: 'disabled' })
      store.replayRefused()
      expect(fake.spoken).toHaveLength(0)
    })
  })
})

describe('the preference and the first-use line (FR 76 / 77)', () => {
  it('defaults on and persists both ways', () => {
    const store = createSpeakBackStore(fakeSynthesis([LOCAL_EN]).deps)
    expect(store.getSnapshot().enabled).toBe(true)
    store.toggleEnabled()
    expect(localStorage.getItem(SPEAK_BACK_PREF_KEY)).toBe('off')
    expect(createSpeakBackStore(fakeSynthesis([LOCAL_EN]).deps).getSnapshot().enabled).toBe(false)
    store.toggleEnabled()
    expect(localStorage.getItem(SPEAK_BACK_PREF_KEY)).toBe('on')
  })

  it('offers the off switch inline the FIRST time an answer is spoken, and never again', () => {
    const store = createSpeakBackStore(fakeSynthesis([LOCAL_EN]).deps)
    store.speakAnswer(VOICE_TURN)
    expect(store.getSnapshot().noticeVisible).toBe(true)
    expect(localStorage.getItem(SPEAK_BACK_NOTICE_KEY)).toBe('on')
    store.dismissNotice()
    store.speakAnswer({ ...VOICE_TURN, id: 'a2' })
    expect(store.getSnapshot().noticeVisible).toBe(false)
  })

  it('degrades to in-memory when storage throws, rather than wedging the rail', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    const store = createSpeakBackStore(fakeSynthesis([LOCAL_EN]).deps)
    expect(store.getSnapshot().enabled).toBe(true)
    expect(() => store.toggleEnabled()).not.toThrow()
    expect(store.getSnapshot().enabled).toBe(false)
  })
})

describe('the FR 31 live region', () => {
  it('is silent for the whole time an answer is being spoken', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    store.announce('Added 6 words')
    expect(store.getSnapshot().announcement).toBe('Added 6 words')
    store.speakAnswer(VOICE_TURN)
    expect(store.getSnapshot().announcement).toBe('')
    store.announce('Listening')
    expect(store.getSnapshot().announcement).toBe('')
    fake.finish()
    store.announce('Listening')
    expect(store.getSnapshot().announcement).toBe('Listening')
  })
})

/**
 * SPEAK-BACK IS MANDATORY, so a failed Cloud TTS answer may not end in silence. The TTS client
 * reports `onFailed` separately from `onFinished` precisely so the store can tell a dead bearer
 * from a spoken answer and fall through to the local voice — worse, possibly the wrong accent,
 * and audible, which beats nothing.
 */
describe('a failed Cloud TTS answer falls back to the local voice', () => {
  const failing = () => {
    const calls = { n: 0 }
    const speaker: Speaker = {
      cancel: () => {},
      speak: (_text, _language, handlers) => {
        calls.n += 1
        ;(handlers.onFailed ?? handlers.onFinished)()
        return true
      },
    }
    return { calls, speaker }
  }

  it('speaks through the local voice when the TTS request fails', () => {
    const fake = fakeSynthesis([LOCAL_EN])
    const store = createSpeakBackStore(fake.deps)
    const tts = failing()
    store.installSpeaker(tts.speaker)

    expect(store.speakAnswer(VOICE_TURN)).toBe(true)
    expect(tts.calls.n).toBe(1)
    // The local synthesiser was handed the same answer.
    expect(fake.spoken.length).toBeGreaterThan(0)
    fake.finish()
    expect(store.getSnapshot().speaking).toBe(false)
  })

  // Exactly ONE hop: a local voice that also fails ends the answer instead of looping.
  it('does not loop when the fallback fails too', () => {
    const store = createSpeakBackStore(fakeSynthesis([]).deps)
    const tts = failing()
    store.installSpeaker(tts.speaker)
    store.speakAnswer(VOICE_TURN)
    expect(tts.calls.n).toBe(1)
    expect(store.getSnapshot().speaking).toBe(false)
  })
})
