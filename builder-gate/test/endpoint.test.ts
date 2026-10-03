/**
 * endpointRef stages: the endpoint Secret is read AS THE CALLER, the request is built from it the
 * way snowplow builds it, and it goes to server-url — a real HTTP server here — with the
 * endpoint's own credentials. Never the caller's bearer, never a host the draft chose, never a
 * Secret value in what the gate says.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { endpointFromSecret, externalRequest, externalUrl, redact } from '../src/endpoint'
import { type HttpRequest, nodeTransport } from '../src/http'
import { byKind, type Draft, example, fakeSnowplowJq, json, liveCtx, recorder, run } from './helpers'

const b64 = (s: string): string => Buffer.from(s).toString('base64')
const secretOf = (data: Record<string, string>) => ({ kind: 'Secret', data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, b64(v)])) })

const EP_TOKEN = 'ep-token-s3cr3t-value'

describe('externalUrl: the host is server-url\'s, never the draft\'s', () => {
  it('joins server-url and the path as plumbing does', () => {
    expect(externalUrl('https://api.example.test/base/', '/v1/things?limit=5').toString()).toBe('https://api.example.test/base/v1/things?limit=5')
    expect(externalUrl('https://api.example.test', 'v1').toString()).toBe('https://api.example.test/v1')
  })
  it.each([
    ['//evil.test/x'],
    ['/x//evil.test'],
    ['https://evil.test/x'],
    ['http:evil.test'],
    ['/x@evil.test'],
    ['@evil.test/x'],
    ['/\\evil.test'],
    ['/x y'],
    ['/x\n'],
  ])('refuses %j', (path) => {
    expect(() => externalUrl('https://api.example.test', path)).toThrow(/could change the endpoint's scheme or host/)
  })
  it('refuses a path that climbs out of server-url\'s own path', () => {
    expect(() => externalUrl('https://api.example.test/base', '/../admin')).toThrow(/leaves the endpoint's server-url/)
  })
  it('refuses a server-url that is not http(s)', () => {
    expect(() => externalUrl('file:///etc/passwd', '/x')).toThrow(/not http or https/)
  })
})

describe('the request snowplow would send', () => {
  const opts = { method: 'GET', path: '/v1/things', headers: { 'X-Trace': 'a' }, timeoutMs: 1000 }
  it('bearer token', () => {
    const { endpoint } = endpointFromSecret(secretOf({ 'server-url': 'https://api.example.test', token: EP_TOKEN }))
    expect(externalRequest(endpoint!, opts).headers).toEqual({ 'X-Trace': 'a', Authorization: `Bearer ${EP_TOKEN}` })
  })
  it('basic auth', () => {
    const { endpoint } = endpointFromSecret(secretOf({ 'server-url': 'https://api.example.test', username: 'u', password: 'p4ssword' }))
    expect(externalRequest(endpoint!, opts).headers?.Authorization).toBe(`Basic ${b64('u:p4ssword')}`)
  })
  it('a draft Authorization header never replaces the endpoint\'s credentials', () => {
    const { endpoint } = endpointFromSecret(secretOf({ 'server-url': 'https://api.example.test', token: EP_TOKEN }))
    expect(externalRequest(endpoint!, { ...opts, headers: { authorization: 'Bearer forged' } }).headers).toEqual({ Authorization: `Bearer ${EP_TOKEN}` })
  })
  it('AWS SigV4', () => {
    const { endpoint } = endpointFromSecret(secretOf({ 'server-url': 'https://svc.eu-west-1.amazonaws.com', 'aws-access-key': 'AKIDEXAMPLE', 'aws-secret-key': 'wJalrXUtnFEMI', 'aws-region': 'eu-west-1', 'aws-service': 'svc' }))
    const headers = externalRequest(endpoint!, opts).headers!
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/svc\/aws4_request,SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-trace,Signature=[0-9a-f]{64}$/)
    expect(headers.host).toBe('svc.eu-west-1.amazonaws.com')
  })
  it('client certificate: mTLS with the Secret\'s CA (plumbing applies the CA only with a certificate)', () => {
    const { endpoint } = endpointFromSecret(secretOf({ 'server-url': 'https://api.example.test', 'client-certificate-data': b64('CERT'), 'client-key-data': b64('KEY'), 'certificate-authority-data': b64('CA') }))
    const tls = externalRequest(endpoint!, opts).tls!
    expect([tls.cert?.toString(), tls.key?.toString(), tls.ca?.toString()]).toEqual(['CERT', 'KEY', 'CA'])
  })
  it('insecure skips verification; otherwise it is verified', () => {
    const insecure = endpointFromSecret(secretOf({ 'server-url': 'https://api.example.test', insecure: 'true' })).endpoint!
    const strict = endpointFromSecret(secretOf({ 'server-url': 'https://api.example.test' })).endpoint!
    expect(externalRequest(insecure, opts).tls?.rejectUnauthorized).toBe(false)
    expect(externalRequest(strict, opts).tls?.rejectUnauthorized).toBe(true)
  })
  it('more than one auth is refused, as plumbing refuses it', () => {
    const { endpoint } = endpointFromSecret(secretOf({ 'server-url': 'https://api.example.test', token: EP_TOKEN, password: 'p4ssword' }))
    expect(() => externalRequest(endpoint!, opts)).toThrow(/only one must be set/)
  })
  it('a Secret without server-url is refused with snowplow\'s message', () => {
    expect(endpointFromSecret(secretOf({ token: EP_TOKEN })).problem).toBe('missed required attribute for endpoint: server-url')
  })
  it('only credentials are redacted — not server-url or a flag like insecure: "true"', () => {
    const { secrets } = endpointFromSecret(secretOf({ 'server-url': 'https://api.example.test', insecure: 'true', token: EP_TOKEN }))
    expect(redact('{"allowed":true} from https://api.example.test', secrets)).toBe('{"allowed":true} from https://api.example.test')
  })
  it('redact removes every Secret value, decoded or base64', () => {
    const { secrets } = endpointFromSecret(secretOf({ 'server-url': 'https://api.example.test', token: EP_TOKEN }))
    expect(redact(`echo ${EP_TOKEN} and ${b64(EP_TOKEN)}`, secrets)).toBe('echo [redacted] and [redacted]')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// End to end: a real external server, the hop and snowplow faked
// ────────────────────────────────────────────────────────────────────────────

interface Seen { method: string; url: string; headers: IncomingHttpHeaders; body: string }
let server: Server
let base = ''
const seen: Seen[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString() })
      if (req.headers.authorization !== `Bearer ${EP_TOKEN}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'bad credentials' }))
        return
      }
      if (req.url?.startsWith('/v1/echo')) {
        // A careless upstream that echoes the credentials it got, in an error.
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: `rejected ${req.headers.authorization}` }))
        return
      }
      if (req.url?.startsWith('/v1/html')) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html></html>')
        return
      }
      res.writeHead(req.method === 'POST' ? 201 : 200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ items: [{ name: 'a', key: EP_TOKEN }, { name: 'b' }] }))
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => { server.close() })

const external = (secretStatus = 200, secretData: Record<string, string> = { 'server-url': '', token: EP_TOKEN }) => recorder((req: HttpRequest) => {
  if (req.url.startsWith('http://127.0.0.1')) {
    return nodeTransport(req)
  }
  if (req.url.startsWith('http://snowplow.test')) {
    return fakeSnowplowJq(req)
  }
  if (req.url === 'https://hop.test/api/v1/namespaces/krateo-system/secrets/ext-endpoint') {
    return secretStatus === 200
      ? json(200, secretOf({ ...secretData, 'server-url': secretData['server-url'] || base }))
      : json(secretStatus, { kind: 'Status', code: secretStatus, message: `secrets "ext-endpoint" is ${secretStatus === 403 ? 'forbidden' : 'not found'}` })
  }
  if (req.url.startsWith('https://hop.test')) {
    return json(200, { items: [] })
  }
  return req.method === 'POST' ? json(201, {}) : json(200, {})
})

const withExternal = (stage: Record<string, unknown>): Draft => {
  const draft = example()
  const ra = byKind(draft, 'RESTAction')
  ra.spec.api = [{ name: 'things', endpointRef: { name: 'ext-endpoint', namespace: 'krateo-system' }, ...stage }]
  ra.spec.filter = '{ pods: [ .things.items[] | { name: .name, phase: "Running", cpu: 0 } ] }'
  return draft
}

const dataOf = (envelope: Awaited<ReturnType<typeof run>>) => envelope.steps.find((s) => s.name === 'data')!

describe('endpointRef stages, end to end', () => {
  it('reads the Secret as the caller, calls server-url with the endpoint\'s own token, and never sends the caller\'s bearer there', async () => {
    seen.length = 0
    const { transport, requests } = external()
    const envelope = await run(withExternal({ path: '/v1/things?limit=2', headers: ['X-Request: page'] }), liveCtx(transport))
    expect(envelope.ok).toBe(true)
    // The Secret was read through the hop, as the caller.
    const read = requests.find((r) => r.url.endsWith('/secrets/ext-endpoint'))!
    expect(read).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer caller-jwt' } })
    // The external server saw the endpoint's credentials, the draft's header, and nothing of the caller's.
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/v1/things?limit=2' })
    expect(seen[0].headers.authorization).toBe(`Bearer ${EP_TOKEN}`)
    expect(seen[0].headers['x-request']).toBe('page')
    expect(JSON.stringify(seen[0])).not.toContain('caller-jwt')
    expect(dataOf(envelope).notes.join('\n')).toContain('spec.filter yields a object')
  })

  it('no endpoint Secret value appears anywhere in the envelope — not in a sample, not in an error echo', async () => {
    // A filter that keeps everything, so the sample carries what the upstream returned (a key too).
    const keepAll = withExternal({ path: '/v1/things' })
    byKind(keepAll, 'RESTAction').spec.filter = '.things'
    const ok = await run(keepAll, liveCtx(external().transport))
    expect(JSON.stringify(ok)).not.toContain(EP_TOKEN)
    expect(JSON.stringify(ok)).toContain('[redacted]')
    const echoed = await run(withExternal({ path: '/v1/echo' }), liveCtx(external().transport))
    expect(echoed.failedStep).toBe('data')
    expect(dataOf(echoed).problems[0]).toMatch(/answered 500 rejected Bearer \[redacted\]/)
    expect(JSON.stringify(echoed)).not.toContain(EP_TOKEN)
    expect(JSON.stringify(echoed)).not.toContain(b64(EP_TOKEN))
  })

  it.each([
    ['//evil.test/steal'],
    ['https://evil.test/steal'],
    ['/v1@evil.test'],
  ])('a draft path %j cannot move the request off server-url: red, and nothing is sent', async (path) => {
    seen.length = 0
    const { transport, requests } = external()
    const envelope = await run(withExternal({ path }), liveCtx(transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems[0]).toMatch(/could change the endpoint's scheme or host/)
    expect(seen).toHaveLength(0)
    expect(requests.some((r) => r.url.includes('evil.test'))).toBe(false)
  })

  it('a templated path is still pinned to server-url', async () => {
    seen.length = 0
    const { transport } = external()
    const envelope = await run(withExternal({ path: '${ "//evil.test/steal" }' }), liveCtx(transport))
    expect(dataOf(envelope).problems[0]).toMatch(/could change the endpoint's scheme or host/)
    expect(seen).toHaveLength(0)
  })

  it.each([[403], [404]])('a caller who cannot read the endpoint Secret (%i) is red, and named', async (status) => {
    seen.length = 0
    const envelope = await run(withExternal({ path: '/v1/things' }), liveCtx(external(status).transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems[0]).toMatch(new RegExp(`spec.api\\[0\\] \\(things\\): you cannot read endpoint Secret krateo-system/ext-endpoint \\(${status}\\)`))
    expect(seen).toHaveLength(0)
  })

  it('the Secret is never read as the gate', async () => {
    const { transport, requests } = external()
    await run(withExternal({ path: '/v1/things' }), liveCtx(transport))
    expect(requests.filter((r) => r.url.includes('/secrets/')).every((r) => r.headers?.Authorization === 'Bearer caller-jwt' && r.url.startsWith('https://hop.test'))).toBe(true)
    expect(requests.filter((r) => r.headers?.Authorization === 'Bearer sa-token').some((r) => r.url.includes('/secrets'))).toBe(false)
  })

  it('a non-GET external stage is executed as the RESTAction defines it, and named in the notes', async () => {
    seen.length = 0
    const envelope = await run(withExternal({ path: '/v1/things', verb: 'POST', payload: '{"q":"x"}', headers: ['Content-Type: application/json'] }), liveCtx(external().transport))
    expect(envelope.ok).toBe(true)
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/v1/things', body: '{"q":"x"}' })
    expect(dataOf(envelope).notes.join('\n')).toContain(`spec.api[0] (things): executed POST /v1/things on ${new URL(base).host}`)
  })

  it('a 2xx that is not JSON is refused, as snowplow refuses it (406)', async () => {
    const envelope = await run(withExternal({ path: '/v1/html' }), liveCtx(external().transport))
    expect(dataOf(envelope).problems[0]).toMatch(/content type "text\/html", which snowplow refuses \(406\)/)
  })

  it('an unreachable endpoint is notChecked, and red', async () => {
    const envelope = await run(withExternal({ path: '/v1/things' }), liveCtx(external(200, { 'server-url': 'http://127.0.0.1:1', token: EP_TOKEN }).transport))
    expect(envelope.failedStep).toBe('data')
    expect(dataOf(envelope).problems[0]).toMatch(/notChecked: GET \/v1\/things failed/)
  })
})
