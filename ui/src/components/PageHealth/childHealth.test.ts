/**
 * The rule, not the pixels: a parent must not read healthier than its worst child.
 *
 * Every condition shape asserted here was taken from live objects on the bench cluster
 * (`kubectl get <composition kind>.composition.krateo.io -o json`): Krateo compositions print
 * `Ready` + `Synced` with `reason`/`message`, core workloads print `Available`.
 */
import { describe, expect, it } from 'vitest'

import {
  CHILD_STATE_LABEL,
  childHealthFromRow,
  childStateFromConditions,
  childStateFromStatusColor,
  describeChildHealth,
  rollupChildHealth,
} from './childHealth'
import type { ChildHealth } from './childHealth'

const child = (name: string, state: ChildHealth['state'], extra: Partial<ChildHealth> = {}): ChildHealth =>
  ({ detail: '', kind: 'Deployment', name, state, ...extra })

describe('childStateFromConditions', () => {
  it('reads a live-shaped healthy composition as Ready', () => {
    // Verbatim from `frontends.composition.krateo.io/frontend` on krateo-057.
    expect(childStateFromConditions([
      { message: 'Composition is up-to-date', reason: 'Available', status: 'True', type: 'Ready' },
      { message: '', reason: 'ReconcileSuccess', status: 'True', type: 'Synced' },
    ])).toEqual({ detail: '', state: 'ready' })
  })

  it('reads Ready=False as NotReady, and carries the reason and message forward', () => {
    expect(childStateFromConditions([
      { message: 'pods are not available', reason: 'Unavailable', status: 'False', type: 'Ready' },
      { status: 'True', type: 'Synced' },
    ])).toEqual({ detail: 'Unavailable · pods are not available', state: 'notReady' })
  })

  /*
   * THE CASE A SINGLE-CONDITION READ GETS WRONG.
   *
   * `Ready` is the LAST GOOD reconcile and can sit True for hours; `Synced=False` is the reconcile
   * that just failed. A parent reading only `Ready` here reports the past as the present.
   */
  it('reads Ready=True with Synced=False as NotSynced — Ready is stale, Synced carries the live error', () => {
    const verdict = childStateFromConditions([
      { message: 'Composition is up-to-date', reason: 'Available', status: 'True', type: 'Ready' },
      { message: 'cannot render chart: values do not validate', reason: 'ReconcileError', status: 'False', type: 'Synced' },
    ])
    expect(verdict.state).toBe('notSynced')
    expect(verdict.detail).toContain('ReconcileError')
  })

  it('reads `Available` too — core workloads do not spell readiness `Ready`', () => {
    expect(childStateFromConditions([
      { reason: 'MinimumReplicasUnavailable', status: 'False', type: 'Available' },
      { status: 'True', type: 'Progressing' },
    ]).state).toBe('notReady')
  })

  it('treats a negative-polarity condition being TRUE as the failure it is', () => {
    expect(childStateFromConditions([
      { status: 'True', type: 'Ready' },
      { reason: 'FailedCreate', status: 'True', type: 'ReplicaFailure' },
    ])).toEqual({ detail: 'FailedCreate', state: 'notReady' })
  })

  it('takes the WORST of all conditions, whatever order they arrive in', () => {
    const conditions = [
      { status: 'False', type: 'Synced' },
      { status: 'False', type: 'Ready' },
    ]
    expect(childStateFromConditions(conditions).state).toBe('notReady')
    expect(childStateFromConditions([...conditions].reverse()).state).toBe('notReady')
  })

  it('reads Ready=Unknown as ReadyUnknown, not as health', () => {
    const verdict = childStateFromConditions([{ status: 'Unknown', type: 'Ready' }])
    expect(verdict.state).toBe('unknown')
    expect(CHILD_STATE_LABEL[verdict.state]).toBe('ReadyUnknown')
  })

  it('says unknown — never ready — for an empty or absent condition list', () => {
    // "Nothing was reported" is not "everything is fine": claiming health nobody observed is the
    // whole defect this module exists to prevent.
    expect(childStateFromConditions([]).state).toBe('unknown')
    expect(childStateFromConditions(undefined).state).toBe('unknown')
  })

  it('does not guess at a condition type whose polarity it does not know', () => {
    expect(childStateFromConditions([{ status: 'False', type: 'SomeBespokeCrdCondition' }]).state).toBe('unknown')
  })
})

describe('childStateFromStatusColor', () => {
  it('maps the status-pill palette to states — green is health ONLY', () => {
    expect(childStateFromStatusColor('green')).toBe('ready')
    expect(childStateFromStatusColor('red')).toBe('notReady')
    expect(childStateFromStatusColor('violet')).toBe('notSynced')
    expect(childStateFromStatusColor('orange')).toBe('pending')
  })

  it('maps anything non-status — and nothing at all — to unknown', () => {
    expect(childStateFromStatusColor('blue')).toBe('unknown')
    expect(childStateFromStatusColor(undefined)).toBe('unknown')
  })
})

