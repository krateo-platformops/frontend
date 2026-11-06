// @vitest-environment jsdom
/**
 * UNDO, and the two ways a history like this goes wrong.
 *
 * It exists because Remove is now genuinely destructive — it deletes the file rather than orphaning
 * it — and the composer had no undo of any kind. A confirmed irreversible operation is better than
 * an unannounced one; it is not as good as a reversible one.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { draftHistory, type Snapshot } from './draftHistory'

const page = (files: Record<string, string>): Snapshot => ({ files, kind: 'page' })

afterEach(() => draftHistory.clear())

describe('draftHistory', () => {
  it('goes back one whole tree at a time', () => {
    draftHistory.push(page({ 'a.yaml': 'one' }))
    draftHistory.push(page({ 'a.yaml': 'two', 'b.yaml': 'added' }))
    expect(draftHistory.depth()).toBe(2)

    expect(draftHistory.pop()).toEqual(page({ 'a.yaml': 'two', 'b.yaml': 'added' }))
    expect(draftHistory.pop()).toEqual(page({ 'a.yaml': 'one' }))
    expect(draftHistory.pop()).toBeNull()
  })

  it('restores a FILE SET, not a file — a container drop adds one and rewrites another', () => {
    // The reason snapshots are whole trees rather than per-file inverses: one gesture can create a
    // file and edit a different one, and undoing only the edit would leave the created file behind
    // as an orphan — which is the defect Remove used to have, reintroduced by the fix for it.
    draftHistory.push(page({ 'flex.yaml': 'before' }))
    expect(draftHistory.pop()).toEqual(page({ 'flex.yaml': 'before' }))
  })

  it('COPIES what it is given — a later mutation of the caller\'s object must not rewrite history', () => {
    const files = { 'a.yaml': 'one' }
    draftHistory.push(page(files))
    files['a.yaml'] = 'mutated after the fact'
    expect(draftHistory.pop()).toEqual(page({ 'a.yaml': 'one' }))
  })

  it('keeps WHAT the tree was — a restore cannot relabel a page as a chart', () => {
    draftHistory.push({ files: { 'Chart.yaml': 'name: aws-vpc' }, kind: 'blueprint' })
    draftHistory.push(page({ 'templates/flex.page-x.yaml': 'kind: Flex' }))
    expect(draftHistory.pop()?.kind).toBe('page')
    expect(draftHistory.pop()?.kind).toBe('blueprint')
  })

  it('is bounded — a long session cannot grow it without limit', () => {
    for (let step = 0; step < 30; step += 1) {
      draftHistory.push(page({ 'a.yaml': String(step) }))
    }
    expect(draftHistory.depth()).toBe(20)
    // The OLDEST fall off, so the most recent twenty are the ones you can reach.
    expect(draftHistory.pop()).toEqual(page({ 'a.yaml': '29' }))
  })

  it('forgets everything when a new draft starts', () => {
    // A snapshot restored into a different page is a worse data loss than the one undo fixes.
    draftHistory.push(page({ 'a.yaml': 'from the previous page' }))
    draftHistory.clear()
    expect(draftHistory.depth()).toBe(0)
    expect(draftHistory.pop()).toBeNull()
  })

  it('tells a subscriber when the depth changes, so a control cannot claim a step it has not got', () => {
    const seen: number[] = []
    const stop = draftHistory.subscribe(() => seen.push(draftHistory.depth()))
    draftHistory.push(page({ 'a.yaml': 'one' }))
    draftHistory.pop()
    stop()
    draftHistory.push(page({ 'a.yaml': 'after unsubscribe' }))
    expect(seen).toEqual([1, 0])
  })
})
