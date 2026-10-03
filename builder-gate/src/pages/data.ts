/**
 * Step 5, data (#442 D10 c): each RESTAction in the draft is run the way snowplow would run it,
 * READ-ONLY and AS THE CALLER, so the agent sees what the page will actually show before it hands
 * the draft back:
 *   - each api step's path is rendered (a `${ … }` template through snowplow /jq, per iterator
 *     element when the step dependsOn one), then GET as the caller through the cert-replay hop;
 *   - each step's own filter, and then the RESTAction's spec.filter, are run through snowplow
 *     POST /jq as the caller, on the same dict shape snowplow builds (dict[<step name>]; a step
 *     filter sees {<step name>: response}).
 * The output comes back as a short sample plus item counts.
 *
 * NEVER WRITES (#442 D10). Only GET leaves for the API server; POST goes only to /jq, which
 * evaluates and stores nothing. A step the gate cannot replay read-only — a non-GET verb, an
 * endpointRef (a Secret-backed endpoint the gate never reads) — is notChecked, which is red.
 *
 * What it does not reproduce, and says so in its notes: snowplow's userAccessFilter re-filter
 * (the hop already reads with the caller's own RBAC) and request extras / paging (none exist at
 * authoring time).
 */
import { SNOWPLOW_JQ_MAX_BODY } from '../caller'
import { step, type StepResult } from '../envelope'
import type { GateContext } from '../plan'
import { isRestAction, labelOf, maybeQuery, rec, type Rec, str } from './drafts'

/** Iterator elements replayed per step; the rest are counted, not fetched. */
export const ITERATOR_SAMPLE = 10
const SAMPLE_CHARS = 1_200
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
    'read as the caller (cert-replay hop for the API server, snowplow /jq for jq); userAccessFilter is not re-applied — the reads already carry the caller\'s RBAC',
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
      if (rec(api.endpointRef)) {
        problems.push(`${where}: notChecked: it calls through endpointRef ${str(rec(api.endpointRef)?.name) ?? '?'}, a Secret-backed endpoint the gate never reads`)
        complete = false
        continue
      }
      if (verb !== 'GET') {
        problems.push(`${where}: notChecked: verb ${verb} — the gate replays reads only`)
        complete = false
        continue
      }
      const continueOnError = api.continueOnError === true

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
        let path = str(api.path) ?? ''
        const template = maybeQuery(path)
        if (template.ok) {
          // eslint-disable-next-line no-await-in-loop -- one element at a time, inside the budget
          const rendered = await evaluate(template.query, ds)
          if (!rendered.ok) {
            problems.push(`${where}: path: ${rendered.error}`)
            complete = false
            continue
          }
          path = typeof rendered.value === 'string' ? rendered.value : JSON.stringify(rendered.value)
        }
        if (!path.startsWith('/')) {
          problems.push(`${where}: notChecked: path ${JSON.stringify(path)} is not an API-server path, and with no endpointRef snowplow would send it to the API server`)
          complete = false
          continue
        }
        let response: unknown
        try {
          // eslint-disable-next-line no-await-in-loop -- as above
          const reply = await caller.get(path, Math.max(500, timeLeft()))
          if (reply.status !== 200) {
            const message = `GET ${path} answered ${reply.status} ${String(rec(reply.json)?.message ?? '').slice(0, 200)}`
            if (continueOnError) {
              notes.push(`${where}: ${message} (continueOnError)`)
              continue
            }
            problems.push(`${where}: ${message}${reply.status === 401 ? ' — the hop did not accept the caller\'s token' : ''}`)
            complete = false
            continue
          }
          response = reply.json
        } catch (error) {
          problems.push(`${where}: notChecked: GET ${path} failed (${(error as Error).message})`)
          complete = false
          continue
        }
        const items = rec(response)?.items
        counts.push(Array.isArray(items) ? `${path} → ${items.length} item(s)` : `${path} → 1 object`)
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
  return step('data', problems, notes)
}