describe('childHealthFromRow', () => {
  it('prefers the row data\'s RAW conditions over its resolved colour', () => {
    // A row painted green whose object says otherwise must not be believed.
    const health = childHealthFromRow({
      color: 'green',
      conditions: [{ status: 'True', type: 'Ready' }, { reason: 'ReconcileError', status: 'False', type: 'Synced' }],
      kind: 'Deployment',
      name: 'payments-api',
    })
    expect(health.state).toBe('notSynced')
    expect(health.detail).toBe('ReconcileError')
  })

  it('falls back to the resolved status colour when the row carries no conditions', () => {
    expect(childHealthFromRow({ color: 'red', kind: 'Service', name: 'api' }).state).toBe('notReady')
    expect(childHealthFromRow({ color: 'green', conditions: [], kind: 'ConfigMap', name: 'cfg' }).state).toBe('ready')
  })

  it('keeps the child\'s route, so the exception can be opened', () => {
    expect(childHealthFromRow({ color: 'red', href: '/resources/ns/apps/v1/deployments/api' }).href)
      .toBe('/resources/ns/apps/v1/deployments/api')
  })
})

describe('rollupChildHealth', () => {
  it('reads Ready when every child is ready', () => {
    const rollup = rollupChildHealth([child('a', 'ready'), child('b', 'ready'), child('c', 'ready')])
    expect(rollup.state).toBe('ready')
    expect(rollup.readyCount).toBe(3)
    // Exception-only: a clean set gives the header NOTHING to draw.
    expect(rollup.worst).toBeUndefined()
    expect(describeChildHealth(rollup)).toBe('')
  })

  it('reads NotReady when ONE child of many is not ready, and names that child', () => {
    const rollup = rollupChildHealth([
      child('cfg', 'ready'),
      child('payments-api', 'notReady', { detail: 'Unavailable · pods are not available' }),
      child('svc', 'ready'),
    ])
    expect(rollup.state).toBe('notReady')
    expect(rollup.worst?.name).toBe('payments-api')
    expect(describeChildHealth(rollup)).toBe(
      '1 of 3 children not Ready — NotReady: Deployment/payments-api (Unavailable · pods are not available)',
    )
  })

  it('a child that is Ready=True but Synced=False still stops the parent reading Ready', () => {
    const drifted = childHealthFromRow({
      conditions: [{ status: 'True', type: 'Ready' }, { reason: 'ReconcileError', status: 'False', type: 'Synced' }],
      kind: 'Deployment',
      name: 'drifted',
    })
    const rollup = rollupChildHealth([child('a', 'ready'), drifted])
    expect(rollup.state).toBe('notSynced')
    expect(rollup.worst?.name).toBe('drifted')
    expect(describeChildHealth(rollup)).toContain('NotSynced: Deployment/drifted')
  })

  it('ranks a failed child above a drifted one, and drift above pending/unknown', () => {
    const rollup = rollupChildHealth([
      child('pending', 'pending'),
      child('unknown', 'unknown'),
      child('drifted', 'notSynced'),
      child('broken', 'notReady'),
    ])
    expect(rollup.state).toBe('notReady')
    expect(rollup.exceptions.map((entry) => entry.name)).toEqual(['broken', 'drifted', 'unknown', 'pending'])
    expect(describeChildHealth(rollup)).toContain('+3 more')
  })

  it('surfaces an unknown child as an exception — unobserved is not healthy', () => {
    const rollup = rollupChildHealth([child('a', 'ready'), child('ghost', 'unknown')])
    expect(rollup.state).toBe('unknown')
    expect(describeChildHealth(rollup)).toContain('ReadyUnknown: Deployment/ghost')
  })

  it('claims nothing at all for an empty set of children', () => {
    const rollup = rollupChildHealth([])
    expect(rollup.total).toBe(0)
    expect(rollup.worst).toBeUndefined()
    expect(rollup.exceptions).toEqual([])
    expect(describeChildHealth(rollup)).toBe('')
  })

  it('survives a non-array report without inventing a verdict', () => {
    const rollup = rollupChildHealth(undefined as unknown as ChildHealth[])
    expect(rollup.total).toBe(0)
    expect(rollup.worst).toBeUndefined()
  })

  it('says "child", singular, when there is exactly one', () => {
    const rollup = rollupChildHealth([child('only', 'notReady')])
    expect(describeChildHealth(rollup)).toBe('1 of 1 child not Ready — NotReady: Deployment/only')
  })
})
