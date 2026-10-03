/**
 * live-dry-run against a fake API server: every answer the real one gives is classified, and
 * notChecked is RED (#442 D9). The kind job (.github/workflows/builder-gate.yaml) runs the same
 * step against a real API server.
 */
import { describe, expect, it } from 'vitest'

import { HttpError, type HttpRequest } from '../src/http'
import { classifyDryRun } from '../src/pages/dryRun'
import { example, json, liveCtx, recorder, run } from './helpers'

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

const allValidated = (req: HttpRequest) => (req.method === 'POST' ? json(201, {}) : json(200, {}))

describe('live-dry-run', () => {
  it('every object accepted → green, and coverage says so', async () => {
    const { transport } = recorder(async (req) => (req.url.startsWith('http://snowplow.test') ? json(200, { pods: [] }) : req.url.startsWith('https://hop.test') ? json(200, { items: [] }) : allValidated(req)))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.steps.find((s) => s.name === 'live-dry-run')?.ok).toBe(true)
    expect(envelope.coverage).toMatchObject({ objects: 4, validated: 4, rejected: 0, notChecked: 0, summary: 'API server accepted all 4 objects' })
  })

  it('a CEL rejection fails the step, attributed to the object, with the API server\'s message', async () => {
    const { transport } = recorder((req) => (req.url.includes('/restactions?')
      ? json(422, { kind: 'Status', reason: 'Invalid', code: 422, message: 'RESTAction.templates.krateo.io "pod-sizing" is invalid: spec.api[0]: Invalid value: "object": userAccessFilter must specify a non-empty verb' })
      : allValidated(req)))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.steps.at(-2)?.problems).toEqual([
      'widgets[3] (RESTAction/pod-sizing): rejected: RESTAction.templates.krateo.io "pod-sizing" is invalid: spec.api[0]: Invalid value: "object": userAccessFilter must specify a non-empty verb',
    ])
    expect(envelope.coverage?.summary).toBe('API server accepted 3 of 4 objects (1 rejected, 0 not checked)')
  })

  it('Forbidden is notChecked AND red', async () => {
    const { transport } = recorder((req) => (req.method === 'POST' ? json(403, { kind: 'Status', reason: 'Forbidden', code: 403, message: 'tables.widgets.templates.krateo.io is forbidden' }) : json(200, {})))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.ok).toBe(false)
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.coverage).toMatchObject({ validated: 0, notChecked: 4 })
    expect(envelope.steps.find((s) => s.name === 'live-dry-run')?.problems[0]).toMatch(/notChecked: Forbidden/)
  })

  it('an unreachable or slow API server is notChecked AND red', async () => {
    const { transport } = recorder((req) => {
      if (req.method === 'POST') {
        throw new HttpError('no answer within 20000 ms', 'timeout')
      }
      return json(200, {})
    })
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.coverage?.notChecked).toBe(4)
  })

  it('no sandbox namespace (previewSandbox off) is notChecked AND red', async () => {
    const { transport } = recorder((req) => (req.method === 'POST'
      ? json(404, { kind: 'Status', reason: 'NotFound', code: 404, details: { name: 'krateo-preview', kind: 'namespaces' }, message: 'namespaces "krateo-preview" not found' })
      : json(200, {})))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.steps.find((s) => s.name === 'live-dry-run')?.problems[0]).toMatch(/sandbox namespace krateo-preview does not exist/)
  })

  it('no API server identity at all is notChecked AND red', async () => {
    const { transport } = recorder(() => json(200, {}))
    const envelope = await run(example(), { ...liveCtx(transport), kube: null })
    expect(envelope.failedStep).toBe('live-dry-run')
    expect(envelope.coverage?.notChecked).toBe(4)
  })

  it('submits each object into the sandbox, whatever namespace the draft names', async () => {
    const { transport, requests } = recorder(allValidated)
    await run(example(), liveCtx(transport, { callerToken: null }))
    const posts = requests.filter((r) => r.method === 'POST')
    expect(posts.map((r) => r.url)).toEqual([
      'https://apiserver.test/apis/widgets.templates.krateo.io/v1beta1/namespaces/krateo-preview/flexes?dryRun=All&fieldValidation=Strict',
      'https://apiserver.test/apis/widgets.templates.krateo.io/v1beta1/namespaces/krateo-preview/piecharts?dryRun=All&fieldValidation=Strict',
      'https://apiserver.test/apis/widgets.templates.krateo.io/v1beta1/namespaces/krateo-preview/tables?dryRun=All&fieldValidation=Strict',
      'https://apiserver.test/apis/templates.krateo.io/v1/namespaces/krateo-preview/restactions?dryRun=All&fieldValidation=Strict',
    ])
    expect(posts.map((r) => JSON.parse(r.body!).metadata.namespace)).toEqual(['krateo-preview', 'krateo-preview', 'krateo-preview', 'krateo-preview'])
  })
})
