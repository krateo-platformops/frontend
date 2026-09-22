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
    const a = vi.fn()
    const b = vi.fn()
    const stopA = onPreviewApplied(a)
    const stopB = onPreviewApplied(b)
    emitPreviewApplied()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    stopA(); stopB()
  })
})
