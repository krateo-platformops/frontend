/**
 * The data step: each draft RESTAction resolved BY SNOWPLOW, as the caller, nothing stored
 * (POST /call/read with the draft in the body — snowplow#443, docs/snowplow-contract.md). The gate
 * evaluates nothing itself; it reads back stage errors and drops anything Secret-shaped.
 */
import { describe, expect, it } from 'vitest'

import { secretShaped, withoutSecrets } from '../src/pages/data'
import { byKind, example, fakeSnowplow, json, liveCtx, rawReply, recorder, resolveReply, run } from './helpers'

const dataOf = (envelope: Awaited<ReturnType<typeof run>>) => envelope.steps.find((s) => s.name === 'data')!

describe('data', () => {
  it('shows the agent what snowplow resolved, as a count and a sample', async () => {
    const { transport, requests } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200, { ...body.object, status: { pods: [{ name: 'a', phase: 'Running', cpu: 750 }] } }),
    }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.ok).toBe(true)
    expect(dataOf(envelope).notes).toContain('widgets[3] (RESTAction/pod-sizing): yields a object; sample {"pods":[{"name":"a","phase":"Running","cpu":750}]}')
    const resolve = requests.find((r) => new URL(r.url).pathname === '/call/read')!
    expect(resolve).toMatchObject({
      method: 'POST',
      url: 'http://snowplow.test/call/read?apiVersion=templates.krateo.io%2Fv1&resource=restactions&namespace=krateo-preview&name=pod-sizing',
      headers: { Authorization: 'Bearer caller-jwt' },
    })
    // The design requires the body's metadata to match the query: the draft resolves in the sandbox.
    expect(JSON.parse(resolve.body!)).toMatchObject({ extras: {}, object: { kind: 'RESTAction', metadata: { name: 'pod-sizing', namespace: 'krateo-preview' } } })
  })

  it('a snowplow without call.read.inline: live verdict missing, red, nothing run', async () => {
    const { transport, requests } = recorder(fakeSnowplow({ capabilities: ['call.dryRun', 'call.fieldValidation', 'call.raw'] }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems).toEqual([
      'live verdict missing: this snowplow cannot yet resolve a RESTAction without storing it (call.read.inline; snowplow 1.12.36, docs/snowplow-contract.md) — no RESTAction in the draft was run',
    ])
    expect(requests.some((r) => new URL(r.url).pathname === '/call/read')).toBe(false)
  })

  it('an OLD snowplow answers /call/read by resolving the STORED RESTAction, without the echo: never a pass', async () => {
    const { transport } = recorder(fakeSnowplow({ resolve: () => json(200, { kind: 'RESTAction', status: { pods: ['from-the-stored-cr'] } }) }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems[0]).toMatch(/without x-snowplow-dry-run: All and x-snowplow-resolve-source: request-body — it resolved something other than this draft/)
    expect(JSON.stringify(envelope)).not.toContain('from-the-stored-cr')
  })

  it('a RESTAction snowplow cannot resolve is red, with snowplow\'s message', async () => {
    const { transport } = recorder(fakeSnowplow({ resolve: () => json(400, { kind: 'Status', code: 400, message: 'metadata.namespace must equal the query namespace' }) }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems[0]).toBe('widgets[3] (RESTAction/pod-sizing): snowplow could not resolve it (400): metadata.namespace must equal the query namespace')
  })

  it('a write-verb stage refused BY DESIGN (StageNotExecuted in the outcomes header) is a note, with the body message as detail', async () => {
    const draft = example()
    byKind(draft, 'RESTAction').spec.api.push({ name: 'review', path: '/api/v1/namespaces/krateo-system/configmaps', verb: 'POST' })
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200,
        { ...body.object, status: { pods: [], error: [{ code: 422, message: 'dry-run: stage "review" verb POST is not executed' }] } },
        [{ name: 'pods', ok: true }, { name: 'review', ok: false, reason: 'StageNotExecuted' }]),
    }))
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.ok).toBe(true)
    expect(dataOf(envelope).notes).toContain('widgets[3] (RESTAction/pod-sizing): stage review: not executed by design (a write-verb stage): checked at the driven Preview — dry-run: stage "review" verb POST is not executed')
  })

  it('the documented message is accepted as a fallback when the header gives another reason', async () => {
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200,
        { ...body.object, status: { error: [{ message: 'dry-run: stage "pods" verb PUT is not executed' }] } },
        [{ name: 'pods', ok: false, reason: 'Error' }]),
    }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.ok).toBe(true)
    expect(dataOf(envelope).notes.join('\n')).toContain('stage pods: not executed by design')
  })

  it('a failed stage with any other reason is red — even when a spec.filter dropped its error from the body', async () => {
    // The example's spec.filter keeps only .pods: the body carries no error at all; the header does.
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200, { ...body.object, status: { pods: [] } }, [{ name: 'pods', ok: false, reason: 'Forbidden' }]),
    }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems).toEqual(['widgets[3] (RESTAction/pod-sizing): stage pods failed (Forbidden)'])
  })

  it('a failed continueOnError stage is a note — matched by stage name; the same failure elsewhere stays red', async () => {
    const draft = example()
    Object.assign(byKind(draft, 'RESTAction').spec.api[0], { continueOnError: true, errorKey: 'podsErr' })
    byKind(draft, 'RESTAction').spec.api.push({ name: 'nodes', path: '/api/v1/nodes' })
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200, { ...body.object, status: { pods: [], podsErr: [{ code: 404, message: 'stage "pods": not found' }] } },
        [{ name: 'pods', ok: false, reason: 'NotFound' }, { name: 'nodes', ok: false, reason: 'Forbidden' }]),
    }))
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).notes).toContain('widgets[3] (RESTAction/pod-sizing): stage pods failed (NotFound) — continueOnError, the page is expected to cope; checked at the driven Preview — stage "pods": not found')
    expect(dataOf(envelope).problems).toEqual(['widgets[3] (RESTAction/pod-sizing): stage nodes failed (Forbidden)'])
  })

  it('a draft whose only failed stage is continueOnError passes', async () => {
    const draft = example()
    byKind(draft, 'RESTAction').spec.api[0].continueOnError = true
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200, { ...body.object, status: { pods: [] } }, [{ name: 'pods', ok: false, reason: 'Error' }]),
    }))
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.ok).toBe(true)
  })

  it('a truncated outcomes header is red', async () => {
    const { transport } = recorder(fakeSnowplow({ resolve: (_url, body) => resolveReply(200, { ...body.object, status: {} }, '{"truncated":true,"failed":7}') }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems).toEqual(['widgets[3] (RESTAction/pod-sizing): 7 stage(s) failed; x-snowplow-stage-outcomes was truncated, so which ones cannot be told'])
  })

  it('a MISSING outcomes header on an inline reply is red: a contract violation', async () => {
    const { transport } = recorder(fakeSnowplow({ resolve: (_url, body) => resolveReply(200, { ...body.object, status: { pods: [] } }, null) }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems).toEqual(['widgets[3] (RESTAction/pod-sizing): snowplow answered the inline resolve without x-snowplow-stage-outcomes — a contract violation: its stage outcomes cannot be known'])
  })

  it('a malformed outcomes header is red', async () => {
    const { transport } = recorder(fakeSnowplow({ resolve: (_url, body) => resolveReply(200, { ...body.object, status: {} }, '[{"name":"pods"}]') }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems[0]).toMatch(/is not the documented shape \(an entry is not \{name, ok, reason\}/)
  })

  it('Secret-shaped output is dropped before it reaches the envelope, and the drop is noted', async () => {
    const leak = { kind: 'Secret', metadata: { name: 'db' }, data: { password: 'aHVudGVyMg==' } }
    const shaped = { metadata: { name: 'no-kind' }, type: 'Opaque', data: { token: 'c2VjcmV0LXRva2Vu' } }
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200, { ...body.object, status: { items: [leak, { name: 'ok' }, shaped] } }),
    }))
    const envelope = await run(example(), liveCtx(transport))
    const text = JSON.stringify(envelope)
    expect(text).not.toContain('aHVudGVyMg==')
    expect(text).not.toContain('c2VjcmV0LXRva2Vu')
    expect(dataOf(envelope).notes).toContain('widgets[3] (RESTAction/pod-sizing): 2 Secret-shaped object(s) dropped from the output before it reached this envelope')
  })

  it('a draft with no RESTAction has nothing to resolve', async () => {
    const draft = example().filter((cr) => cr.kind !== 'RESTAction')
    for (const cr of draft) {
      if (cr.spec.apiRef) {
        cr.spec.apiRef = { name: 'compositions-list', namespace: 'krateo-system' }
      }
    }
    const { transport } = recorder(fakeSnowplow({ read: () => rawReply(200, { kind: 'RESTAction', spec: { api: [{ name: 'l', path: '/apis/composition.krateo.io' }] } }) }))
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.ok).toBe(true)
    expect(dataOf(envelope).notes).toEqual(['no RESTAction in the draft — nothing to resolve'])
  })
})

describe('secretShaped', () => {
  it.each([
    [{ kind: 'Secret' }, true],
    [{ metadata: {}, data: { a: 'YQ==' } }, true],
    [{ type: 'kubernetes.io/tls', data: { 'tls.crt': 'Y2VydA==', 'tls.key': 'a2V5' } }, true],
    [{ kind: 'ConfigMap', metadata: {}, data: { a: 'plain text, not base64!' } }, false],
    [{ data: { a: 'YQ==' } }, false],
    [{ name: 'x', count: 3 }, false],
  ])('%j → %s', (value, shaped) => {
    expect(secretShaped(value)).toBe(shaped)
  })
  it('drops at any depth and counts', () => {
    expect(withoutSecrets({ a: [{ b: { kind: 'Secret' } }] })).toEqual({ value: { a: [{ b: '[dropped by the gate: a Secret-shaped object]' }] }, dropped: 1 })
  })
})
