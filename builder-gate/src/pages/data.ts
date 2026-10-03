/**
 * Step 5, data (#442 D10 c): each RESTAction in the draft is run the way snowplow would run it, AS
 * THE CALLER, so the agent sees what the page will actually show before it hands the draft back:
 *   - each stage's path, headers and payload are rendered (a `${ … }` template through snowplow
 *     /jq, per iterator element when the stage dependsOn one);
 *   - an in-cluster stage goes through the cert-replay hop as the caller, with its own verb;
 *   - an endpointRef stage reads its endpoint Secret AS THE CALLER through the hop (a caller who
 *     cannot read it is red — preview reads it as them too), then calls server-url with that
 *     Secret's own credentials, the host pinned to server-url (endpoint.ts);
 *   - each stage's own filter, and then the RESTAction's spec.filter, are run through snowplow
 *     POST /jq as the caller, on the same dict shape snowplow builds (dict[<stage name>]; a stage
 *     filter sees {<stage name>: response}).
 * The output comes back as a short sample plus item counts, with every endpoint Secret value redacted.
 *
 * NON-READ STAGES RUN (Diego, 2026-10-03, superseding the read-only rule): preview executes them,
 * so the gate does too, and names each one in the notes ("executed POST <path> on <host>").
 * notChecked — red — is kept for real inability only: no caller token, unreachable, a timeout.
 * The gate's OWN identity still never writes: it is not used here at all.
 *
 * What it does not reproduce, and says so in its notes: snowplow's userAccessFilter re-filter
 * (the hop already reads with the caller's own RBAC) and request extras / paging (none exist at
 * authoring time).
 */
import { type CallerReplyWithType, SNOWPLOW_JQ_MAX_BODY } from '../caller'
import { type Endpoint, endpointFromSecret, externalRequest, headersOf, redact } from '../endpoint'
import { step, type StepResult } from '../envelope'
import { HttpError } from '../http'
import type { GateContext } from '../plan'
import { isRestAction, labelOf, maybeQuery, rec, type Rec, str } from './drafts'

/** Iterator elements replayed per step; the rest are counted, not fetched. */
export const ITERATOR_SAMPLE = 10
const SAMPLE_CHARS = 1_200
const DNS1123 = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/
const PER_CALL_MS = 15_000
export const STEP_BUDGET_MS = 40_000

type Eval = { ok: true; value: unknown; engine: string } | { ok: false; error: string }

const describe = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `an array of ${value.length} item(s)`
  }
  const items = rec(value)?.items
  if (Array.isArray(items)) {
    return `an object whose items holds ${items.length} item(s)`
  }
  if (value === null || value === undefined || value === '') {
    return 'EMPTY (null) — the page would render no data'
  }
  return `a ${typeof value}`
}

const sample = (value: unknown): string => {
  const head = Array.isArray(value) ? value.slice(0, 3) : value
  const text = JSON.stringify(head) ?? 'null'
  return text.length > SAMPLE_CHARS ? `${text.slice(0, SAMPLE_CHARS)}…` : text
}

/** snowplow's accumulation (handler.go jsonHandlerCore): first value as is, then a slice. */
const accumulate = (dict: Rec, key: string, value: unknown, filtered: boolean): void => {
  if (!(key in dict)) {
    dict[key] = value
    return
  }
  const got = dict[key]
  const splice = filtered && Array.isArray(value)
  if (Array.isArray(got)) {
    if (splice) {
      got.push(...(value as unknown[]))
    } else {
      got.push(value)
    }
    return
  }
  dict[key] = splice ? [got, ...(value as unknown[])] : [got, value]
}

/** Dependency order (dependsOn.name), or the cycle. */
const ordered = (apis: Rec[]): { order: Rec[]; problem?: string } => {
  const byName = new Map(apis.map((api) => [str(api.name) ?? '', api]))
  const done = new Set<string>()
  const visiting = new Set<string>()
  const order: Rec[] = []
  const visit = (api: Rec): string | undefined => {
    const name = str(api.name) ?? ''
    if (done.has(name)) {
      return undefined
    }
    if (visiting.has(name)) {
      return `spec.api has a dependsOn cycle through ${name}`
    }
    visiting.add(name)
    const dep = str(rec(api.dependsOn)?.name)
    if (dep) {
      const target = byName.get(dep)
      if (!target) {
        return `spec.api (${name}) dependsOn ${dep}, which is not a step of this RESTAction`
      }
      const problem = visit(target)
      if (problem) {
        return problem
      }
    }
    visiting.delete(name)
    done.add(name)
    order.push(api)
    return undefined
  }
  for (const api of apis) {
    const problem = visit(api)
    if (problem) {
      return { order, problem }
    }
  }
  return { order }
}

