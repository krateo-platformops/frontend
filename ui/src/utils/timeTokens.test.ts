/**
 * The one time-token tokenizer (utils/timeTokens), shared by plain widget text and Markdown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hasTimeTokens, splitTimeTokens, timeTokensAsText } from './timeTokens'

beforeEach(() => { vi.useFakeTimers({ now: Date.parse('2026-11-25T15:00:00Z'), toFake: ['Date'] }) })
afterEach(() => { vi.useRealTimers() })

describe('time tokens', () => {
  it('text without a token is one piece, itself', () => {
    expect(splitTimeTokens('created 3d ago')).toEqual(['created 3d ago'])
    expect(splitTimeTokens('Good {localTimeOfDay}')).toEqual(['Good {localTimeOfDay}'])
    expect(hasTimeTokens('created 3d ago')).toBe(false)
    expect(hasTimeTokens(undefined)).toBe(false)
  })

  it('splits text around its tokens, in order', () => {
    expect(splitTimeTokens('since {moment:2026-11-04T10:10:27Z} · {age:2026-10-07T15:00:00Z}')).toEqual([
      'since ', { form: 'moment', value: '2026-11-04T10:10:27Z' }, ' · ', { form: 'age', value: '2026-10-07T15:00:00Z' },
    ])
    expect(splitTimeTokens('{ago:2026-11-25T14:08:00Z}')).toEqual([{ form: 'ago', value: '2026-11-25T14:08:00Z' }])
  })

  it('a token whose time does not parse stays as written', () => {
    expect(splitTimeTokens('since {ago:2026-13-45T99:99:99Z}')).toEqual(['since {ago:2026-13-45T99:99:99Z}'])
    expect(hasTimeTokens('since {ago:2026-13-45T99:99:99Z}')).toBe(false)
  })

  it('as text, for a copy or a download: the words shown', () => {
    expect(timeTokensAsText('created {ago:2026-11-25T14:08:00Z}, {age:2026-10-07T15:00:00Z} old')).toBe('created 52 minutes ago, 7 weeks old')
  })
})
