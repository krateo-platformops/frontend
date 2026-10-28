import { describe, expect, it, vi } from 'vitest'

import type { BlastRadius, BlastRadiusSet, BlastRadiusSetOp } from './blastRadius.types'
import { BLAST_RADIUS_CONFIRM_Z_INDEX, buildConfirmModalProps, confirmWithTimeout } from './confirmModalProps'

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

describe('buildConfirmModalProps — the set count agrees with its noun', () => {
  const op: BlastRadiusSetOp = { gvr: { group: 'apps', resource: 'deployments', version: 'v1' }, irreversible: false, namespace: 'demo', verb: 'POST' }
  const noop = () => undefined

  it('reads "Confirm 1 write" — never "1 writes" — on a single-op set, title and button', () => {
    const props = buildConfirmModalProps({ count: 1, kind: 'set', ops: [op] } satisfies BlastRadiusSet, noop, noop)
    expect(props.title).toBe('Confirm 1 write')
    expect(props.okText).toBe('Confirm 1 write')
  })

  it('reads "Confirm 2 writes" on a two-op set, title and button', () => {
    const props = buildConfirmModalProps({ count: 2, kind: 'set', ops: [op, op] } satisfies BlastRadiusSet, noop, noop)
    expect(props.title).toBe('Confirm 2 writes')
    expect(props.okText).toBe('Confirm 2 writes')
  })
})

/**
 * The blast-radius confirm modal props (the HITL gate). The load-bearing assertion here is
 * the raised zIndex (1100 > the preview Drawer's 1000): it is what keeps the confirm ABOVE
 * the Autopilot preview drawer — the "confirm opens BEHIND the preview" fix (item Q).
 * A z-index cannot be visually unit-tested, so we assert the prop is passed on EVERY path
 * (scalar write, W0-4 set, and the plain read-only "Are you sure?" opt-in).
 */
describe('buildConfirmModalProps — the confirm sits above the preview drawer', () => {
  const scalarRadius: BlastRadius = {
    cluster: 'local',
    count: 1,
    diff: { after: { spec: {} }, kind: 'create' },
    gvr: { group: 'apps', resource: 'deployments', version: 'v1' },
    namespace: 'demo',
    verb: 'POST',
  }
  const deleteRadius: BlastRadius = { ...scalarRadius, diff: { before: {}, kind: 'delete' }, verb: 'DELETE' }
  const setRadius: BlastRadiusSet = {
    count: 2,
    kind: 'set',
    ops: [
      { gvr: scalarRadius.gvr, irreversible: false, namespace: 'demo', verb: 'POST' },
      { gvr: scalarRadius.gvr, irreversible: true, namespace: 'demo', verb: 'DELETE' },
    ],
  }
  const noop = () => undefined

  it('raises the confirm above the preview drawer (zIndex 1100 > drawer 1000) for a scalar write', () => {
    const props = buildConfirmModalProps(scalarRadius, noop, noop)
    expect(props.zIndex).toBe(BLAST_RADIUS_CONFIRM_Z_INDEX)
    expect(BLAST_RADIUS_CONFIRM_Z_INDEX).toBe(1100)
    expect(props.title).toBe('Confirm write')
    expect(props.width).toBe(560)
    // A create is reversible → no danger okButton.
    expect(props.okButtonProps).toBeUndefined()
  })

  it('raises the zIndex on the aggregated W0-4 set confirm (the publish/apply-set path)', () => {
    const props = buildConfirmModalProps(setRadius, noop, noop)
    expect(props.zIndex).toBe(BLAST_RADIUS_CONFIRM_Z_INDEX)
    expect(props.title).toBe('Confirm 2 writes')
    // The set contains an irreversible DELETE → danger okButton.
    expect(props.okButtonProps).toEqual({ danger: true })
  })

  it('marks an irreversible DELETE danger and still raises the zIndex', () => {
    const props = buildConfirmModalProps(deleteRadius, noop, noop)
    expect(props.zIndex).toBe(BLAST_RADIUS_CONFIRM_Z_INDEX)
    expect(props.okButtonProps).toEqual({ danger: true })
  })

  it('raises the zIndex even on the plain read-only "Are you sure?" prompt (no radius)', () => {
    const props = buildConfirmModalProps(undefined, noop, noop)
    expect(props.zIndex).toBe(BLAST_RADIUS_CONFIRM_Z_INDEX)
    expect(props.title).toBe('Are you sure?')
    expect(props.content).toBeUndefined()
    expect(props.width).toBeUndefined()
  })

  it('wires onOk → true and onCancel → false through the passed callbacks', () => {
    const onOk = vi.fn()
    const onCancel = vi.fn()
    const props = buildConfirmModalProps(scalarRadius, onOk, onCancel)
    props.onOk?.(noop)
    props.onCancel?.(noop)
    expect(onOk).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
