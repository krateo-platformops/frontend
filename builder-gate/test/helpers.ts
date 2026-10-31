import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { builderFromDirectory, type BuilderLookup } from '../src/builder'
import { runGate } from '../src/gate'
import type { HttpRequest, HttpResponse, Transport } from '../src/http'
import { jqcheckEngine } from '../src/jq'
import { rec, type Rec } from '../src/pages/drafts'
import type { GateContext } from '../src/plan'
import { snowplowClient } from '../src/snowplow'

export const ROOT = join(__dirname, '..')
export const FIXTURES = join(ROOT, '..', 'ui', 'src', 'builders', 'fixtures')
export const jq = jqcheckEngine(process.env.JQCHECK_BIN || join(ROOT, 'bin', 'jqcheck'))

/**
 * A draft is a list of custom resources, each an untyped JSON object.
 *
 * `Rec` is `Record<string, unknown>` — the product's own type for exactly this (src/pages/drafts),
 * and `unknown` rather than `any` on purpose. With `any`, every `byKind(docs, 'Flex').spec.foo` in
 * these tests was an unchecked member access on an unchecked value, so a typo in a test's path
 * compiled fine and the test then asserted something about a property that was never there.
 * ui/src has zero `no-unsafe-*` eslint disables across the 70 files that use other disables, so
 * accessors are the house pattern and suppression is not.
 */
export type Draft = Rec[]

/** The example page draft (root Flex, PieChart, Table, RESTAction), fresh each call. */
export const example = (): Draft => JSON.parse(readFileSync(join(ROOT, 'examples', 'pod-sizing-page.json'), 'utf8')) as Draft

export const byKind = (draft: Draft, kind: string): Rec => draft.find((cr) => cr.kind === kind)!

/**
 * Step through `path`, carrying `unknown`.
 *
 * It must NOT require each intermediate step to be an object. An intermediate value is frequently
 * an array that the next segment indexes — `spec.resourcesRefs.items[1]` walks object, object,
 * ARRAY, then index — and asserting object-ness at every step rejects exactly that, which is the
 * bug the tests caught in the first version of this helper. Only the caller knows what the final
 * value should be, so only `objAt`/`arrAt` assert, and only on the result.
 */
const walk = (node: Rec, path: (number | string)[]): unknown => {
  let at: unknown = node
  for (const key of path) {
    if (typeof key === 'number') {
      if (!Array.isArray(at)) {
        throw new Error(`${path.join('.')}: cannot index ${JSON.stringify(at)} with [${key}]`)
      }
      at = (at as unknown[])[key]
    } else {
      const obj = rec(at)
      if (obj === null) {
        throw new Error(`${path.join('.')}: cannot read '${key}' of ${JSON.stringify(at)}`)
      }
      at = obj[key]
    }
  }
  return at
}

/**
 * Walk to a nested OBJECT so a test can mutate it.
 *
 * `Rec`'s values are `unknown`, so `cr.spec.widgetData.x = 1` does not type-check — correctly, as
 * nothing guarantees `spec` is an object. This narrows each step with the product's own `rec()` and
 * THROWS on a path that is not there, which is what makes it better than a cast: a test whose path
 * is wrong fails loudly at that line instead of silently asserting about `undefined`.
 */
export const objAt = (node: Rec, ...path: (number | string)[]): Rec => {
  const at = walk(node, path)
  const obj = rec(at)
  if (obj === null) {
    throw new Error(`objAt: ${path.join('.')} resolved to ${JSON.stringify(at)}, not an object`)
  }
  return obj
}

/** Walk to a nested ARRAY, same contract as `objAt`. */
export const arrAt = (node: Rec, ...path: (number | string)[]): unknown[] => {
  const at = walk(node, path)
  if (!Array.isArray(at)) {
    throw new Error(`arrAt: ${path.join('.')} resolved to ${JSON.stringify(at)}, not an array`)
  }
  return at
}

export const fixtureLookup = (name: string): Promise<BuilderLookup> => Promise.resolve(builderFromDirectory(FIXTURES, name))

export const offlineCtx = (): GateContext => ({
  deadline: Date.now() + 60_000, jq, live: false, snowplow: null, snowplowMissing: 'offline run',
})

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse =>
  ({ body: JSON.stringify(body), headers, status })

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
  dryRun?: (url: URL, body: Rec) => HttpResponse
  /** POST /call/read with {extras, object} — default: resolves to {status: {pods: []}}, echoed. */
  resolve?: (url: URL, body: Rec) => HttpResponse
}

