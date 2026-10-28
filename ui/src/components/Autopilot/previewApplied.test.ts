// @vitest-environment jsdom
/**
 * The announcement that makes a re-applied preview actually re-render.
 *
 * Thin by design — the value is that it EXISTS and that unsubscribe works, because the subscriber
 * lives in the app shell and the emitter in the provider, and nothing else connects them.
 */
import { describe, expect, it, vi } from 'vitest'

import { emitPreviewApplied, onPreviewApplied } from './previewApplied'

describe('previewApplied', () => {
  it('reaches a subscriber', () => {
    const heard = vi.fn()
    const stop = onPreviewApplied(heard)
    emitPreviewApplied()
    expect(heard).toHaveBeenCalledTimes(1)
    stop()
  })

  it('STOPS reaching one that unsubscribed — the shell remounts across navigations', () => {
    const heard = vi.fn()
    onPreviewApplied(heard)()
    emitPreviewApplied()
    expect(heard).not.toHaveBeenCalled()
  })

  it('reaches every subscriber, not just the first', () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopA = onPreviewApplied(first)
    const stopB = onPreviewApplied(second)
    emitPreviewApplied()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    stopA(); stopB()
  })
})
