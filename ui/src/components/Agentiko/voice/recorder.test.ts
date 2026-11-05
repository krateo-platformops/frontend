// @vitest-environment jsdom
/**
 * THE RECORDER, AND THE GATE THAT KEEPS SILENCE OFF THE WIRE.
 *
 * jsdom has no `getUserMedia`, no `MediaRecorder` and no `AudioContext`, so the whole
 * platform is a fake here — which is the point of `RecorderDeps` existing at all. The
 * fake's analyser is programmable, so "the user never spoke" and "the user spoke" are two
 * lines apart, and the assertion that matters is that the first one produces NO RESULT:
 * a silent recording is never handed to the transcriber, because 30 s of silence still
 * bills ~960 audio tokens and the model writes a plausible sentence from nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { VoiceError } from './errors'
import type { MediaRecorderLike, MediaStreamLike, RecorderDeps, RecordingResult } from './recorder'
import {
  LEVEL_TICK_MS,
  MAX_RECORDING_MS,
  SILENCE_LEAD_IN_MS,
  SILENCE_STOP_MS,
  SPEECH_RMS_THRESHOLD,
  startRecording,
} from './recorder'

const LOUD = SPEECH_RMS_THRESHOLD * 5
const SILENT = 0

interface Harness {
  deps: RecorderDeps
  /** Every track handed out, so the release assertion can check all of them. */
  stopped: () => number
  /** What the analyser reports on the next tick. */
  setLevel: (rms: number) => void
  /** Advance the injected clock AND the timers together. */
  tick: (ms: number) => void
  recorder: () => MediaRecorderLike | null
  meterClosed: () => boolean
}

const harness = (options: { getUserMedia?: () => Promise<MediaStreamLike>; meter?: boolean } = {}): Harness => {
  let level = SILENT
  let clock = 0
  let stopCount = 0
  let closed = false
  let recorder: MediaRecorderLike | null = null

  const stream: MediaStreamLike = {
    getTracks: () => [{ stop: () => { stopCount += 1 } }, { stop: () => { stopCount += 1 } }],
  }

  const deps: RecorderDeps = {
    createLevelMeter: () => (options.meter === false ? null : { close: () => { closed = true }, rms: () => level }),
    createRecorder: () => {
      const made: MediaRecorderLike = {
        ondataavailable: null,
        onerror: null,
        onstop: null,
        start: () => undefined,
        stop: () => {
          made.ondataavailable?.({ data: new Blob(['bytes'], { type: 'audio/webm' }) })
          made.onstop?.()
        },
      }
      recorder = made
      return made
    },
    getUserMedia: options.getUserMedia ?? (() => Promise.resolve(stream)),
    now: () => clock,
  }

  return {
    deps,
    meterClosed: () => closed,
    recorder: () => recorder,
    setLevel: (rms) => { level = rms },
    stopped: () => stopCount,
    tick: (ms) => {
      const steps = Math.round(ms / LEVEL_TICK_MS)
      for (let step = 0; step < steps; step += 1) {
        clock += LEVEL_TICK_MS
        vi.advanceTimersByTime(LEVEL_TICK_MS)
      }
    },
  }
}

