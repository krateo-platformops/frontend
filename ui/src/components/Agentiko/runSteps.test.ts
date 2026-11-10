/**
 * The run timeline's model: grouping, state, the "didn't finish" rule, counts and clocks.
 */
import { describe, expect, it } from 'vitest'

import {
  approvalOutcome,
  approvalOwnerId,
  countRun,
  entryStatus,
  formatAgo,
  formatClock,
  formatDuration,
  groupSteps,
  isRunUnfinished,
  lastEventAt,
} from './runSteps'
import type { AgentikoMessage, EvidenceEntry } from './types'

const get = (id: string, resourceType: string, over: Partial<EvidenceEntry> = {}): EvidenceEntry => ({
  args: { namespace: 'krateo-system', resource_type: resourceType },
  done: true,
  id,
  kind: 'cluster',
  tool: 'k8s_get_resources',
  ...over,
})

const delegation = (id: string, over: Partial<EvidenceEntry> = {}): EvidenceEntry => ({
  agent: 'core-provider-agent',
  id,
  kind: 'delegation',
  request: 'Diagnose it.',
  tool: 'krateo_system__NS__core_provider_agent',
  ...over,
})

const DONE = { live: false, paused: false }

describe('groupSteps — group, don’t repeat', () => {
  it('folds consecutive same-kind calls in the same namespace into one line with a count', () => {
    const steps = groupSteps([get('a', 'eventhealth'), get('b', 'deployment'), get('c', 'service')], DONE)
    expect(steps).toHaveLength(1)
    expect(steps[0].text).toBe('Read 3 resources')
    expect(steps[0].detail).toBe('Eventhealths, Deployments, Services · krateo-system')
    expect(steps[0].entries.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not fold across a namespace, a different tool, or a gap', () => {
    const other = get('b', 'pods', { args: { namespace: 'default', resource_type: 'pods' } })
    expect(groupSteps([get('a', 'pods'), other], DONE)).toHaveLength(2)
    const describe = { ...get('b', 'pods'), tool: 'k8s_describe_resource' }
    expect(groupSteps([get('a', 'pods'), describe, get('c', 'pods')], DONE)).toHaveLength(3)
  })

  it('never folds a failure into its neighbours — a folded failure is one nobody reads', () => {
    const steps = groupSteps([get('a', 'pods'), get('b', 'pods', { failed: true, reason: 'forbidden' }), get('c', 'pods')], DONE)
    expect(steps.map((step) => step.status)).toEqual(['done', 'failed', 'done'])
    expect(steps[1].reason).toBe('forbidden')
  })

  it('never folds hand-offs, and marks them as delegations', () => {
    const steps = groupSteps([delegation('d1', { done: true }), delegation('d2', { done: true })], DONE)
    expect(steps).toHaveLength(2)
    expect(steps[0].delegation?.id).toBe('d1')
  })

  it('a folded line is running while any member is, and spans first start to last end', () => {
    const live = { live: true, paused: false }
    const running = groupSteps([get('a', 'pods', { endedAt: 1400, startedAt: 1000 }), get('b', 'pods', { done: undefined, startedAt: 1500 })], live)
    expect(running[0].status).toBe('running')
    expect(running[0].startedAt).toBe(1000)
    expect(running[0].endedAt).toBeUndefined()
    const finished = groupSteps([get('a', 'pods', { endedAt: 1400, startedAt: 1000 }), get('b', 'pods', { endedAt: 2300, startedAt: 1500 })], live)
    expect(finished[0].status).toBe('done')
    expect([finished[0].startedAt, finished[0].endedAt]).toEqual([1000, 2300])
  })

  it('falls back to "<label> · N times" for a tool with no plural noun', () => {
    const unknown = (id: string): EvidenceEntry => ({ done: true, id, kind: 'tool', tool: 'foo_bar' })
    expect(groupSteps([unknown('a'), unknown('b')], DONE)[0].text).toBe('Ran foo bar · 2 times')
  })
})

describe('entryStatus', () => {
  it.each<[Partial<EvidenceEntry>, { live: boolean; paused: boolean }, string]>([
    [{ done: true }, DONE, 'done'],
    [{ done: true, failed: true }, DONE, 'failed'],
    [{}, { live: true, paused: false }, 'running'],
    [{}, { live: false, paused: true }, 'paused'],
    [{}, DONE, 'unfinished'],
  ])('%j in %j → %s', (over, ctx, status) => {
    expect(entryStatus(get('a', 'pods', { done: undefined, ...over }), ctx)).toBe(status)
  })
})

const message = (over: Partial<AgentikoMessage> = {}): AgentikoMessage => ({ createdAt: 1000, id: 'm1', role: 'assistant', text: '', ...over })

describe('isRunUnfinished — a stopped turn must not look alive', () => {
  it('is true for a turn not streaming whose last step never returned', () => {
    expect(isRunUnfinished(message({ evidence: [get('a', 'pods'), get('b', 'pods', { done: undefined })] }))).toBe(true)
  })

  it('is false while it streams, when the last step returned, or with no steps at all', () => {
    expect(isRunUnfinished(message({ evidence: [get('a', 'pods', { done: undefined })], streaming: true }))).toBe(false)
    expect(isRunUnfinished(message({ evidence: [get('a', 'pods')] }))).toBe(false)
    expect(isRunUnfinished(message({ evidence: [] }))).toBe(false)
  })

  it('is false for a turn paused on an approval — its open step is waiting on a person', () => {
    expect(isRunUnfinished(message({ approvalAt: 2000, evidence: [get('a', 'pods', { done: undefined })] }))).toBe(false)
  })
})

describe('counts and the last event', () => {
  it('counts calls without hand-offs, steps with them, and a specialist’s nested calls in both', () => {
    const entries = [get('a', 'pods'), delegation('d1', { done: true, sessionId: 's1' })]
    const children = { s1: [get('c1', 'pods'), get('c2', 'pods', { failed: true })] }
    expect(countRun(entries, children)).toEqual({ agents: ['core-provider-agent'], calls: 3, failed: 1, steps: 4 })
  })

  it('takes the newest of creation, answer text, approval and every step time', () => {
    expect(lastEventAt(message({ evidence: [get('a', 'pods', { endedAt: 5000, startedAt: 2000 })], lastEventAt: 4000 }))).toBe(5000)
    expect(lastEventAt(message({ lastEventAt: 9000 }))).toBe(9000)
    expect(lastEventAt(message())).toBe(1000)
  })
})

describe('time', () => {
  it.each([[0, '0:00'], [7_400, '0:07'], [134_000, '2:14'], [3_729_000, '1:02:09']])('clock %d → %s', (ms, text) => {
    expect(formatClock(ms)).toBe(text)
  })

  it.each([[400, '0.4s'], [9_940, '9.9s'], [36_000, '0:36']])('duration %d → %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })

  it.each([[30_000, 'just now'], [180_000, '3m ago'], [7_200_000, '2h ago'], [172_800_000, '2d ago']])('ago %d → %s', (ms, text) => {
    expect(formatAgo(ms)).toBe(text)
  })
})

describe('approvals across turns', () => {
  const paused = message({ approvalAt: 2000, id: 'p' })
  const resumed = message({ actions: [{ label: 'approved k8s_apply_manifest', readOnly: false, verb: 'approval' }], id: 'r' })

  it('reads the decision from the chip on the turn that resumed it', () => {
    expect(approvalOutcome([paused, resumed], 0)).toBe('approved k8s_apply_manifest')
    expect(approvalOutcome([paused], 0)).toBeUndefined()
  })

  it('does not borrow a later approval’s decision', () => {
    expect(approvalOutcome([paused, message({ approvalAt: 3000, id: 'p2' }), resumed], 0)).toBeUndefined()
  })

  it('the pending approval belongs to the newest turn that paused', () => {
    const user = { createdAt: 1, id: 'u', role: 'user' as const, text: 'q' }
    expect(approvalOwnerId([paused, user, message({ id: 'later' })])).toBe('p')
    expect(approvalOwnerId([message({ id: 'a1' }), user])).toBe('a1')
  })
})
