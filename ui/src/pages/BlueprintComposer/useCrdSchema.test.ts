// @vitest-environment jsdom
/**
 * The CRD read is bounded in time: a snowplow that never answers becomes the "could not be read"
 * sentence after CRD_READ_MS — the node is still placed — rather than a row that says "Placing…"
 * until the page is reloaded. A timeout says nothing about the CRD, so it is not cached: placing
 * again reads again. A denial is cached, as before.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CRD_READ_MS, readCrd, useCrdSchema } from './useCrdSchema'

/** A fetch that answers only by being aborted — a wedged snowplow. */
const hangingFetch = () => vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
}))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useCrdSchema — a read snowplow does not answer', () => {
  it('is abandoned after CRD_READ_MS, as a sentence the placed note can carry', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())
    const pending = readCrd('http://snowplow', 'repositories.github.krateo.io')
    await vi.advanceTimersByTimeAsync(CRD_READ_MS)
    await expect(pending).resolves.toEqual({ error: `snowplow did not answer within ${CRD_READ_MS / 1000}s`, transient: true })
  })

  it('is not cached — placing again reads again; a denial IS cached', async () => {
    vi.useFakeTimers()
    const fetched = hangingFetch()
    vi.stubGlobal('fetch', fetched)
    const { result } = renderHook(() => useCrdSchema('http://snowplow'))
    const first = result.current.read('repositories.github.krateo.io')
    await vi.advanceTimersByTimeAsync(CRD_READ_MS)
    await first
    void result.current.read('repositories.github.krateo.io')
    expect(fetched).toHaveBeenCalledTimes(2)

    const denied = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({}), ok: false, status: 403 }))
    vi.stubGlobal('fetch', denied)
    await result.current.read('builderpublishes.composition.krateo.io')
    await result.current.read('builderpublishes.composition.krateo.io')
    expect(denied).toHaveBeenCalledTimes(1)
  })
})