export const dataStep = async (drafts: readonly Rec[], ctx: GateContext): Promise<StepResult> => {
  const restActions = drafts.map((cr, index) => ({ cr, index })).filter(({ cr }) => isRestAction(cr))
  if (!ctx.live) {
    return step('data', [], ['DISABLED: offline run (--offline) — no data was read'])
  }
  if (restActions.length === 0) {
    return step('data', [], ['no RESTAction in the draft — nothing to read'])
  }
  const caller = ctx.caller
  if (!caller) {
    return step('data', [`notChecked: ${ctx.callerMissing ?? 'no caller identity'} — the gate reads data only as the caller`])
  }

  const problems: string[] = []
  const notes: string[] = [
    'run as the caller (cert-replay hop for the API server and endpoint Secrets, snowplow /jq for jq; external stages with their endpoint\'s own credentials); userAccessFilter is not re-applied — the reads already carry the caller\'s RBAC',
  ]
  const stepDeadline = Math.min(ctx.deadline, Date.now() + STEP_BUDGET_MS)
  const timeLeft = (): number => Math.min(PER_CALL_MS, stepDeadline - Date.now())
  let usedLocalEngine = false

  /** jq as the caller through snowplow; inputs over /jq's 1 MiB cap go to the gate's copy of the same engine. */
  const evaluate = async (query: string, data: unknown): Promise<Eval> => {
    if (timeLeft() < 500) {
      return { ok: false, error: 'notChecked: the step\'s time budget ran out' }
    }
    if (JSON.stringify({ query, data }).length > SNOWPLOW_JQ_MAX_BODY) {
      usedLocalEngine = true
      const local = await ctx.jq.eval(query, data)
      return local.ok ? { ok: true, value: local.value, engine: 'gate' } : { ok: false, error: local.error }
    }
    try {
      const reply = await caller.jq(query, data, timeLeft())
      if (reply.status === 200) {
        return { ok: true, value: reply.json, engine: 'snowplow' }
      }
      if (reply.status === 401 || reply.status === 403) {
        return { ok: false, error: `notChecked: snowplow /jq refused the caller's token (${reply.status})` }
      }
      return { ok: false, error: String(rec(reply.json)?.message ?? reply.body.slice(0, 300)) }
    } catch (error) {
      return { ok: false, error: `notChecked: snowplow /jq could not be reached (${(error as Error).message})` }
    }
  }

  /** A template (`${ … }`) rendered against `ds` through jq, as snowplow's evalJQE; a literal as is. */
  const render = async (text: string, ds: unknown): Promise<string | { error: string }> => {
    const template = maybeQuery(text)
    if (!template.ok) {
      return text
    }
    const out = await evaluate(template.query, ds)
    if (!out.ok) {
      return { error: `${JSON.stringify(text.slice(0, 80))}: ${out.error}` }
    }
    return typeof out.value === 'string' ? out.value : JSON.stringify(out.value)
  }

  // Every endpoint Secret value read this call: nothing the step emits may carry one.
  const secrets = new Set<string>()
  const endpoints = new Map<string, { endpoint: Endpoint } | { problem: string }>()
  /** The endpoint a stage's endpointRef names, read from its Secret AS THE CALLER (never as the gate). */
  const endpointOf = async (ref: Rec, ds: unknown): Promise<{ endpoint: Endpoint } | { problem: string }> => {
    const rawName = str(ref.name) ?? ''
    const named = await render(rawName, ds)
    if (typeof named !== 'string') {
      return { problem: `endpointRef.name: ${named.error}` }
    }
    // snowplow #113 guardrail b: a templated name may not select a per-user credential Secret.
    if (maybeQuery(rawName).ok && named.endsWith('-clientconfig')) {
      return { problem: `endpointRef.name resolved to ${JSON.stringify(named)}, a reserved per-user credential Secret — refused, as snowplow refuses it` }
    }
    const namespace = str(ref.namespace) ?? ''
    if (!DNS1123.test(named) || !DNS1123.test(namespace)) {
      return { problem: `endpointRef ${JSON.stringify(`${namespace}/${named}`)} is not a Secret namespace/name` }
    }
    const key = `${namespace}/${named}`
    const cached = endpoints.get(key)
    if (cached) {
      return cached
    }
    let result: { endpoint: Endpoint } | { problem: string }
    try {
      const reply = await caller.get(`/api/v1/namespaces/${namespace}/secrets/${named}`, Math.max(500, timeLeft()))
      if (reply.status === 403 || reply.status === 404) {
        result = { problem: `you cannot read endpoint Secret ${key} (${reply.status}) — preview reads it as you too, so this stage would fail for you` }
      } else if (reply.status !== 200) {
        result = { problem: `notChecked: reading endpoint Secret ${key} answered ${reply.status}` }
      } else {
        const parsed = endpointFromSecret(reply.json)
        parsed.secrets.forEach((v) => secrets.add(v))
        result = parsed.endpoint ? { endpoint: parsed.endpoint } : { problem: `endpoint Secret ${key}: ${parsed.problem}` }
      }
    } catch (error) {
      result = { problem: `notChecked: reading endpoint Secret ${key} failed (${(error as Error).message})` }
    }
    endpoints.set(key, result)
    return result
  }

  for (const { cr, index } of restActions) {
    const label = labelOf(cr, index)
    const spec = rec(cr.spec) ?? {}
    const apis = (Array.isArray(spec.api) ? spec.api : []).map((a) => rec(a) ?? {})
    const { order, problem: orderProblem } = ordered(apis)
    if (orderProblem) {
      problems.push(`${label}: ${orderProblem}`)
      continue
    }
    const dict: Rec = {}
    let complete = true

    for (const api of order) {
      const k = apis.indexOf(api)
      const name = str(api.name) ?? `api${k}`
      const where = `${label}: spec.api[${k}] (${name})`
      const verb = (str(api.verb) ?? 'GET').toUpperCase()
      const continueOnError = api.continueOnError === true
      const endpointRef = rec(api.endpointRef)

      // The data each request is rendered against: the dict, or each iterator element.
      let contexts: unknown[] = [dict]
      const iterator = str(rec(api.dependsOn)?.iterator)
      if (iterator) {
        // eslint-disable-next-line no-await-in-loop -- steps run in dependency order
        const it = await evaluate(iterator, dict)
        if (!it.ok) {
          problems.push(`${where}: dependsOn.iterator: ${it.error}`)
          complete = false
          continue
        }
        const elements = Array.isArray(it.value) ? it.value : it.value === null ? [] : null
        if (!elements) {
          problems.push(`${where}: dependsOn.iterator must yield an array, got ${describe(it.value)}`)
          complete = false
          continue
        }
        if (elements.length > ITERATOR_SAMPLE) {
          notes.push(`${where}: the iterator yields ${elements.length} elements; the first ${ITERATOR_SAMPLE} were read`)
        }
        contexts = elements.slice(0, ITERATOR_SAMPLE)
      }

      const counts: string[] = []
      for (const ds of contexts) {
        // Path, headers and payload render through jq exactly as snowplow's createRequestOption.
        // eslint-disable-next-line no-await-in-loop -- one element at a time, inside the budget
        const path = await render(str(api.path) ?? '', ds)
        // eslint-disable-next-line no-await-in-loop -- as above
        const headerLines = await Promise.all((Array.isArray(api.headers) ? api.headers : []).map((h) => render(String(h), ds)))
        // eslint-disable-next-line no-await-in-loop -- as above
        const payload = typeof api.payload === 'string' ? await render(api.payload, ds) : undefined
        const failed = [path, ...headerLines, payload].find((r): r is { error: string } => typeof r === 'object' && r !== null && 'error' in r)
        if (failed) {
          problems.push(`${where}: ${failed.error}`)
          complete = false
          continue
        }
        const target = path as string
        const headers = headersOf(headerLines as string[])
        const body = payload as string | undefined

        let reply: CallerReplyWithType
        let shown: string
        try {
          if (endpointRef) {
            // eslint-disable-next-line no-await-in-loop -- as above
            const resolved = await endpointOf(endpointRef, ds)
            if ('problem' in resolved) {
              problems.push(`${where}: ${resolved.problem}`)
              complete = false
              continue
            }
            const request = externalRequest(resolved.endpoint, { method: verb, path: target, headers, payload: body, timeoutMs: Math.max(500, timeLeft()) })
            shown = `${verb} ${new URL(request.url).pathname} on ${new URL(request.url).host}`
            // eslint-disable-next-line no-await-in-loop -- as above
            reply = await caller.external(request)
          } else {
            if (!target.startsWith('/')) {
              problems.push(`${where}: path ${JSON.stringify(target)} is not an API-server path, and with no endpointRef snowplow sends it to the API server`)
              complete = false
              continue
            }
            shown = `${verb} ${target} on the API server (as the caller)`
            // eslint-disable-next-line no-await-in-loop -- as above
            reply = verb === 'GET' ? { ...(await caller.get(target, Math.max(500, timeLeft()))), contentType: 'application/json' } : await caller.replay(verb, target, headers, body, Math.max(500, timeLeft()))
          }
        } catch (error) {
          const message = (error as Error).message
          problems.push(`${where}: ${/^notChecked:/.test(message) ? message : error instanceof HttpError ? `notChecked: ${verb} ${target} failed (${message})` : message}`)
          complete = false
          continue
        }
        if (verb !== 'GET') {
          notes.push(`${where}: executed ${shown} — the validation ran a non-read call, as preview will`)
        }
        if (reply.status < 200 || reply.status >= 300 || (endpointRef && !/json/.test(reply.contentType))) {
          const message = reply.status >= 200 && reply.status < 300
            ? `${shown} answered content type ${JSON.stringify(reply.contentType)}, which snowplow refuses (406)`
            : `${shown} answered ${reply.status} ${String(rec(reply.json)?.message ?? reply.body).slice(0, 200)}`
          if (continueOnError) {
            notes.push(`${where}: ${message} (continueOnError)`)
            continue
          }
          problems.push(`${where}: ${message}${reply.status === 401 && !endpointRef ? ' — the hop did not accept the caller\'s token' : ''}`)
          complete = false
          continue
        }
        const response = reply.json
        const items = rec(response)?.items
        counts.push(Array.isArray(items) ? `${target} → ${items.length} item(s)` : `${target} → 1 object`)
        let value = response
        const filter = str(api.filter)
        if (filter) {
          // eslint-disable-next-line no-await-in-loop -- as above
          const filtered = await evaluate(filter, { [name]: response })
          if (!filtered.ok) {
            problems.push(`${where}: filter: ${filtered.error}`)
            complete = false
            continue
          }
          value = filtered.value
        }
        accumulate(dict, name, value, Boolean(filter))
      }
      if (counts.length > 0) {
        notes.push(`${where}: ${counts.join('; ')}`)
      }
    }

    if (!complete) {
      continue
    }
    const filter = str(spec.filter)
    if (!filter) {
      notes.push(`${label}: no spec.filter — the output is the dict itself: ${describe(dict)}; sample ${sample(dict)}`)
      continue
    }
    // eslint-disable-next-line no-await-in-loop -- RESTActions one at a time
    const out = await evaluate(filter, dict)
    if (!out.ok) {
      problems.push(`${label}: spec.filter: ${out.error}`)
      continue
    }
    notes.push(`${label}: spec.filter yields ${describe(out.value)}; sample ${sample(out.value)}`)
  }
  if (usedLocalEngine) {
    notes.push('some inputs exceeded snowplow /jq\'s 1 MiB body cap and were evaluated by the gate\'s copy of the same engine (jqcheck: snowplow\'s gojq fork and modules)')
  }
  // The last line of defence: whatever a stage, an error echo or a sample carried, no endpoint
  // Secret value leaves the gate.
  return step('data', problems.map((p) => redact(p, secrets)), notes.map((n) => redact(n, secrets)))
}
