// @vitest-environment jsdom
/**
 * The permission watcher. Its whole job is to be right about three states and to be
 * SILENT about everything else: where the browser will not tell us (Safari throws on the
 * microphone descriptor, embedded webviews have no `permissions` at all), the answer is
 * `prompt` — the control stays usable and the browser's own prompt settles it. Guessing
 * `denied` there would disable dictation for no reason; guessing `granted` would claim an
 * authorisation nobody gave.
 */
import { describe, expect, it, vi } from 'vitest'

import type { PermissionsNavigatorLike, PermissionStatusLike } from './permission'
import { MICROPHONE_BLOCKED_HINT, watchMicrophonePermission } from './permission'

/** Let the permissions promise chain settle. Recursive rather than looped so the lint
 *  rule against awaiting in a loop stays on for the code that actually matters. */
const flush = async (rounds = 4): Promise<void> => {
  if (rounds <= 0) {
    return
  }
  await Promise.resolve()
  await flush(rounds - 1)
}

const statusWithListener = (state: string) => {
  const listeners: (() => void)[] = []
  const status: PermissionStatusLike = {
    addEventListener: (_type, listener) => listeners.push(listener),
    removeEventListener: () => listeners.splice(0, listeners.length),
    state,
  }
  const change = (next: string): void => {
    status.state = next
    listeners.forEach((listener) => listener())
  }
  return { change, status }
}

type QueryFn = (descriptor: { name: string }) => Promise<PermissionStatusLike>

const nav = (query: QueryFn): PermissionsNavigatorLike => ({ permissions: { query } })

describe('watchMicrophonePermission', () => {
  it('reports the current state immediately', async () => {
    const seen = vi.fn()
    const { status } = statusWithListener('granted')
    watchMicrophonePermission(seen, nav(() => Promise.resolve(status)))
    await flush()
    expect(seen).toHaveBeenCalledWith('granted')
  })

  it('follows a change to denied — including one made mid-recording (FR 19)', async () => {
    const seen = vi.fn()
    const { change, status } = statusWithListener('granted')
    watchMicrophonePermission(seen, nav(() => Promise.resolve(status)))
    await flush()
    change('denied')
    expect(seen).toHaveBeenLastCalledWith('denied')
  })

  it('follows a change back to granted, so allowing it in the address bar needs no reload', async () => {
    const seen = vi.fn()
    const { change, status } = statusWithListener('denied')
    watchMicrophonePermission(seen, nav(() => Promise.resolve(status)))
    await flush()
    change('granted')
    expect(seen).toHaveBeenLastCalledWith('granted')
  })

  it('falls back to the legacy onchange handler where addEventListener is absent', async () => {
    const seen = vi.fn()
    const status = { onchange: null, state: 'prompt' } as PermissionStatusLike
    watchMicrophonePermission(seen, nav(() => Promise.resolve(status)))
    await flush()
    status.state = 'granted'
    status.onchange?.()
    expect(seen).toHaveBeenLastCalledWith('granted')
  })

  it('maps an unknown state to prompt rather than inventing a verdict', async () => {
    const seen = vi.fn()
    const { status } = statusWithListener('something-else')
    watchMicrophonePermission(seen, nav(() => Promise.resolve(status)))
    await flush()
    expect(seen).toHaveBeenCalledWith('prompt')
  })

  it('says nothing at all when the query REJECTS (Safari) — the caller stays on prompt', async () => {
    const seen = vi.fn()
    const unsubscribe = watchMicrophonePermission(seen, nav(() => Promise.reject(new TypeError('unsupported'))))
    await flush()
    expect(seen).not.toHaveBeenCalled()
    expect(() => unsubscribe()).not.toThrow()
  })

  it('says nothing when the query THROWS synchronously, and does not take the rail down', async () => {
    const seen = vi.fn()
    expect(() => watchMicrophonePermission(seen, nav(() => { throw new TypeError('unsupported') }))).not.toThrow()
    await flush()
    expect(seen).not.toHaveBeenCalled()
  })

  it('is a no-op with no permissions API at all', () => {
    const seen = vi.fn()
    const unsubscribe = watchMicrophonePermission(seen, {})
    expect(seen).not.toHaveBeenCalled()
    expect(() => unsubscribe()).not.toThrow()
  })

  it('drops a result that arrives after unsubscribe', async () => {
    const seen = vi.fn()
    const { status } = statusWithListener('granted')
    const unsubscribe = watchMicrophonePermission(seen, nav(() => Promise.resolve(status)))
    unsubscribe()
    await flush()
    expect(seen).not.toHaveBeenCalled()
  })

  it('names the fix in the blocked hint, because it is not in the page', () => {
    expect(MICROPHONE_BLOCKED_HINT).toMatch(/lock icon in the address bar/i)
  })
})
