// @vitest-environment jsdom
/**
 * UNDO, and the two ways a history like this goes wrong.
 *
 * It exists because Remove is now genuinely destructive — it deletes the file rather than orphaning
 * it — and the composer had no undo of any kind. A confirmed irreversible operation is better than
 * an unannounced one; it is not as good as a reversible one.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { draftHistory } from './draftHistory'

afterEach(() => draftHistory.clear())

describe('draftHistory', () => {
  it('goes back one whole tree at a time', () => {
    draftHistory.push({ 'a.yaml': 'one' })
    draftHistory.push({ 'a.yaml': 'two', 'b.yaml': 'added' })
    expect(draftHistory.depth()).toBe(2)

    expect(draftHistory.pop()).toEqual({ 'a.yaml': 'two', 'b.yaml': 'added' })
    expect(draftHistory.pop()).toEqual({ 'a.yaml': 'one' })
    expect(draftHistory.pop()).toBeNull()
  })

  it('restores a FILE SET, not a file — a container drop adds one and rewrites another', () => {
    // The reason snapshots are whole trees rather than per-file inverses: one gesture can create a
    // file and edit a different one, and undoing only the edit would leave the created file behind
    // as an orphan — which is the defect Remove used to have, reintroduced by the fix for it.
    draftHistory.push({ 'flex.yaml': 'before' })
    expect(draftHistory.pop()).toEqual({ 'flex.yaml': 'before' })
  })

  it('COPIES what it is given — a later mutation of the caller\'s object must not rewrite history', () => {
    const files = { 'a.yaml': 'one' }
    draftHistory.push(files)
    files['a.yaml'] = 'mutated after the fact'
    expect(draftHistory.pop()).toEqual({ 'a.yaml': 'one' })
  })

  it('is bounded — a long session cannot grow it without limit', () => {
    for (let step = 0; step < 30; step += 1) {
      draftHistory.push({ 'a.yaml': String(step) })
    }
    expect(draftHistory.depth()).toBe(20)
    // The OLDEST fall off, so the most recent twenty are the ones you can reach.
    expect(draftHistory.pop()).toEqual({ 'a.yaml': '29' })
  })

  it('forgets everything when a new draft starts', () => {
    // A snapshot restored into a different page is a worse data loss than the one undo fixes.
    draftHistory.push({ 'a.yaml': 'from the previous page' })
    draftHistory.clear()
    expect(draftHistory.depth()).toBe(0)
    expect(draftHistory.pop()).toBeNull()
  })

  it('tells a subscriber when the depth changes, so a control cannot claim a step it has not got', () => {
    const seen: number[] = []
    const stop = draftHistory.subscribe(() => seen.push(draftHistory.depth()))
    draftHistory.push({ 'a.yaml': 'one' })
    draftHistory.pop()
    stop()
    draftHistory.push({ 'a.yaml': 'after unsubscribe' })
    expect(seen).toEqual([1, 0])
  })
})
