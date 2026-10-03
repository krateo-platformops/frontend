/**
 * The data step: each draft RESTAction run as the caller, as preview runs it — the API server
 * through the hop, jq through snowplow /jq — with the output sampled for the agent. External
 * (endpointRef) stages are in endpoint.test.ts.
 */
import { describe, expect, it } from 'vitest'

import type { HttpRequest } from '../src/http'
import { byKind, example, fakeSnowplowJq, json, liveCtx, recorder, run } from './helpers'

const PODS = {
  kind: 'PodList',
  items: [
    { metadata: { name: 'a', namespace: 'krateo-system' }, status: { phase: 'Running' }, spec: { containers: [{ resources: { requests: { cpu: '250m' } } }, { resources: { requests: { cpu: '0.5' } } }] } },
    { metadata: { name: 'b', namespace: 'krateo-system' }, status: { phase: 'Pending' }, spec: { containers: [{ resources: {} }] } },
  ],
}

const cluster = (req: HttpRequest) => {
  if (req.url.startsWith('http://snowplow.test/jq')) {
    return fakeSnowplowJq(req)
  }
  if (req.url === 'https://hop.test/api/v1/namespaces/krateo-system/pods') {
    return json(200, PODS)
  }
  if (req.url.startsWith('https://hop.test')) {
    return json(404, { message: 'not found' })
  }
  return req.method === 'POST' ? json(201, {}) : json(200, {})
}

describe('data', () => {
  it('runs the RESTAction as the caller and shows the agent its output', async () => {
    const { transport, requests } = recorder(cluster)
    const envelope = await run(example(), liveCtx(transport))
    expect(envelope.ok).toBe(true)
    const data = envelope.steps.find((s) => s.name === 'data')!
    expect(data.notes.join('\n')).toContain('/api/v1/namespaces/krateo-system/pods → 2 item(s)')
    expect(data.notes.join('\n')).toContain('spec.filter yields a object')
    expect(data.notes.join('\n')).toContain('"cpu":750')
    // The caller's token went to the hop and to snowplow, and nowhere else; the gate's own token
    // went only to the API server.
    for (const req of requests) {
      const auth = req.headers?.Authorization
      expect(auth).toBe(req.url.startsWith('https://apiserver.test') ? 'Bearer sa-token' : 'Bearer caller-jwt')
    }
  })

  it('no caller token → notChecked, and red', async () => {
    const { transport } = recorder(cluster)
    const envelope = await run(example(), liveCtx(transport, { callerToken: null }))
    expect(envelope.failedStep).toBe('data')
    expect(envelope.steps.find((s) => s.name === 'data')?.problems[0]).toMatch(/^notChecked: no caller token/)
  })

  it('a draft with no RESTAction has nothing to read', async () => {
    const draft = example().filter((cr) => cr.kind !== 'RESTAction')
    for (const cr of draft) {
      if (cr.spec.apiRef) {
        cr.spec.apiRef = { name: 'compositions-list', namespace: 'krateo-system' }
      }
    }
    const { transport } = recorder(cluster)
    const envelope = await run(draft, liveCtx(transport, { callerToken: null }))
    expect(envelope.ok).toBe(true)
    expect(envelope.steps.find((s) => s.name === 'data')?.notes).toEqual(['no RESTAction in the draft — nothing to read'])
  })

  it('a path the caller cannot read is red, with the status', async () => {
    const draft = example()
    byKind(draft, 'RESTAction').spec.api[0].path = '/api/v1/namespaces/kube-system/pods'
    const { transport } = recorder(cluster)
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(envelope.steps.find((s) => s.name === 'data')?.problems[0]).toMatch(/spec.api\[0\] \(pods\): GET \/api\/v1\/namespaces\/kube-system\/pods on the API server \(as the caller\) answered 404/)
  })

  it('a filter that fails at run time is red, with snowplow\'s message', async () => {
    const draft = example()
    byKind(draft, 'RESTAction').spec.filter = '.pods.items[] | .metadata.name | tonumber'
    const { transport } = recorder(cluster)
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(envelope.steps.find((s) => s.name === 'data')?.problems[0]).toMatch(/spec.filter: /)
  })

  it('a non-GET in-cluster stage is executed as the caller, as preview will, and named in the notes', async () => {
    const draft = example()
    byKind(draft, 'RESTAction').spec.api.push({
      name: 'review', path: '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews', verb: 'POST',
      headers: ['Content-Type: application/json'], payload: '{"spec":{"resourceAttributes":{"verb":"list","resource":"pods"}}}',
    })
    const { transport, requests } = recorder((req) => (req.url.endsWith('/selfsubjectaccessreviews') ? json(201, { status: { allowed: true } }) : cluster(req)))
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.ok).toBe(true)
    const post = requests.find((r) => r.url.endsWith('/selfsubjectaccessreviews'))!
    expect(post).toMatchObject({ method: 'POST', url: 'https://hop.test/apis/authorization.k8s.io/v1/selfsubjectaccessreviews' })
    expect(post.headers).toMatchObject({ Authorization: 'Bearer caller-jwt', 'Content-Type': 'application/json' })
    expect(JSON.parse(post.body!).spec.resourceAttributes.verb).toBe('list')
    expect(envelope.steps.find((s) => s.name === 'data')?.notes.join('\n'))
      .toContain('spec.api[1] (review): executed POST /apis/authorization.k8s.io/v1/selfsubjectaccessreviews on the API server (as the caller)')
  })

  it('a dependsOn iterator renders one path per element, as snowplow does', async () => {
    const draft = example()
    byKind(draft, 'RESTAction').spec.api = [
      { name: 'nss', path: '/api/v1/namespaces', filter: '[.nss.items[] | .metadata.name]' },
      { name: 'pods', path: '${ "/api/v1/namespaces/" + . + "/pods" }', dependsOn: { name: 'nss', iterator: '.nss' } },
    ]
    // One element: snowplow keeps a single response as is (a second would make it a list).
    byKind(draft, 'RESTAction').spec.filter = '{ pods: [ .pods.items[] | { name: .metadata.name, phase: .status.phase, cpu: 0 } ] }'
    const { transport, requests } = recorder((req) => (req.url === 'https://hop.test/api/v1/namespaces'
      ? json(200, { items: [{ metadata: { name: 'krateo-system' } }] })
      : cluster(req)))
    const envelope = await run(draft, liveCtx(transport))
    expect(envelope.ok).toBe(true)
    expect(requests.filter((r) => r.url.startsWith('https://hop.test')).map((r) => r.url)).toEqual([
      'https://hop.test/api/v1/namespaces',
      'https://hop.test/api/v1/namespaces/krateo-system/pods',
    ])
  })
})
