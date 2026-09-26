// @vitest-environment jsdom
/**
 * The files batch bus: one gesture's files, answered synchronously.
 *   - with nobody listening the answer is null — a caller reads that as "nothing was written";
 *   - the FIRST answer is the provider's, and a second listener cannot overrule it;
 *   - a detail that is not a batch (no kind, a non-string file) is never delivered.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AUTOPILOT_PREVIEW_FILES_BATCH_EVENT, emitFilesBatch, onFilesBatch } from './previewFilesBatch'

const stops: (() => void)[] = []
afterEach(() => { stops.splice(0).forEach((stop) => stop()) })

describe('previewFilesBatch', () => {
  it('answers null when nobody listens — nothing was written', () => {
    expect(emitFilesBatch({ add: { 'templates/a.yaml': 'kind: A\n' }, kind: 'blueprint' })).toBeNull()
  })

  it('delivers the batch without its respond hook, and returns the first answer', () => {
    const seen = vi.fn()
    stops.push(onFilesBatch((detail, respond) => {
      seen(detail)
      respond({ ok: true, paths: ['templates/a.yaml'] })
    }))
    stops.push(onFilesBatch((_detail, respond) => respond({ error: 'too late', ok: false })))
    const batch = { add: { 'templates/a.yaml': 'kind: A\n' }, expect: { 'x.yaml': 'y' }, kind: 'blueprint' as const }
    expect(emitFilesBatch(batch)).toEqual({ ok: true, paths: ['templates/a.yaml'] })
    expect(seen).toHaveBeenCalledWith(batch)
  })

  it('unsubscribing stops delivery', () => {
    const seen = vi.fn()
    const stop = onFilesBatch(seen)
    stop()
    emitFilesBatch({ kind: 'blueprint', remove: ['a'] })
    expect(seen).not.toHaveBeenCalled()
  })

  it('ignores a detail that is not a batch', () => {
    const seen = vi.fn()
    stops.push(onFilesBatch(seen))
    for (const detail of [undefined, { add: {} }, { add: { a: 1 }, kind: 'blueprint' }, { kind: 'chart' }, { kind: 'page', remove: [3] }]) {
      window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_FILES_BATCH_EVENT, { detail }))
    }
    expect(seen).not.toHaveBeenCalled()
  })
})