const handlers = () => ({
  onAutoStop: vi.fn(),
  onError: vi.fn<(error: VoiceError) => void>(),
  onLevel: vi.fn(),
  onResult: vi.fn<(result: RecordingResult) => void>(),
  onTick: vi.fn(),
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('the heard-something gate (FR 66) — silence is never uploaded', () => {
  it('produces NO RESULT and a no-speech error when nothing crossed the speech threshold', async () => {
    const bench = harness()
    const spies = handlers()
    const session = await startRecording(bench.deps, 'audio/webm;codecs=opus', spies)

    bench.setLevel(SILENT)
    bench.tick(3000)
    session.stop()

    // The blob exists — the recorder produced one — and it is thrown away regardless.
    expect(spies.onResult).not.toHaveBeenCalled()
    expect(spies.onError).toHaveBeenCalledTimes(1)
    expect(spies.onError.mock.calls[0][0].code).toBe('no-speech')
  })

  /**
   * The FR 61 floor on the response side is DURATION-PROPORTIONAL, so a recording of
   * near-zero length asks it for near-zero audio tokens — a threshold an invented sentence
   * clears while carrying no audio at all. A press-and-release misclick is the reachable
   * case, and the pop it makes can cross the RMS threshold, so the loudness gate above does
   * not catch it. Nobody dictates anything in under a second.
   */
  it('refuses a recording too short to be speech, before the loudness gate can pass it', async () => {
    const bench = harness()
    const spies = handlers()
    const session = await startRecording(bench.deps, 'audio/webm;codecs=opus', spies)

    bench.setLevel(LOUD)
    bench.tick(200)
    session.stop()

    expect(spies.onResult).not.toHaveBeenCalled()
    expect(spies.onError.mock.calls[0][0].code).toBe('no-speech')
    expect(bench.stopped()).toBe(2)
  })

  it('hands over the recording when the microphone DID hear something', async () => {
    const bench = harness()
    const spies = handlers()
    const session = await startRecording(bench.deps, 'audio/webm;codecs=opus', spies)

    bench.setLevel(LOUD)
    bench.tick(2000)
    session.stop()

    expect(spies.onError).not.toHaveBeenCalled()
    expect(spies.onResult).toHaveBeenCalledTimes(1)
    const [[result]] = spies.onResult.mock.calls
    expect(result.peakRms).toBeGreaterThanOrEqual(SPEECH_RMS_THRESHOLD)
    expect(result.seconds).toBeCloseTo(2, 1)
    expect(result.mediaType).toBe('audio/webm')
  })

  it('remembers the PEAK, so a single loud sentence in a quiet recording still counts', async () => {
    const bench = harness()
    const spies = handlers()
    const session = await startRecording(bench.deps, 'audio/webm;codecs=opus', spies)

    bench.setLevel(SILENT)
    bench.tick(1000)
    bench.setLevel(LOUD)
    bench.tick(200)
    bench.setLevel(SILENT)
    bench.tick(1000)
    session.stop()

    expect(spies.onResult).toHaveBeenCalledTimes(1)
  })

  it('refuses to record at all when the analyser is unavailable — an unenforceable gate is not a gate', async () => {
    const bench = harness({ meter: false })
    await expect(startRecording(bench.deps, 'audio/webm;codecs=opus', handlers())).rejects.toMatchObject({ code: 'engine' })
    expect(bench.stopped()).toBe(2)
  })
})

describe('auto-stop (FR 12)', () => {
  it('stops after the trailing-silence window and reports it as silence, not an error', async () => {
    const bench = harness()
    const spies = handlers()
    await startRecording(bench.deps, 'audio/webm;codecs=opus', spies)

    bench.setLevel(LOUD)
    bench.tick(500)
    bench.setLevel(SILENT)
    bench.tick(SILENCE_STOP_MS - 500)
    expect(spies.onAutoStop).not.toHaveBeenCalled()
    bench.tick(600)

    expect(spies.onAutoStop).toHaveBeenCalledWith('silence')
    expect(spies.onResult).toHaveBeenCalledTimes(1)
  })

  it('does NOT stop while the user is still gathering the thought — lead-in is not trailing silence', async () => {
    // The bug this locks out: with lastLoudAt seeded to the start time and ONE window for both
    // silences, shortening the turn-ending window to 1.2 s stopped the recording before the
    // first word. Pressing the microphone and pausing to think must not end the turn.
    const bench = harness()
    const spies = handlers()
    await startRecording(bench.deps, 'audio/webm;codecs=opus', spies)

    bench.setLevel(SILENT)
    bench.tick(SILENCE_STOP_MS * 3)
    expect(spies.onAutoStop).not.toHaveBeenCalled()

    // ...and once speech finally arrives, the SHORT window is what ends the turn.
    bench.setLevel(LOUD)
    bench.tick(500)
    bench.setLevel(SILENT)
    bench.tick(SILENCE_STOP_MS + LEVEL_TICK_MS)
    expect(spies.onAutoStop).toHaveBeenCalledWith('silence')
  })

  it('gives up after the lead-in when the user never speaks at all', async () => {
    const bench = harness()
    const spies = handlers()
    await startRecording(bench.deps, 'audio/webm;codecs=opus', spies)

    bench.setLevel(SILENT)
    bench.tick(SILENCE_LEAD_IN_MS - LEVEL_TICK_MS)
    expect(spies.onAutoStop).not.toHaveBeenCalled()
    bench.tick(LEVEL_TICK_MS * 2)
    expect(spies.onAutoStop).toHaveBeenCalledWith('silence')
  })

  it('stops at 60 s and still transcribes what was said — it is information, not a failure', async () => {
    const bench = harness()
    const spies = handlers()
    await startRecording(bench.deps, 'audio/webm;codecs=opus', spies)

    // Loud throughout, so the silence rule never fires and only the duration cap can stop it.
    bench.setLevel(LOUD)
    bench.tick(MAX_RECORDING_MS)

    expect(spies.onAutoStop).toHaveBeenCalledWith('max-duration')
    expect(spies.onResult).toHaveBeenCalledTimes(1)
    expect(spies.onError).not.toHaveBeenCalled()
  })
})

describe('release — no live-microphone indicator is ever left behind (FR 23)', () => {
  it('stops every track and closes the analyser on the success path', async () => {
    const bench = harness()
    const spies = handlers()
    const session = await startRecording(bench.deps, 'audio/webm;codecs=opus', spies)
    bench.setLevel(LOUD)
    bench.tick(500)
    session.stop()
    expect(bench.stopped()).toBe(2)
    expect(bench.meterClosed()).toBe(true)
  })

  it('stops every track on the silent-rejection path too', async () => {
    const bench = harness()
    const session = await startRecording(bench.deps, 'audio/webm;codecs=opus', handlers())
    bench.tick(500)
    session.stop()
    expect(bench.stopped()).toBe(2)
    expect(bench.meterClosed()).toBe(true)
  })

  it('cancel DISCARDS the recording: no result, no error, and the tracks are released (FR 13)', async () => {
    const bench = harness()
    const spies = handlers()
    const session = await startRecording(bench.deps, 'audio/webm;codecs=opus', spies)
    bench.setLevel(LOUD)
    bench.tick(1000)
    session.cancel()

    expect(spies.onResult).not.toHaveBeenCalled()
    expect(spies.onError).not.toHaveBeenCalled()
    expect(bench.stopped()).toBe(2)
  })

  it('releases the tracks when the recorder itself errors', async () => {
    const bench = harness()
    const spies = handlers()
    await startRecording(bench.deps, 'audio/webm;codecs=opus', spies)
    bench.recorder()?.onerror?.({})
    expect(spies.onError.mock.calls[0][0].code).toBe('engine')
    expect(bench.stopped()).toBe(2)
  })
})

describe('opening the microphone', () => {
  it('maps a refused permission to denied', async () => {
    const denial = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    const bench = harness({ getUserMedia: () => Promise.reject(denial) })
    await expect(startRecording(bench.deps, 'audio/webm;codecs=opus', handlers())).rejects.toMatchObject({ code: 'denied' })
  })

  it('maps a missing device to no-mic', async () => {
    const missing = Object.assign(new Error('none'), { name: 'NotFoundError' })
    const bench = harness({ getUserMedia: () => Promise.reject(missing) })
    await expect(startRecording(bench.deps, 'audio/webm;codecs=opus', handlers())).rejects.toMatchObject({ code: 'no-mic' })
  })

  it('reports the live level and elapsed time on every tick', async () => {
    const bench = harness()
    const spies = handlers()
    await startRecording(bench.deps, 'audio/webm;codecs=opus', spies)
    bench.setLevel(LOUD)
    bench.tick(300)
    expect(spies.onLevel).toHaveBeenCalledWith(LOUD)
    expect(spies.onTick).toHaveBeenCalledWith(300)
  })
})
