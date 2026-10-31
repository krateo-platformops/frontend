/**
 * The data step: each draft RESTAction resolved BY SNOWPLOW, as the caller, nothing stored
 * (POST /call/read with the draft in the body — snowplow#443, docs/snowplow-contract.md). The gate
 * evaluates nothing itself; it reads back stage errors and drops anything Secret-shaped.
 */
import { describe, expect, it } from 'vitest'

import { secretShaped, withoutSecrets } from '../src/pages/data'

import { allOk, byKind, example, fakeSnowplow, json, liveCtx, rawReply, recorder, resolveReply, run } from './helpers'

const dataOf = (envelope: Awaited<ReturnType<typeof run>>) => envelope.steps.find((s) => s.name === 'data')!

describe('data', () => {
  // The sample is `JSON.stringify` of whatever snowplow returned, so its key order is the
  // FIXTURE's insertion order on the next line — not a product decision. `sort-keys --fix` sorting
  // that fixture changes this expected string, which is how it first failed here.
  it('shows the agent what snowplow resolved, as a count and a sample', async () => {
    const { requests, transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200, { ...body.object, status: { pods: [{ cpu: 750, name: 'a', phase: 'Running' }] } }),
    }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.ok).toBe(true)
    expect(dataOf(envelope).notes).toContain('widgets[3] (RESTAction/pod-sizing): yields a object; sample {"pods":[{"cpu":750,"name":"a","phase":"Running"}]}')
    const resolve = requests.find((r) => new URL(r.url).pathname === '/call/read')!
    expect(resolve).toMatchObject({
      headers: { Authorization: 'Bearer caller-jwt' },
      method: 'POST',
      url: 'http://snowplow.test/call/read?apiVersion=templates.krateo.io%2Fv1&resource=restactions&namespace=krateo-preview&name=pod-sizing',
    })
    // The design requires the body's metadata to match the query: the draft resolves in the sandbox.
    expect(JSON.parse(resolve.body!)).toMatchObject({ extras: {}, object: { kind: 'RESTAction', metadata: { name: 'pod-sizing', namespace: 'krateo-preview' } } })
  })

  it('a snowplow without call.read.inline: live verdict missing, red, nothing run', async () => {
    const { requests, transport } = recorder(fakeSnowplow({ capabilities: ['call.dryRun', 'call.fieldValidation', 'call.raw'] }))
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
    const { transport } = recorder(fakeSnowplow({ resolve: () => json(400, { code: 400, kind: 'Status', message: 'metadata.namespace must equal the query namespace' }) }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems[0]).toBe('widgets[3] (RESTAction/pod-sizing): snowplow could not resolve it (400): metadata.namespace must equal the query namespace')
  })

  it('a write-verb stage refused BY DESIGN (StageNotExecuted in the outcomes header) is a note, with the body message as detail', async () => {
    const draft = example()
    byKind(draft, 'RESTAction').spec.api.push({ name: 'review', path: '/api/v1/namespaces/krateo-system/configmaps', verb: 'POST' })
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200,
        { ...body.object, status: { error: [{ code: 422, message: 'dry-run: stage "review" verb POST is not executed' }], pods: [] } },
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

  it('snowplow#904: a write SKIPPED because its continueOnError dependency failed is a NOTE, not red', async () => {
    // The regression this prevents. In a dry-run draft a failing continueOnError read followed
    // by a dependent write now reports Skipped; without semantics for it the gate calls it
    // "failed with an unknown reason" and the draft goes RED, where today it is two notes.
    const draft = example()
    Object.assign(byKind(draft, 'RESTAction').spec.api[0], { continueOnError: true, errorKey: 'podsErr' })
    byKind(draft, 'RESTAction').spec.api.push({ dependsOn: { name: 'pods' }, name: 'scale', path: '/api/v1/scale', verb: 'POST' })
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200, { ...body.object, status: { pods: [], podsErr: [{ code: 404, message: 'stage "pods": not found' }] } },
        [{ name: 'pods', ok: false, reason: 'NotFound' }, { dependsOn: 'pods', name: 'scale', ok: false, reason: 'Skipped' }]),
    }))
    const envelope = await run(draft, liveCtx(transport))
    expect(dataOf(envelope).notes).toContain('widgets[3] (RESTAction/pod-sizing): stage scale: not sent — it depends on stage pods, which is continueOnError; checked at the driven Preview')
    expect(dataOf(envelope).problems).toEqual([])
    expect(envelope.ok).toBe(true)
  })

  it('snowplow#904: a write SKIPPED because its dependency failed hard is red', async () => {
    const draft = example()
    byKind(draft, 'RESTAction').spec.api.push({ dependsOn: { name: 'pods' }, name: 'scale', path: '/api/v1/scale', verb: 'POST' })
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200, { ...body.object, status: {} },
        [{ name: 'pods', ok: false, reason: 'Forbidden' }, { dependsOn: 'pods', name: 'scale', ok: false, reason: 'Skipped' }]),
    }))
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems).toContain('widgets[3] (RESTAction/pod-sizing): stage scale: not sent because the stage it depends on, pods, failed')
  })

  it('snowplow#904: a skip chain resolves through the stage each one NAMES, not by position', async () => {
    // A -> B -> C, with an unrelated red stage sitting between B and C in the header. Positional
    // attribution would blame that one for C; dependsOn makes C inherit B, which inherits A.
    const draft = example()
    Object.assign(byKind(draft, 'RESTAction').spec.api[0], { continueOnError: true })
    byKind(draft, 'RESTAction').spec.api.push({ dependsOn: { name: 'pods' }, name: 'detach', path: '/api/v1/detach', verb: 'POST' })
    byKind(draft, 'RESTAction').spec.api.push({ name: 'other', path: '/api/v1/other' })
    byKind(draft, 'RESTAction').spec.api.push({ dependsOn: { name: 'detach' }, name: 'remove', path: '/api/v1/remove', verb: 'DELETE' })
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200, { ...body.object, status: {} }, [
        { name: 'pods', ok: false, reason: 'Error' },
        { dependsOn: 'pods', name: 'detach', ok: false, reason: 'Skipped' },
        { name: 'other', ok: false, reason: 'Forbidden' },
        { dependsOn: 'detach', name: 'remove', ok: false, reason: 'Skipped' },
      ]),
    }))
    const envelope = await run(draft, liveCtx(transport))
    const notes = dataOf(envelope).notes.join('\n')
    expect(notes).toContain('stage detach: not sent — it depends on stage pods, which is continueOnError')
    expect(notes).toContain('stage remove: not sent — it depends on stage detach, which was not sent because stage pods is continueOnError')
    // `other` is red on its own and must NOT have captured `remove`.
    expect(dataOf(envelope).problems).toEqual(['widgets[3] (RESTAction/pod-sizing): stage other failed (Forbidden)'])
  })

  it('snowplow#904: a Skipped outcome that names no dependency is red, and says so', async () => {
    const draft = example()
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200, { ...body.object, status: {} }, [{ name: 'pods', ok: false, reason: 'Skipped' }]),
    }))
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems[0]).toMatch(/stage pods: not sent, but x-snowplow-stage-outcomes does not name the stage it depends on/)
  })

  it('snowplow#911: [] is every stage succeeded — the shape a passing resolve actually sends', async () => {
    // Not a tautology: `allOk` below proves the gate also reads the pre-#911 shape, so this one
    // pins which of the two means success NOW. A gate that counted rows to learn how many stages
    // ran would read [] as "no stages" and pass a draft it never looked at.
    const draft = example()
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200, { ...body.object, status: { pods: [] } }, []),
    }))
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.ok).toBe(true)
    expect(dataOf(envelope).problems).toEqual([])
  })

  it('still reads an older snowplow, which listed succeeded stages as ok:true', async () => {
    const draft = example()
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200, { ...body.object, status: { pods: [] } }, allOk(body.object as Record<string, unknown>)),
    }))
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.ok).toBe(true)
    expect(dataOf(envelope).problems).toEqual([])
  })

  it('snowplow#904 F3: an ABORTED resolve is red once, naming the stages that never ran', async () => {
    // The resolve-level row: name "", then every declared stage as NotRun. Judged stage-by-stage
    // these would be one red line each, every one of them saying the resolve "stopped before it,
    // at no failed stage the header names" — true, useless, and N times over.
    const draft = example()
    byKind(draft, 'RESTAction').spec.api.push({ dependsOn: { name: 'nope' }, name: 'scale', path: '/api/v1/scale', verb: 'POST' })
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200, { ...body.object, status: {} }, [
        { name: '', ok: false, reason: 'Aborted' },
        { name: 'pods', ok: false, reason: 'NotRun' },
        { name: 'nodes', ok: false, reason: 'NotRun' },
        { name: 'scale', ok: false, reason: 'NotRun' },
      ]),
    }))
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems).toEqual([
      'widgets[3] (RESTAction/pod-sizing): snowplow aborted the resolve before running any stage — its dependsOn graph could not be ordered (a stage naming a dependency that does not exist, or a cycle); its declared stage(s) never ran: pods, nodes, scale',
    ])
    // …and not one per-stage line: no NotRun of an aborted resolve is attributed to anything.
    expect(dataOf(envelope).notes.filter((n) => /not run|not sent|stopped at/i.test(n))).toEqual([])
    expect(dataOf(envelope).problems).toHaveLength(1)
  })

  it('snowplow#904 F3: an abort that declared no stage is the Aborted row alone, and still red', async () => {
    // Confirmed against abortedResolve: it registers the declared names and returns, so with no
    // declared stage the value is just the resolve-level row. The verdict must not then read as
    // "all succeeded" — which is the whole reason the row exists instead of [].
    const { transport } = recorder(fakeSnowplow({
      resolve: (_url, body) => resolveReply(200, { ...body.object, status: {} }, [{ name: '', ok: false, reason: 'Aborted' }]),
    }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems).toEqual([
      'widgets[3] (RESTAction/pod-sizing): snowplow aborted the resolve before running any stage — its dependsOn graph could not be ordered (a stage naming a dependency that does not exist, or a cycle)',
    ])
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

  describe('NotRun: the resolve stopped at an earlier stage (snowplow truncates at the first hard failure)', () => {
    // Three stages in topological order; `review` is a write-verb stage.
    const threeStages = () => {
      const draft = example()
      byKind(draft, 'RESTAction').spec.api = [
        { name: 'review', path: '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews', verb: 'POST' },
        { name: 'pods', path: '/api/v1/namespaces/krateo-system/pods' },
        { name: 'nodes', path: '/api/v1/nodes' },
      ]
      return draft
    }
    const resolving = (outcomes: { name: string; ok: boolean; reason?: string }[], messages: string[] = []) =>
      recorder(fakeSnowplow({ resolve: (_url, body) => resolveReply(200, { ...body.object, status: { error: messages.map((message) => ({ message })) } }, outcomes) }))

    it('after a write-verb stage refused by design, the stages it stopped are notes too', async () => {
      const { transport } = resolving(
        [{ name: 'review', ok: false, reason: 'StageNotExecuted' }, { name: 'pods', ok: false, reason: 'NotRun' }, { name: 'nodes', ok: false, reason: 'NotRun' }],
        ['dry-run: stage "review" verb POST is not executed'],
      )
      const envelope = await run(threeStages(), liveCtx(transport))
      expect(envelope.ok).toBe(true)
      expect(dataOf(envelope).notes).toEqual(expect.arrayContaining([
        'widgets[3] (RESTAction/pod-sizing): stage pods: not run — the resolve stopped at stage review, which was not executed by design; checked at the driven Preview',
        'widgets[3] (RESTAction/pod-sizing): stage nodes: not run — the resolve stopped at stage review, which was not executed by design; checked at the driven Preview',
      ]))
    })

    it('after a continueOnError stage that stopped the resolve, a note', async () => {
      const draft = threeStages()
      byKind(draft, 'RESTAction').spec.api[1].continueOnError = true
      const { transport } = resolving([{ name: 'review', ok: true }, { name: 'pods', ok: false, reason: 'Error' }, { name: 'nodes', ok: false, reason: 'NotRun' }])
      const envelope = await run(draft, liveCtx(transport))
      expect(envelope.ok).toBe(true)
      expect(dataOf(envelope).notes).toContain('widgets[3] (RESTAction/pod-sizing): stage nodes: not run — the resolve stopped at stage pods, which is continueOnError; checked at the driven Preview')
    })

    it('after a real failure, red with it', async () => {
      const { transport } = resolving([{ name: 'review', ok: true }, { name: 'pods', ok: false, reason: 'Forbidden' }, { name: 'nodes', ok: false, reason: 'NotRun' }])
      const envelope = await run(threeStages(), liveCtx(transport))
      expect(envelope.failedStep).toBe('data')
      expect(dataOf(envelope).problems).toEqual([
        'widgets[3] (RESTAction/pod-sizing): stage pods failed (Forbidden)',
        'widgets[3] (RESTAction/pod-sizing): stage nodes: not run — the resolve stopped at stage pods (Forbidden)',
      ])
    })

    it('with no failed stage before it, red', async () => {
      const { transport } = resolving([{ name: 'review', ok: true }, { name: 'pods', ok: true }, { name: 'nodes', ok: false, reason: 'NotRun' }])
      const envelope = await run(threeStages(), liveCtx(transport))
      expect(envelope.failedStep).toBe('data')
      expect(dataOf(envelope).problems).toEqual(['widgets[3] (RESTAction/pod-sizing): stage nodes: not run — the resolve stopped before it, at no failed stage the header names'])
    })
  })

  it.each([
    ['a reason outside the closed set', { name: 'pods', ok: false, reason: 'Timeout' }, /stage pods failed with an unknown reason "Timeout" — not one of snowplow's codes/],
    ['a failed stage with no reason', { name: 'pods', ok: false }, /stage pods failed with an unknown reason null/],
  ])('%s is red', async (_what, outcome, message) => {
    const { transport } = recorder(fakeSnowplow({ resolve: (_url, body) => resolveReply(200, { ...body.object, status: {} }, [outcome]) }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems[0]).toMatch(message)
  })

  it('a truncated outcomes header is red', async () => {
    const { transport } = recorder(fakeSnowplow({ resolve: (_url, body) => resolveReply(200, { ...body.object, status: {} }, '{"truncated":true,"failed":7}') }))
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems).toEqual(['widgets[3] (RESTAction/pod-sizing): 7 stage(s) did not succeed; x-snowplow-stage-outcomes was truncated, so which ones — and whether any stage ran at all — cannot be told'])
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
    expect(dataOf(envelope).problems[0]).toMatch(/is not the documented shape \(an entry is not \{name, ok, reason, dependsOn\}/)
  })

  it('Secret-shaped output is dropped before it reaches the envelope, and the drop is noted', async () => {
    const leak = { data: { password: 'aHVudGVyMg==' }, kind: 'Secret', metadata: { name: 'db' } }
    const shaped = { data: { token: 'c2VjcmV0LXRva2Vu' }, metadata: { name: 'no-kind' }, type: 'Opaque' }
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
    [{ data: { a: 'YQ==' }, metadata: {} }, true],
    [{ data: { 'tls.crt': 'Y2VydA==', 'tls.key': 'a2V5' }, type: 'kubernetes.io/tls' }, true],
    [{ data: { a: 'plain text, not base64!' }, kind: 'ConfigMap', metadata: {} }, false],
    [{ data: { a: 'YQ==' } }, false],
    [{ count: 3, name: 'x' }, false],
  ])('%j → %s', (value, shaped) => {
    expect(secretShaped(value)).toBe(shaped)
  })
  it('drops at any depth and counts', () => {
    expect(withoutSecrets({ a: [{ b: { kind: 'Secret' } }] })).toEqual({ dropped: 1, value: { a: [{ b: '[dropped by the gate: a Secret-shaped object]' }] } })
  })
})
