/**
 * `resolveJqExpression` — the `${ … }` wrapper check, and what it returns.
 *
 * WHY THIS FILE EXISTS (portal#226). The wrapper check used to run on the UNTRIMMED expression and,
 * when it failed, return the expression's own source text with a `console.warn`. A chart writing
 *
 *     value: >
 *       ${ .json as $f | { … } }
 *
 * gets a folded block with a TRAILING NEWLINE, so a perfectly good expression arrived as `"${ … }\n"`,
 * failed `endsWith('}')`, and was handed back verbatim. `buildPayload` then `set()` it into the
 * request body, and the apiserver rejected the write with `.spec: expected map, got ${ .json as $f…`
 * — with nothing shown to the person, because a warn is not an error. The write looked like it
 * worked.
 *
 * So two things are pinned here: whitespace around an expression is tolerated, and an expression
 * that genuinely is not one THROWS rather than becoming payload content.
 */
/* eslint-disable no-template-curly-in-string -- the ${…} jq DSL is the subject under test */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { JqExpressionError, resolveJqExpression } from './jq-expression'

vi.mock('./getAccessToken', () => ({ getAccessToken: () => 'tok' }))

/** A fake /jq that echoes back whatever `answer` is set to, and records the query it was asked. */
let answer: unknown = 'ok'
let queries: string[] = []
const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
  const body = typeof init?.body === 'string' ? init.body : '{}'
  queries.push((JSON.parse(body) as { query: string }).query)
  return Promise.resolve({ json: () => Promise.resolve(answer), ok: true } as unknown as Response)
})

const resolve = (expression: string) => resolveJqExpression('http://sp/jq', expression, { json: { a: 1 } })

beforeEach(() => {
  answer = 'ok'
  queries = []
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('the ${ … } wrapper check is TRIMMED', () => {
  it('resolves an expression with a TRAILING NEWLINE — the folded-YAML case that broke publishing', async () => {
    // Exactly what `value: >` produces in a chart. Before the fix this returned the string
    // '${ .json.a }\n' and that text became the request body.
    await expect(resolve('${ .json.a }\n')).resolves.toBe('ok')
    expect(queries).toEqual([' .json.a '])
  })

  it('resolves with leading whitespace and with surrounding blank lines', async () => {
    await expect(resolve('  ${ .json.a }')).resolves.toBe('ok')
    await expect(resolve('\n\t${ .json.a }\n\n')).resolves.toBe('ok')
    // The trim is on the WRAPPER only — the jq body is passed through untouched, so an expression
    // whose body relies on its own spacing is unaffected.
    expect(queries).toEqual([' .json.a ', ' .json.a '])
  })
})

describe('an expression that is NOT one throws, rather than becoming payload content', () => {
  it('throws JqExpressionError for a bare string, and sends nothing to /jq', async () => {
    await expect(resolve('krateo-system')).rejects.toThrow(JqExpressionError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws for a half-wrapper — the shape a hand-edited chart produces', async () => {
    await expect(resolve('${ .json.a')).rejects.toThrow(JqExpressionError)
    await expect(resolve('.json.a }')).rejects.toThrow(JqExpressionError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the offending expression in the message, truncated, so a chart author can find it', async () => {
    await expect(resolve('not an expression')).rejects.toThrow(/not an expression/)
    const long = `x${'y'.repeat(400)}`
    await expect(resolve(long)).rejects.toThrow(/…/)
  })

  it('a WELL-WRAPPED but jq-invalid expression still never yields its own source text', async () => {
    // The wrapper check cannot judge the jq inside it, and should not try: `${ .json as $f | { a: `
    // trims to something that legitimately starts `${` and ends `}`. So this one reaches /jq and
    // /jq rejects it. What matters for portal#226 is what comes back — NOT the expression. The
    // transport-failure path still returns '' (deliberately unchanged: a failed display template
    // should not abort an action that already succeeded), and '' is not a payload-poisoning value.
    fetchMock.mockImplementationOnce(() => Promise.resolve({ json: () => Promise.resolve(null), ok: false, status: 400, statusText: 'Bad Request' } as unknown as Response))
    const resolved = await resolve('${ .json as $f | { name: $f.a }')
    expect(resolved).toBe('')
    expect(resolved).not.toContain('${')
  })
})

describe('the return type is whatever /jq evaluated to, not a string', () => {
  it('returns an OBJECT unchanged — the whole-map `payloadToOverride` three charts depend on', async () => {
    // `name: spec` with a `${ … }` yielding a map is how agent-create, agents-policy-create and
    // component-detail-scale set a whole spec. This used to be cast `as string` while in fact
    // returning an object, so the type lied about a shipped behaviour.
    answer = { builder: 'page', name: 'page-smoke' }
    await expect(resolve('${ { name: "page-smoke", builder: "page" } }')).resolves.toEqual({ builder: 'page', name: 'page-smoke' })
  })

  it('returns numbers, booleans, arrays and null as themselves', async () => {
    answer = 3
    await expect(resolve('${ .json.a }')).resolves.toBe(3)
    answer = false
    await expect(resolve('${ false }')).resolves.toBe(false)
    answer = ['a', 'b']
    await expect(resolve('${ ["a","b"] }')).resolves.toEqual(['a', 'b'])
    answer = null
    await expect(resolve('${ null }')).resolves.toBeNull()
  })
})
