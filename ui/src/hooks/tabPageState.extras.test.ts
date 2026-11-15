/**
 * `tab` is PAGE STATE (which Tabs tab is open), not an input to any data source. The Tabs widget
 * writes it into the address when a tab is chosen, so it must not reach a widget's extras: the
 * serialized extras are the react-query key and snowplow's L1 cache cell key, and carrying `tab`
 * would split every widget's cell by tab and refetch the page on a deep link.
 */
import { describe, expect, it } from 'vitest'

import { buildExtrasParam } from './useWidgetQuery'

const query = (qs: string) => new URLSearchParams(qs)

describe('tab is page state, left out of widget extras', () => {
  it('drops ?tab and keeps every other query key, in order', () => {
    expect(buildExtrasParam(query('range=24h&tab=Telemetry&latencyBy=controller'), {}, undefined, undefined, false))
      .toBe('{"range":"24h","latencyBy":"controller"}')
  })

  it('gives the same key with or without ?tab', () => {
    const without = buildExtrasParam(query('range=1h'), { name: 'x' }, 'Diego', 'diego', true)
    const withTab = buildExtrasParam(query('tab=Traces&range=1h'), { name: 'x' }, 'Diego', 'diego', true)
    expect(withTab).toBe(without)
  })

  it('a URL holding only ?tab is the empty envelope', () => {
    expect(buildExtrasParam(query('tab=Telemetry'), {}, undefined, undefined, false)).toBe('')
  })
})
