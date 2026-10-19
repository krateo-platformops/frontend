/**
 * #493: a widget host can CONTRIBUTE an extras key. The two properties that make this safe are
 * about the serialized string, which is the react-query key and snowplow's L1 cache cell key.
 */
import { describe, expect, it } from 'vitest'

import { buildExtrasParam } from './useWidgetQuery'

const query = (qs: string) => new URLSearchParams(qs)

describe('caller-supplied extras (#493)', () => {
  it('a caller that passes nothing produces a BYTE-IDENTICAL string to before', () => {
    const before = buildExtrasParam(query('range=24h'), { name: 'x', namespace: 'ns' }, 'Diego', 'diego', true)
    const withArg = buildExtrasParam(query('range=24h'), { name: 'x', namespace: 'ns' }, 'Diego', 'diego', true, {})
    // toBe, not toEqual: key ORDER is the cache key.
    expect(withArg).toBe(before)
    expect(before).toBe('{"range":"24h","name":"x","namespace":"ns","displayName":"Diego","username":"diego"}')
  })

  it('an empty envelope with no caller extras is still the empty string', () => {
    expect(buildExtrasParam(query(''), {}, undefined, undefined, false)).toBe('')
    expect(buildExtrasParam(query(''), {}, undefined, undefined, false, {})).toBe('')
  })

  it('a caller key is appended, leaving every existing key in place', () => {
    const extras = buildExtrasParam(query('range=24h'), { name: 'x' }, 'Diego', 'diego', true, { q: 'spring' })
    expect(extras).toBe('{"range":"24h","name":"x","displayName":"Diego","username":"diego","q":"spring"}')
  })

  it('a COLLIDING caller key wins, and does not move', () => {
    // `range` is already first from the query string. The caller overwrites the value; JS keeps a
    // property at its original position on reassignment, so the order is untouched.
    const extras = buildExtrasParam(query('range=24h'), { name: 'x' }, undefined, undefined, false, { range: '7d' })
    expect(extras).toBe('{"range":"7d","name":"x"}')
  })

  it('caller beats a ROUTE param, which is the one precedence that is not obvious', () => {
    // Route beats identity and query; the caller is more specific still, because it is the host
    // saying what it needs rather than what happened to be in scope.
    expect(buildExtrasParam(query(''), { name: 'from-route' }, undefined, undefined, false, { name: 'from-caller' }))
      .toBe('{"name":"from-caller"}')
  })

  it('an undefined caller value is a no-op, not a null key', () => {
    expect(buildExtrasParam(query(''), { name: 'x' }, undefined, undefined, false, { q: undefined }))
      .toBe('{"name":"x"}')
  })

  it('a caller key alone produces an envelope where there would have been none', () => {
    expect(buildExtrasParam(query(''), {}, undefined, undefined, false, { q: 'spring' })).toBe('{"q":"spring"}')
  })
})
