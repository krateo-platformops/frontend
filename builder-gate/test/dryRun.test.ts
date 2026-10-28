/**
 * live-dry-run against a fake snowplow speaking snowplow#443 (docs/snowplow-contract.md): every
 * answer the API server gives through /call/dry-run is classified, and notChecked and "live
 * verdict missing" are RED (#442 D9). Above all: on a snowplow that has not advertised the
 * dry-run route the gate POSTs nothing, an older snowplow that 404s /call/dry-run stays red with
 * nothing written, and no answer without the X-Snowplow-Dry-Run echo is ever a verdict.
 */
import { describe, expect, it } from 'vitest'

import { HttpError, type HttpRequest } from '../src/http'
import { classifyDryRun } from '../src/pages/dryRun'
import { dryRunEcho, dryRunReply, example, fakeSnowplow, json, liveCtx, recorder, run } from './helpers'

const reply = (status: number, body: unknown, headers: Record<string, string> = dryRunEcho) => ({ status, json: body, body: JSON.stringify(body), headers })

describe('classifyDryRun', () => {
  it('no verdict counts without snowplow\'s X-Snowplow-Dry-Run: All echo — not even a 201 or a 409', () => {
    for (const status of [201, 409, 422]) {
      const unechoed = classifyDryRun(reply(status, { reason: status === 409 ? 'AlreadyExists' : 'Invalid', message: 'x' }, {}), 'krateo-preview')
      expect(unechoed.verdict, String(status)).toBe('notChecked')
      expect(unechoed.detail).toMatch(/without x-snowplow-dry-run: All, so it is not the API server's verdict on a dry run/)
    }
  })
  it('a snowplow validation 400 (no echo) judges nothing', () => {
    expect(classifyDryRun(reply(400, { message: 'dry-run writes use /call/dry-run' }, {}), 'krateo-preview').verdict).toBe('notChecked')
  })
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

const posts = (requests: HttpRequest[]) => requests.filter((r) => r.method === 'POST' && new URL(r.url).pathname === '/call/dry-run')

describe('live-dry-run, through snowplow as the caller', () => {
  it('every object accepted → green, and coverage says so', async () => {
    const { transport } = recorder(fakeSnowplow())
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.steps.find((s) => s.name === 'live-dry-run')?.ok).toBe(true)
    expect(envelope.coverage).toMatchObject({ objects: 4, validated: 4, rejected: 0, notChecked: 0, summary: 'API server accepted all 4 objects' })
  })

  it('a snowplow before 1.12.36 (no /capabilities): live verdict missing, red — and nothing is POSTed', async () => {
    const { transport, requests } = recorder(fakeSnowplow({ capabilities: null }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.ok).toBe(false)
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.steps.find((s) => s.name === 'live-dry-run')?.problems).toEqual([
      'live verdict missing: this snowplow does not yet offer the dry-run route (call.dryRun, call.fieldValidation; snowplow 1.12.36, docs/snowplow-contract.md) — no object was judged by the API server',
    ])
    expect(envelope.coverage).toMatchObject({ validated: 0, notChecked: 4 })
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([])
  })

  it('call.dryRun without call.fieldValidation: still missing, nothing POSTed', async () => {
    const { transport, requests } = recorder(fakeSnowplow({ capabilities: ['call.dryRun', 'call.raw', 'call.read.inline'] }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(posts(requests)).toEqual([])
  })

  it('an OLD snowplow that 404s /call/dry-run (even if it claimed the token): red, and nothing written', async () => {
    const { transport, requests } = recorder(fakeSnowplow({ dryRunRoute: false }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.coverage).toMatchObject({ validated: 0, notChecked: 4 })
    expect(envelope.steps.find((s) => s.name === 'live-dry-run')?.problems[0]).toMatch(/snowplow answered 404 without x-snowplow-dry-run: All/)
    // The only writes ever attempted went to /call/dry-run, which that snowplow does not serve.
    expect(requests.filter((r) => r.method !== 'GET').every((r) => new URL(r.url).pathname === '/call/dry-run')).toBe(true)
  })

  it('a 2xx without the echo is never a pass: the object may have been stored', async () => {
    const { transport } = recorder(fakeSnowplow({ dryRun: (_url, body) => json(201, body) }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.coverage?.validated).toBe(0)
    expect(envelope.steps.find((s) => s.name === 'live-dry-run')?.problems[0]).toMatch(/without x-snowplow-dry-run: All and x-snowplow-field-validation: Strict — the object may have been PERSISTED in krateo-preview/)
  })

  it('an echo naming another fieldValidation than Strict is never a pass', async () => {
    const { transport } = recorder(fakeSnowplow({ dryRun: (_url, body) => json(201, body, { 'x-snowplow-dry-run': 'All', 'x-snowplow-field-validation': 'Ignore' }) }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.coverage?.validated).toBe(0)
  })

  it('a 409 AlreadyExists without the echo is notChecked, and red', async () => {
    const { transport } = recorder(fakeSnowplow({ dryRun: () => json(409, { kind: 'Status', reason: 'AlreadyExists', code: 409, message: 'already exists' }) }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.coverage).toMatchObject({ validated: 0, notChecked: 4 })
  })

  it('a CEL rejection fails the step, attributed to the object, with the API server\'s message', async () => {
    const { transport } = recorder(fakeSnowplow({
      dryRun: (url, body) => (url.searchParams.get('resource') === 'restactions'
        ? dryRunReply(422, { kind: 'Status', reason: 'Invalid', code: 422, message: 'RESTAction.templates.krateo.io "pod-sizing" is invalid: spec.api[0]: Invalid value: "object": userAccessFilter must specify a non-empty verb' })
        : dryRunReply(201, body)),
    }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.steps.at(-2)?.problems).toEqual([
      'widgets[3] (RESTAction/pod-sizing): rejected: RESTAction.templates.krateo.io "pod-sizing" is invalid: spec.api[0]: Invalid value: "object": userAccessFilter must specify a non-empty verb',
    ])
    expect(envelope.coverage?.summary).toBe('API server accepted 3 of 4 objects (1 rejected, 0 not checked)')
  })

  it('Forbidden for the caller is notChecked AND red', async () => {
    const { transport } = recorder(fakeSnowplow({ dryRun: () => dryRunReply(403, { kind: 'Status', reason: 'Forbidden', code: 403, message: 'tables.widgets.templates.krateo.io is forbidden' }) }))
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
    const { transport } = recorder(fakeSnowplow({ dryRun: () => dryRunReply(404, { kind: 'Status', reason: 'NotFound', code: 404, details: { name: 'krateo-preview', kind: 'namespaces' }, message: 'namespaces "krateo-preview" not found' }) }))
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

  it('submits each object to /call/dry-run in the sandbox, as the caller, whatever namespace the draft names', async () => {
    const { transport, requests } = recorder(fakeSnowplow())
    await run(example(), liveCtx(transport))
    expect(posts(requests).map((r) => r.url)).toEqual([
      'http://snowplow.test/call/dry-run?apiVersion=widgets.templates.krateo.io%2Fv1beta1&resource=flexes&namespace=krateo-preview&name=page-pod-sizing&dryRun=All&fieldValidation=Strict',
      'http://snowplow.test/call/dry-run?apiVersion=widgets.templates.krateo.io%2Fv1beta1&resource=piecharts&namespace=krateo-preview&name=pod-phase-pie&dryRun=All&fieldValidation=Strict',
      'http://snowplow.test/call/dry-run?apiVersion=widgets.templates.krateo.io%2Fv1beta1&resource=tables&namespace=krateo-preview&name=pod-sizing-table&dryRun=All&fieldValidation=Strict',
      'http://snowplow.test/call/dry-run?apiVersion=templates.krateo.io%2Fv1&resource=restactions&namespace=krateo-preview&name=pod-sizing&dryRun=All&fieldValidation=Strict',
    ])
    expect(posts(requests).every((r) => r.headers?.Authorization === 'Bearer caller-jwt')).toBe(true)
    expect(posts(requests).map((r) => JSON.parse(r.body!).metadata.namespace)).toEqual(['krateo-preview', 'krateo-preview', 'krateo-preview', 'krateo-preview'])
  })
})
