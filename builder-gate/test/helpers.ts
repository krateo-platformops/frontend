import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { builderFromDirectory, type BuilderLookup } from '../src/builder'
import { callerClient } from '../src/caller'
import { runGate } from '../src/gate'
import type { HttpRequest, HttpResponse, Transport } from '../src/http'
import { jqcheckEngine } from '../src/jq'
import { KubeClient } from '../src/kube'
import type { GateContext } from '../src/plan'

export const ROOT = join(__dirname, '..')
export const FIXTURES = join(ROOT, '..', 'ui', 'src', 'builders', 'fixtures')
export const jq = jqcheckEngine(process.env.JQCHECK_BIN || join(ROOT, 'bin', 'jqcheck'))

export type Draft = Record<string, any>[]

/** The example page draft (root Flex, PieChart, Table, RESTAction), fresh each call. */
export const example = (): Draft => JSON.parse(readFileSync(join(ROOT, 'examples', 'pod-sizing-page.json'), 'utf8'))

export const byKind = (draft: Draft, kind: string): Record<string, any> => draft.find((cr) => cr.kind === kind)!

export const fixtureLookup = async (name: string): Promise<BuilderLookup> => builderFromDirectory(FIXTURES, name)

export const offlineCtx = (): GateContext => ({
  live: false, kube: null, caller: null, callerMissing: 'offline run', jq, deadline: Date.now() + 60_000,
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

export const APISERVER = 'https://apiserver.test'
export const HOP = 'https://hop.test'
export const SNOWPLOW = 'http://snowplow.test'

/** A live context over fake servers: the API server (as the gate), and the hop + snowplow (as the caller). */
export const liveCtx = (transport: Transport, opts: { callerToken?: string | null } = {}): GateContext => {
  const token = opts.callerToken === undefined ? 'caller-jwt' : opts.callerToken
  return {
    live: true,
    kube: new KubeClient({ server: APISERVER, token: () => 'sa-token', source: 'test ServiceAccount' }, 'krateo-preview', transport),
    caller: token ? callerClient({ hop: { server: HOP, source: 'test hop' }, snowplowUrl: SNOWPLOW }, token, transport) : null,
    callerMissing: token ? null : 'no caller token reached the gate',
    jq,
    deadline: Date.now() + 60_000,
  }
}

/** snowplow /jq, faithfully: the same engine evaluates the query. */
export const fakeSnowplowJq = async (req: HttpRequest): Promise<HttpResponse> => {
  const { query, data } = JSON.parse(req.body ?? '{}')
  const out = await jq.eval(query, data)
  return out.ok ? json(200, out.value) : json(500, { kind: 'Status', status: 'Failure', message: out.error, code: 500 })
}

export const run = (draft: Draft, ctx: GateContext = offlineCtx(), builder = 'portal-builder') =>
  runGate(builder, draft, ctx, fixtureLookup)
