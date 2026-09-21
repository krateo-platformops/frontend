// @vitest-environment jsdom
/**
 * THE ASKER HEARS AN OUTCOME, OR HEARS A TIMEOUT — never silence.
 *
 * The compose bus used to be fire-and-forget: the bridge dispatched an event and immediately told
 * the user "Moved card-b into page-x", whether the composer had applied it, refused it, or was not
 * mounted at all. That is a lying UI on its own merits, and it is also why the agent could not
 * recover: with no environment signal there is nothing to reflect on, so a refused proposal was
 * repeated verbatim or built upon as though it had landed.
 *
 * These pin the channel itself. That the COMPOSER answers on every path is pinned next door, in
 * PageComposer.agent.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  emitComposeResult,
  onComposeRequest,
  requestCompose,
} from './composeRequest'

afterEach(() => { vi.useRealTimers() })

/** A composer that answers every request the way the real one does. */
const answerWith = (answer: (id: string) => Parameters<typeof emitComposeResult>[0]) =>
  onComposeRequest((request) => { emitComposeResult(answer(request.id)) })

describe('requestCompose', () => {
  it('resolves with what the composer applied, echoing the files it rewrote', async () => {
    const stop = answerWith((id) => ({
      applied: true,
      id,
      paths: ['templates/flex.page-x.yaml', 'templates/row.row-a.yaml'],
      reason: null,
    }))
    await expect(requestCompose({ op: 'move', target: 'page-x', widget: 'card-b' })).resolves
      .toMatchObject({ applied: true, paths: ['templates/flex.page-x.yaml', 'templates/row.row-a.yaml'] })
    stop()
  })

  it("carries the composer's OWN reason back, not a sentence the caller invented", async () => {
    const stop = answerWith((id) => ({
      applied: false,
      id,
      paths: [],
      reason: 'page-x cannot hold a cards — it holds rows',
    }))
    await expect(requestCompose({ op: 'move', target: 'page-x', widget: 'card-b' })).resolves
      .toMatchObject({ applied: false, reason: 'page-x cannot hold a cards — it holds rows' })
    stop()
  })

  it('refuses when NO composer is open, instead of hanging or claiming success', async () => {
    vi.useFakeTimers()
    const pending = requestCompose({ op: 'move', target: 'page-x', widget: 'card-b' })
    await vi.advanceTimersByTimeAsync(4000)
    const result = await pending
    expect(result.applied).toBe(false)
    expect(result.reason).toMatch(/no page composer is open/i)
  })

  it('ignores an answer addressed to a DIFFERENT request', async () => {
    vi.useFakeTimers()
    // Two composers, or a stale answer in flight: an id that is not ours must not resolve us.
    const stop = onComposeRequest(() => {
      emitComposeResult({ applied: true, id: 'someone-elses', paths: ['x.yaml'], reason: null })
    })
    const pending = requestCompose({ op: 'move', target: 'page-x', widget: 'card-b' })
    await vi.advanceTimersByTimeAsync(4000)
    await expect(pending).resolves.toMatchObject({ applied: false, paths: [] })
    stop()
  })

  it('stops listening once answered, so a later request is not resolved by an old subscription', async () => {
    const stop = answerWith((id) => ({ applied: true, id, paths: ['a.yaml'], reason: null }))
    await requestCompose({ op: 'move', target: 'page-x', widget: 'card-b' })
    stop()

    vi.useFakeTimers()
    const second = requestCompose({ op: 'move', target: 'page-x', widget: 'card-b' })
    await vi.advanceTimersByTimeAsync(4000)
    await expect(second).resolves.toMatchObject({ applied: false })
  })
})