/** The echoes snowplow#443 puts on a dry-run reply. */
export const dryRunEcho = { 'x-snowplow-dry-run': 'All', 'x-snowplow-field-validation': 'Strict' }
/** The echoes on an inline resolve reply. */
export const resolveEcho = { 'x-snowplow-dry-run': 'All', 'x-snowplow-resolve-source': 'request-body' }
/** The echo on a raw read. */
export const rawEcho = { 'x-snowplow-raw': 'true' }

export const dryRunReply = (status: number, body: unknown): HttpResponse => json(status, body, dryRunEcho)
/** The stage outcomes header (snowplow PR #469), compact JSON. */
/** `dependsOn` is set only on a `Skipped` outcome (snowplow#904): the stage it depended on. */
export type Outcome = { name: string; ok: boolean; reason?: string; dependsOn?: string }
/** Every stage of a RESTAction, ok — what a clean inline resolve reports. */
/**
 * The pre-#911 success shape: every stage listed, `ok:true`. snowplow no longer sends it — a
 * succeeded stage is simply absent — so it is kept only to assert the gate still reads an older
 * snowplow's answer, and is never the default.
 */
export const allOk = (restAction: Rec): Outcome[] =>
  ((rec(restAction.spec)?.api ?? []) as { name: string }[]).map((api) => ({ name: api.name, ok: true }))

/**
 * An inline resolve reply: both echoes, plus X-Snowplow-Stage-Outcomes. `outcomes` defaults to
 * `[]` — which is what snowplow sends when every stage succeeded (#911). Pass null to leave the
 * header off (a contract violation), or a raw string to send it verbatim.
 */
export const resolveReply = (status: number, body: unknown, outcomes?: Outcome[] | string | null): HttpResponse => {
  const stages = outcomes === undefined ? [] : outcomes
  return json(status, body, {
    ...resolveEcho,
    ...(stages === null ? {} : { 'x-snowplow-stage-outcomes': typeof stages === 'string' ? stages : JSON.stringify(stages) }),
  })
}
export const rawReply = (status: number, body: unknown): HttpResponse => json(status, body, rawEcho)

/** snowplow as snowplow#443 describes it (or, with options, an older or broken one), in memory. */
export const fakeSnowplow = (fake: FakeSnowplow = {}) => (req: HttpRequest): HttpResponse => {
  const url = new URL(req.url)
  if (url.pathname === '/capabilities') {
    const offered = fake.capabilities === undefined ? ALL_CAPABILITIES : fake.capabilities
    return offered === null ? json(404, { message: 'not found' }) : json(200, { capabilities: offered })
  }
  if (url.pathname === '/call' && req.method === 'GET') {
    return fake.read ? fake.read(url) : rawReply(404, { code: 404, kind: 'Status', message: 'not found', reason: 'NotFound' })
  }
  if (url.pathname === '/call/dry-run' && req.method === 'POST') {
    if (fake.dryRunRoute === false) {
      return json(404, { message: '404 page not found' })
    }
    return fake.dryRun ? fake.dryRun(url, JSON.parse(req.body ?? '{}') as Rec) : dryRunReply(201, JSON.parse(req.body ?? '{}'))
  }
  if (url.pathname === '/call/read' && req.method === 'POST') {
    const body = JSON.parse(req.body ?? '{}') as Rec
    return fake.resolve ? fake.resolve(url, body) : resolveReply(200, { ...rec(body.object), status: { pods: [] } })
  }
  return json(404, { message: `no route ${req.method} ${url.pathname}` })
}

/** A live context over a fake snowplow, as the caller `caller-jwt` (or none). */
export const liveCtx = (transport: Transport, opts: { callerToken?: string | null } = {}): GateContext => {
  const token = opts.callerToken === undefined ? 'caller-jwt' : opts.callerToken
  return {
    deadline: Date.now() + 60_000,
    jq,
    live: true,
    snowplow: token ? snowplowClient(SNOWPLOW, token, 'krateo-preview', transport) : null,
    snowplowMissing: token ? null : 'no caller token reached the gate',
  }
}

export const run = (draft: Draft, ctx: GateContext = offlineCtx(), builder = 'portal-builder') =>
  runGate(builder, draft, ctx, fixtureLookup)
