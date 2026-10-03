import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { builderFromDirectory, type BuilderLookup } from '../src/builder'
import { runGate } from '../src/gate'
import type { HttpRequest, HttpResponse, Transport } from '../src/http'
import { jqcheckEngine } from '../src/jq'
import type { GateContext } from '../src/plan'
import { snowplowClient } from '../src/snowplow'

export const ROOT = join(__dirname, '..')
export const FIXTURES = join(ROOT, '..', 'ui', 'src', 'builders', 'fixtures')
export const jq = jqcheckEngine(process.env.JQCHECK_BIN || join(ROOT, 'bin', 'jqcheck'))

export type Draft = Record<string, any>[]

/** The example page draft (root Flex, PieChart, Table, RESTAction), fresh each call. */
export const example = (): Draft => JSON.parse(readFileSync(join(ROOT, 'examples', 'pod-sizing-page.json'), 'utf8'))

export const byKind = (draft: Draft, kind: string): Record<string, any> => draft.find((cr) => cr.kind === kind)!

export const fixtureLookup = async (name: string): Promise<BuilderLookup> => builderFromDirectory(FIXTURES, name)

export const offlineCtx = (): GateContext => ({
  live: false, snowplow: null, snowplowMissing: 'offline run', jq, deadline: Date.now() + 60_000,
})

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse =>
  ({ status, headers, body: JSON.stringify(body) })

/** A transport that records every request and answers with `handler`. */
export const recorder = (handler: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>) => {
  const requests: HttpRequest[] = []
  const transport: Transport = async (req) => {
    requests.push(req)
    return handler(req)
  }
  return { requests, transport }
}

export const SNOWPLOW = 'http://snowplow.test'
export const ALL_CAPABILITIES = ['call.raw', 'call.dryRun', 'resolve.inline']

export interface FakeSnowplow {
  /** What GET /capabilities advertises; null = 404 (today's snowplow). */
  capabilities?: string[] | null
  /** GET /call?…&raw=true — the stored object, or a status. Default: 404. */
  read?: (url: URL) => HttpResponse
  /** POST /call?…&dryRun=All… Default: 201, confirmed. */
  dryRun?: (url: URL, body: Record<string, any>) => HttpResponse
  /** POST /resolve?dryRun=All. Default: resolves to {status: {pods: []}}, confirmed. */
  resolve?: (body: Record<string, any>) => HttpResponse
}

/** The X-Krateo-Dry-Run: All confirmation the contract requires on a 2xx. */
export const confirmed = (status: number, body: unknown): HttpResponse => json(status, body, { 'x-krateo-dry-run': 'All' })

/** snowplow as docs/snowplow-contract.md describes it, in memory. */
export const fakeSnowplow = (fake: FakeSnowplow = {}) => (req: HttpRequest): HttpResponse => {
  const url = new URL(req.url)
  if (url.pathname === '/capabilities') {
    const offered = fake.capabilities === undefined ? ALL_CAPABILITIES : fake.capabilities
    return offered === null ? json(404, { message: 'not found' }) : json(200, { capabilities: offered })
  }
  if (url.pathname === '/call' && req.method === 'GET') {
    return fake.read ? fake.read(url) : json(404, { kind: 'Status', code: 404, message: 'not found' })
  }
  if (url.pathname === '/call' && req.method === 'POST') {
    return fake.dryRun ? fake.dryRun(url, JSON.parse(req.body ?? '{}')) : confirmed(201, JSON.parse(req.body ?? '{}'))
  }
  if (url.pathname === '/resolve') {
    return fake.resolve ? fake.resolve(JSON.parse(req.body ?? '{}')) : confirmed(200, { status: { pods: [] } })
  }
  return json(404, { message: `no route ${req.method} ${url.pathname}` })
}

/** A live context over a fake snowplow, as the caller `caller-jwt` (or none). */
export const liveCtx = (transport: Transport, opts: { callerToken?: string | null } = {}): GateContext => {
  const token = opts.callerToken === undefined ? 'caller-jwt' : opts.callerToken
  return {
    live: true,
    snowplow: token ? snowplowClient(SNOWPLOW, token, 'krateo-preview', transport) : null,
    snowplowMissing: token ? null : 'no caller token reached the gate',
    jq,
    deadline: Date.now() + 60_000,
  }
}

export const run = (draft: Draft, ctx: GateContext = offlineCtx(), builder = 'portal-builder') =>
  runGate(builder, draft, ctx, fixtureLookup)
