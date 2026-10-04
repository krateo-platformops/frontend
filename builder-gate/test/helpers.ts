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
/** snowplow#443's capability tokens (snowplow 1.12.36). */
export const ALL_CAPABILITIES = ['call.dryRun', 'call.fieldValidation', 'call.raw', 'call.read.inline']

export interface FakeSnowplow {
  /** What GET /capabilities advertises; null = 404 (snowplow before 1.12.36). */
  capabilities?: string[] | null
  /** Serve /call/dry-run? false = an older snowplow: 404 on the route, nothing written. */
  dryRunRoute?: boolean
  /** GET /call?…&raw=true — default: 404, echoed. */
  read?: (url: URL) => HttpResponse
  /** POST /call/dry-run — default: 201 with the object, echoed. */
  dryRun?: (url: URL, body: Record<string, any>) => HttpResponse
  /** POST /call/read with {extras, object} — default: resolves to {status: {pods: []}}, echoed. */
  resolve?: (url: URL, body: Record<string, any>) => HttpResponse
}

/** The echoes snowplow#443 puts on a dry-run reply. */
export const dryRunEcho = { 'x-snowplow-dry-run': 'All', 'x-snowplow-field-validation': 'Strict' }
/** The echoes on an inline resolve reply. */
export const resolveEcho = { 'x-snowplow-dry-run': 'All', 'x-snowplow-resolve-source': 'request-body' }
/** The echo on a raw read. */
export const rawEcho = { 'x-snowplow-raw': 'true' }

export const dryRunReply = (status: number, body: unknown): HttpResponse => json(status, body, dryRunEcho)
export const resolveReply = (status: number, body: unknown): HttpResponse => json(status, body, resolveEcho)
export const rawReply = (status: number, body: unknown): HttpResponse => json(status, body, rawEcho)

/** snowplow as snowplow#443 describes it (or, with options, an older or broken one), in memory. */
export const fakeSnowplow = (fake: FakeSnowplow = {}) => (req: HttpRequest): HttpResponse => {
  const url = new URL(req.url)
  if (url.pathname === '/capabilities') {
    const offered = fake.capabilities === undefined ? ALL_CAPABILITIES : fake.capabilities
    return offered === null ? json(404, { message: 'not found' }) : json(200, { capabilities: offered })
  }
  if (url.pathname === '/call' && req.method === 'GET') {
    return fake.read ? fake.read(url) : rawReply(404, { kind: 'Status', code: 404, reason: 'NotFound', message: 'not found' })
  }
  if (url.pathname === '/call/dry-run' && req.method === 'POST') {
    if (fake.dryRunRoute === false) {
      return json(404, { message: '404 page not found' })
    }
    return fake.dryRun ? fake.dryRun(url, JSON.parse(req.body ?? '{}')) : dryRunReply(201, JSON.parse(req.body ?? '{}'))
  }
  if (url.pathname === '/call/read' && req.method === 'POST') {
    const body = JSON.parse(req.body ?? '{}')
    return fake.resolve ? fake.resolve(url, body) : resolveReply(200, { ...body.object, status: { pods: [] } })
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
