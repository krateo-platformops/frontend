import { describe, expect, it, vi } from 'vitest'

import { confirmWithTimeout } from './confirmModalProps'

/**
 * The blast-radius confirm is the last gate before a portal write, and after the UI-parity work
 * it becomes the ONLY one for an agent-submitted form. These pin its one safety property: an
 * unanswered dialog denies rather than hangs.
 */

describe('confirmWithTimeout — the gate denies on silence', () => {
  it('resolves TRUE when the human confirms, and never fires the timer', async () => {
    vi.useFakeTimers()
    const destroy = vi.fn()
    const promise = confirmWithTimeout((onOk) => {
      onOk()

      return { destroy }
    }, 1000)
    await expect(promise).resolves.toBe(true)
    // advance well past the window: a cleared timer must not fire
    vi.advanceTimersByTime(5000)
    // the timer was cleared, not merely ignored
    expect(destroy).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('resolves FALSE when the human cancels', async () => {
    vi.useFakeTimers()
    const promise = confirmWithTimeout((_onOk, onCancel) => {
      onCancel()

      return { destroy: vi.fn() }
    }, 1000)
    await expect(promise).resolves.toBe(false)
    vi.useRealTimers()
  })

  it('DENIES and dismisses the dialog when nobody answers', async () => {
    // The safety property. Without this the promise never settles, and because the caller holds
    // a re-entrancy flag while a confirm is open, every LATER action resolves false with no
    // dialog on screen to explain why.
    vi.useFakeTimers()
    const destroy = vi.fn()
    const promise = confirmWithTimeout(() => ({ destroy }), 1000)
    vi.advanceTimersByTime(1000)
    await expect(promise).resolves.toBe(false)
    // screen matches the decision
    expect(destroy).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('never resolves TRUE on timeout — a silent gate is a denied gate', async () => {
    vi.useFakeTimers()
    const promise = confirmWithTimeout(() => ({ destroy: vi.fn() }), 500)
    vi.advanceTimersByTime(10_000)
    await expect(promise).resolves.not.toBe(true)
    vi.useRealTimers()
  })

  it('clears the caller re-entrancy flag on every path', async () => {
    vi.useFakeTimers()
    const settled: string[] = []
    await confirmWithTimeout((onOk) => {
      onOk()

      return { destroy: vi.fn() }
    }, 1000, () => settled.push('ok'))
    const timedOut = confirmWithTimeout(() => ({ destroy: vi.fn() }), 1000, () => settled.push('timeout'))
    vi.advanceTimersByTime(1000)
    await timedOut
    expect(settled).toEqual(['ok', 'timeout'])
    vi.useRealTimers()
  })
})
