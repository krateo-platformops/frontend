/**
 * live-dry-run against a fake snowplow speaking docs/snowplow-contract.md: every answer the API
 * server gives (snowplow forwards it) is classified, and notChecked and "live verdict missing" are
 * RED (#442 D9). Above all: on a snowplow that has not advertised the dry-run forward, the gate
 * POSTs nothing — today's snowplow would create the object for real.
 */
import { describe, expect, it } from 'vitest'

import { HttpError, type HttpRequest } from '../src/http'
import { classifyDryRun } from '../src/pages/dryRun'
import { confirmed, example, fakeSnowplow, json, liveCtx, recorder, run } from './helpers'

const reply = (status: number, body: unknown) => ({ status, json: body, body: JSON.stringify(body), warnings: [] })

describe('classifyDryRun', () => {
  it.each([
    [201, {}, 'validated'],
    [409, { reason: 'AlreadyExists', message: 'exists' }, 'validated'],
    [422, { reason: 'Invalid', message: 'spec.api[0]: Invalid value: "object": userAccessFilter is only allowed on read-verb HTTP stages' }, 'rejected'],
    [400, { reason: 'BadRequest', message: 'strict decoding error: unknown field "spec.bogus"' }, 'rejected'],
    [403, { reason: 'Forbidden', message: 'forbidden' }, 'notChecked'],
    [401, { reason: 'Unauthorized', message: 'Unauthorized' }, 'notChecked'],
    [404, { reason: 'NotFound', details: { name: 'krateo-preview', kind: 'namespaces' }, message: 'namespaces "krateo-preview" not found' }, 'notChecked'],
    [404, { reason: 'NotFound', message: 'the server could not find the requested resource' }, 'rejected'],
    [500, { reason: 'InternalError', message: 'webhook down' }, 'notChecked'],
    [429, { reason: 'TooManyRequests', message: 'slow down' }, 'notChecked'],
  ])('%i %j → %s', (status, body, verdict) => {
    expect(classifyDryRun(reply(status, body), 'krateo-preview').verdict).toBe(verdict)
  })
})

const posts = (requests: HttpRequest[]) => requests.filter((r) => r.method === 'POST' && new URL(r.url).pathname === '/call')

