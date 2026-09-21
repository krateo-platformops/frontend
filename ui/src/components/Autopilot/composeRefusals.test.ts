// @vitest-environment jsdom
/**
 * A CHIP IS NOT A CHANNEL TO THE AGENT.
 *
 * Layers 2 and 3 made the composer answer, and made the answer name the containers that would have
 * worked. Both reach the PERSON. Neither reached the model: a turn transmits `{context, contextId,
 * sessionId, text}` and nothing else, and `message.actions` — where every chip lives — never leaves
 * the browser. So the model saw its own directive, then a fresh user message, with no sign anything
 * had gone wrong; its only available inference was from a draft that had not changed.
 *
 * `previewProblems` already solved this for rejected previews by riding the page-context envelope.
 * These pin the same route for compose, and — just as load-bearing — that the delta budget cannot
 * quietly drop it, since a refused proposal changes nothing else the budget looks at.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearComposeRefusals,
  emitComposeResult,
  getComposeRefusals,
  onComposeRequest,
  requestCompose,
} from './composeRequest'
import type { PageContextEnvelope } from './types'
import { buildContextDelta, useAutopilotContext } from './useAutopilotContext'

afterEach(() => {
  clearComposeRefusals()
  vi.useRealTimers()
})

/** A composer that answers every request the same way. */
const composerThat = (answer: (id: string) => Parameters<typeof emitComposeResult>[0]) =>
  onComposeRequest((request) => { emitComposeResult(answer(request.id)) })

const refusing = (reason: string, where?: string[]) =>
  composerThat((id) => ({ applied: false, id, paths: [], reason, ...(where ? { where } : {}) }))

describe('a refusal is held for the next turn', () => {
  it('records what was tried, why it failed, and where it would have worked', async () => {
    const stop = refusing('page-x cannot hold a cards', ['row-a', 'row-b'])
    await requestCompose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })
    stop()

    expect(getComposeRefusals()).toEqual([{
      reason: 'page-x cannot hold a cards',
      tried: 'place fleet-card inside page-x',
      where: ['row-a', 'row-b'],
    }])
  })

  it('describes each op in the terms the model proposed it', async () => {
    const stop = refusing('no')
    await requestCompose({ op: 'move', target: 'page-x', widget: 'card-b' })
    await requestCompose({ layout: 'Row', op: 'addContainer', target: 'page-x' })
    stop()

    expect(getComposeRefusals()?.map((note) => note.tried))
      .toEqual(['move card-b into page-x', 'add a Row inside page-x'])
  })

  it('holds nothing when there is nothing to correct', () => {
    expect(getComposeRefusals()).toBeNull()
  })

  it('FORGETS everything as soon as a compose applies', async () => {
    const refuse = refusing('page-x cannot hold a cards', ['row-a'])
    await requestCompose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })
    refuse()
    expect(getComposeRefusals()).toHaveLength(1)

    // The draft has moved. A refusal computed against the old one may simply no longer be true, and
    // a stale correction is worse than none.
    const apply = composerThat((id) => ({ applied: true, id, paths: ['templates/row.row-a.yaml'], reason: null }))
    await requestCompose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'row-a' })
    apply()
    expect(getComposeRefusals()).toBeNull()
  })

  it('does NOT forget merely because the model was told once', async () => {
    // An unfixed problem keeps riding — that is what makes it a standing correction rather than a
    // notification. previewProblems behaves the same way, for the same reason.
    const stop = refusing('page-x cannot hold a cards')
    await requestCompose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })
    stop()
    expect(getComposeRefusals()).toHaveLength(1)
    expect(getComposeRefusals()).toHaveLength(1)
  })

  it('counts a repeated proposal once, not twice', async () => {
    const stop = refusing('page-x cannot hold a cards', ['row-a'])
    await requestCompose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })
    await requestCompose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })
    stop()
    // The same proposal refused twice is one standing problem; listing it twice would read as two.
    expect(getComposeRefusals()).toHaveLength(1)
  })

  it('keeps only the most recent few, so a loop cannot fill the envelope with its history', async () => {
    const stop = refusing('no')
    // Sequential in effect either way — the composer answers inside its own handler, so each of
    // these settles before the next is dispatched.
    await Promise.all(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(
      (name) => requestCompose({ name, op: 'addExisting', resource: 'cards', target: 'page-x' }),
    ))
    stop()
    const held = getComposeRefusals()
    expect(held).toHaveLength(5)
    expect(held?.[held.length - 1].tried).toContain('g')
  })

  it('records a TIMEOUT too — "no composer is open" is a correction the model can act on', async () => {
    vi.useFakeTimers()
    const pending = requestCompose({ op: 'move', target: 'page-x', widget: 'card-b' })
    await vi.advanceTimersByTimeAsync(4000)
    await pending
    expect(getComposeRefusals()?.[0].reason).toMatch(/no page composer is open/i)
  })
})

describe('the delta budget cannot drop the correction', () => {
  const envelope = (composeRefusals?: PageContextEnvelope['composeRefusals']): PageContextEnvelope => ({
    ...(composeRefusals ? { composeRefusals } : {}),
    pageStatus: 'ready',
    route: '/portal-builder/compose',
    widgets: [],
  })

  const note = [{ reason: 'page-x cannot hold a cards', tried: 'place fleet-card inside page-x', where: ['row-a'] }]

  it('re-sends the full envelope on the turn a refusal appears', () => {
    // A refused proposal changes NOTHING else the budget looks at — same route, same widgets, same
    // page status — so without its own guard this is exactly the turn that collapses.
    const delta = buildContextDelta(envelope(note), envelope())
    expect(delta).toContain('cannot hold a cards')
    expect(delta).not.toContain('Unchanged:')
  })

  it('keeps re-sending while the refusal STANDS, not only on the turn it changed', () => {
    // Two identical envelopes: nothing changed, and the correction still has to be in front of the
    // model, because it has not been acted on yet.
    expect(buildContextDelta(envelope(note), envelope(note))).not.toContain('Unchanged:')
  })

  it('collapses again once the refusal is gone', () => {
    expect(buildContextDelta(envelope(), envelope())).toContain('Unchanged:')
  })
})

describe('the collector puts the refusal on the envelope', () => {
  /**
   * The one property the rest of this layer is FOR. Everything else — the store, the delta guard —
   * is machinery around this single hop, and it is the hop that is invisible when it breaks: the
   * refusal is still recorded, the chip still reads correctly, the suite is still green, and the
   * model simply never hears about it. So it is asserted through the real `collect()` rather than
   * against a hand-built envelope, which is what lets a deleted line here fail a test.
   */
  const collect = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)
    return renderHook(() => useAutopilotContext(), { wrapper }).result.current.collect()
  }

  it('carries a standing refusal to the wire', async () => {
    const stop = refusing('page-x cannot hold a cards', ['row-a'])
    await requestCompose({ name: 'fleet-card', op: 'addExisting', resource: 'cards', target: 'page-x' })
    stop()

    expect(collect().composeRefusals).toEqual([{
      reason: 'page-x cannot hold a cards',
      tried: 'place fleet-card inside page-x',
      where: ['row-a'],
    }])
  })

  it('omits the field entirely when nothing was refused', () => {
    expect(collect()).not.toHaveProperty('composeRefusals')
  })
})
