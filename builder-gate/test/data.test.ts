/**
 * The data step: each draft RESTAction resolved BY SNOWPLOW, as the caller, nothing stored
 * (POST /resolve?dryRun=All, docs/snowplow-contract.md). The gate evaluates nothing itself.
 */
import { describe, expect, it } from 'vitest'

import { confirmed, example, fakeSnowplow, json, liveCtx, recorder, run } from './helpers'

const dataOf = (envelope: Awaited<ReturnType<typeof run>>) => envelope.steps.find((s) => s.name === 'data')!

describe('data', () => {
  it('shows the agent what snowplow resolved, as a count and a sample', async () => {
    const { transport, requests } = recorder(fakeSnowplow({
      resolve: (body) => confirmed(200, { ...body.restAction, status: { pods: [{ name: 'a', phase: 'Running', cpu: 750 }] } }),
    }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.ok).toBe(true)
    expect(dataOf(envelope).notes).toContain('widgets[3] (RESTAction/pod-sizing): yields a object; sample {"pods":[{"name":"a","phase":"Running","cpu":750}]}')
    const resolve = requests.find((r) => new URL(r.url).pathname === '/resolve')!
    expect(resolve).toMatchObject({ method: 'POST', url: 'http://snowplow.test/resolve?dryRun=All', headers: { Authorization: 'Bearer caller-jwt' } })
    expect(JSON.parse(resolve.body!)).toMatchObject({ namespace: 'krateo-preview', restAction: { kind: 'RESTAction', metadata: { name: 'pod-sizing' } } })
  })

  it('today\'s snowplow (no inline resolve): live verdict missing, red, nothing run', async () => {
    const { transport, requests } = recorder(fakeSnowplow({ capabilities: ['call.raw', 'call.dryRun'] }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems).toEqual([
      'live verdict missing: this snowplow cannot yet resolve a RESTAction without storing it (resolve.inline, docs/snowplow-contract.md) — no RESTAction in the draft was run',
    ])
    expect(requests.some((r) => new URL(r.url).pathname === '/resolve')).toBe(false)
  })

  it('a resolve without the X-Krateo-Dry-Run confirmation is never a pass', async () => {
    const { transport } = recorder(fakeSnowplow({ resolve: (body) => json(200, { ...body.restAction, status: {} }) }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems[0]).toMatch(/without x-krateo-dry-run: All — it may have persisted the RESTAction/)
  })

  it('a RESTAction snowplow cannot resolve is red, with snowplow\'s message', async () => {
    const { transport } = recorder(fakeSnowplow({ resolve: () => json(422, { kind: 'Status', code: 422, message: 'unable to resolve filter: cannot iterate over: null' }) }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems[0]).toBe('widgets[3] (RESTAction/pod-sizing): snowplow could not resolve it (422): unable to resolve filter: cannot iterate over: null')
  })

  it('a draft with no RESTAction has nothing to resolve', async () => {
    const draft = example().filter((cr) => cr.kind !== 'RESTAction')
    for (const cr of draft) {
      if (cr.spec.apiRef) {
        cr.spec.apiRef = { name: 'compositions-list', namespace: 'krateo-system' }
      }
    }
    const { transport } = recorder(fakeSnowplow({ read: () => json(200, { kind: 'RESTAction', spec: { api: [{ name: 'l', path: '/apis/composition.krateo.io' }] } }) }))
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.ok).toBe(true)
    expect(dataOf(envelope).notes).toEqual(['no RESTAction in the draft — nothing to resolve'])
  })
})