describe('live-dry-run, through snowplow as the caller', () => {
  it('every object accepted → green, and coverage says so', async () => {
    const { transport } = recorder(fakeSnowplow())
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.steps.find((s) => s.name === 'live-dry-run')?.ok).toBe(true)
    expect(envelope.coverage).toMatchObject({ objects: 4, validated: 4, rejected: 0, notChecked: 0, summary: 'API server accepted all 4 objects' })
  })

  it('TODAY\'S snowplow (no /capabilities): live verdict missing, red — and nothing is POSTed', async () => {
    const { transport, requests } = recorder(fakeSnowplow({ capabilities: null }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.ok).toBe(false)
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.steps.find((s) => s.name === 'live-dry-run')?.problems).toEqual([
      'live verdict missing: this snowplow does not yet forward dryRun on /call (call.dryRun, docs/snowplow-contract.md) — no object was judged by the API server',
    ])
    expect(envelope.coverage).toMatchObject({ validated: 0, notChecked: 4 })
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([])
  })

  it('a snowplow that offers other things but not call.dryRun: still missing, still nothing POSTed', async () => {
    const { transport, requests } = recorder(fakeSnowplow({ capabilities: ['resolve.inline'] }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(posts(requests)).toEqual([])
  })

  it('a 2xx without the X-Krateo-Dry-Run confirmation is never a pass: the object may have been stored', async () => {
    const { transport } = recorder(fakeSnowplow({ dryRun: (_url, body) => json(201, body) }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.coverage?.validated).toBe(0)
    expect(envelope.steps.find((s) => s.name === 'live-dry-run')?.problems[0]).toMatch(/without x-krateo-dry-run: All — the object may have been PERSISTED in krateo-preview/)
  })

  it('a CEL rejection fails the step, attributed to the object, with the API server\'s message', async () => {
    const { transport } = recorder(fakeSnowplow({
      dryRun: (url, body) => (url.searchParams.get('resource') === 'restactions'
        ? json(422, { kind: 'Status', reason: 'Invalid', code: 422, message: 'RESTAction.templates.krateo.io "pod-sizing" is invalid: spec.api[0]: Invalid value: "object": userAccessFilter must specify a non-empty verb' })
        : confirmed(201, body)),
    }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.steps.at(-2)?.problems).toEqual([
      'widgets[3] (RESTAction/pod-sizing): rejected: RESTAction.templates.krateo.io "pod-sizing" is invalid: spec.api[0]: Invalid value: "object": userAccessFilter must specify a non-empty verb',
    ])
    expect(envelope.coverage?.summary).toBe('API server accepted 3 of 4 objects (1 rejected, 0 not checked)')
  })

  it('Forbidden for the caller is notChecked AND red', async () => {
    const { transport } = recorder(fakeSnowplow({ dryRun: () => json(403, { kind: 'Status', reason: 'Forbidden', code: 403, message: 'tables.widgets.templates.krateo.io is forbidden' }) }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.ok).toBe(false)
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.coverage).toMatchObject({ validated: 0, notChecked: 4 })
    expect(envelope.steps.find((s) => s.name === 'live-dry-run')?.problems[0]).toMatch(/notChecked: Forbidden — you may not create this kind in krateo-preview/)
  })

  it('an unreachable or slow snowplow is notChecked AND red', async () => {
    const fake = fakeSnowplow()
    const { transport } = recorder((req) => {
      if (req.method === 'POST') {
        throw new HttpError('no answer within 20000 ms', 'timeout')
      }
      return fake(req)
    })
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.coverage?.notChecked).toBe(4)
  })

  it('no sandbox namespace (previewSandbox off) is notChecked AND red', async () => {
    const { transport } = recorder(fakeSnowplow({ dryRun: () => json(404, { kind: 'Status', reason: 'NotFound', code: 404, details: { name: 'krateo-preview', kind: 'namespaces' }, message: 'namespaces "krateo-preview" not found' }) }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.steps.find((s) => s.name === 'live-dry-run')?.problems[0]).toMatch(/sandbox namespace krateo-preview does not exist/)
  })

  it('no caller token: notChecked AND red, nothing sent', async () => {
    const { transport, requests } = recorder(fakeSnowplow())
    const envelope = await run(example(), liveCtx(transport, { callerToken: null }))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.coverage?.notChecked).toBe(4)
    expect(requests).toEqual([])
  })

  it('submits each object into the sandbox as the caller, whatever namespace the draft names', async () => {
    const { transport, requests } = recorder(fakeSnowplow())
    await run(example(), liveCtx(transport))
    expect(posts(requests).map((r) => r.url)).toEqual([
      'http://snowplow.test/call?apiVersion=widgets.templates.krateo.io%2Fv1beta1&resource=flexes&namespace=krateo-preview&name=page-pod-sizing&dryRun=All&fieldValidation=Strict',
      'http://snowplow.test/call?apiVersion=widgets.templates.krateo.io%2Fv1beta1&resource=piecharts&namespace=krateo-preview&name=pod-phase-pie&dryRun=All&fieldValidation=Strict',
      'http://snowplow.test/call?apiVersion=widgets.templates.krateo.io%2Fv1beta1&resource=tables&namespace=krateo-preview&name=pod-sizing-table&dryRun=All&fieldValidation=Strict',
      'http://snowplow.test/call?apiVersion=templates.krateo.io%2Fv1&resource=restactions&namespace=krateo-preview&name=pod-sizing&dryRun=All&fieldValidation=Strict',
    ])
    expect(posts(requests).every((r) => r.headers?.Authorization === 'Bearer caller-jwt')).toBe(true)
    expect(posts(requests).map((r) => JSON.parse(r.body!).metadata.namespace)).toEqual(['krateo-preview', 'krateo-preview', 'krateo-preview', 'krateo-preview'])
  })
})
