// @vitest-environment jsdom
/**
 * The pure half of `fieldChecks` / `submitPost`: Retry-After, interpolation, response matching, and
 * the outcomes `sendPost` can end in (timeout, abort, network error, refused path).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAllowlistedPost, PublicPostRefused } from '../../transport/allowlistedPost'

import { firstMatch, formatRetryAfter, interpolate, parseRetryAfter, pickBodyExtras, type PostAnswer, readAnswer, sendPost } from './postOutcome'

const answer = (status: number, body?: unknown, retryAfter?: number): PostAnswer => ({ body, kind: 'answer', retryAfter, status })

describe('Retry-After', () => {
  it.each([
    ['30', 30],
    [' 30 ', 30],
    ['1', 1],
    ['3600', 3600],
    ['0', undefined],
    ['-5', undefined],
    ['1.5', undefined],
    ['abc', undefined],
    ['Wed, 21 Oct 2026 07:28:00 GMT', undefined],
    ['', undefined],
    [null, undefined],
  ])('%j parses to %j', (header, seconds) => {
    expect(parseRetryAfter(header)).toBe(seconds)
  })

  it.each([
    [1, '1 second'],
    [30, '30 seconds'],
    [60, '60 seconds'],
    [61, '2 minutes'],
    [119, '2 minutes'],
    [120, '2 minutes'],
    [121, '3 minutes'],
    [3600, '60 minutes'],
  ])('%i seconds reads "%s" (over 60, whole minutes rounded up)', (seconds, text) => {
    expect(formatRetryAfter(seconds)).toBe(text)
  })
})

describe('interpolation', () => {
  it('fills {value}, {body.x.y} and {retryAfter}, as plain text', () => {
    expect(interpolate('{value} is available.', { value: 'jane-doe' })).toBe('jane-doe is available.')
    expect(interpolate('Your username will be {body.username}.', { body: { username: '<b>jane</b>' } })).toBe('Your username will be <b>jane</b>.')
    expect(interpolate('{body.a.b}', { body: { a: { b: 7 } } })).toBe('7')
    expect(interpolate('Try again in {retryAfter}.', { retryAfter: 90 })).toBe('Try again in 2 minutes.')
  })

  it('a token with no value is empty; an object is never stringified; other braces are left alone', () => {
    expect(interpolate('[{body.missing}]', { body: {} })).toBe('[]')
    expect(interpolate('[{body.a}]', { body: { a: { nested: true } } })).toBe('[]')
    expect(interpolate('[{retryAfter}]', {})).toBe('[]')
    expect(interpolate('{other} {value', { value: 'x' })).toBe('{other} {value')
  })
})

describe('matching: the first entry whose every condition holds, in the CR order', () => {
  const entries = [
    { id: 'available', when: { bodyField: 'status', equals: ['available'], status: [200] } },
    { id: 'any-200', when: { status: [200] } },
    { id: 'rate', when: { status: [429] } },
    { id: 'catch-all' },
    { id: 'never' },
  ]

  it.each([
    [answer(200, { status: 'available' }), 'available'],
    [answer(200, { status: 'unavailable' }), 'any-200'],
    [answer(200, 'not json'), 'any-200'],
    [answer(429), 'rate'],
    [answer(503, { status: 'available' }), 'catch-all'],
  ])('%j selects %s', (outcome, id) => {
    expect(firstMatch(entries, outcome)?.id).toBe(id)
  })

  it('bodyField matches only a string listed in equals', () => {
    const only = [{ id: 'x', when: { bodyField: 'status', equals: ['1'] } }]
    expect(firstMatch(only, answer(200, { status: 1 }))).toBeUndefined()
    expect(firstMatch(only, answer(200, { status: '1' }))?.id).toBe('x')
  })

  it('no answer (timeout, network) matches no entry, not even a catch-all: it is `otherwise`', () => {
    expect(firstMatch(entries, { kind: 'timeout' })).toBeUndefined()
    expect(firstMatch(entries, { kind: 'network' })).toBeUndefined()
  })
})

describe('readAnswer', () => {
  it('reads status, JSON body and Retry-After; a body that is not JSON is undefined', async () => {
    expect(await readAnswer(new Response('{"status":"limit"}', { headers: { 'Retry-After': '30' }, status: 429 }))).toEqual(answer(429, { status: 'limit' }, 30))
    expect(await readAnswer(new Response('<html>', { status: 502 }))).toEqual(answer(502, undefined, undefined))
  })
})

describe('sendPost', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** A fetch that never answers, and rejects like the browser's when its signal aborts. */
  const hanging = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
  })

  const post = createAllowlistedPost(['/intake/'])

  it('times out after 10 s by default, and the request is aborted', async () => {
    fetchMock.mockImplementation(hanging)
    const pending = sendPost(post, '/intake/x', {}, {})
    await vi.advanceTimersByTimeAsync(9_999)
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toEqual({ kind: 'timeout' })
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)
  })

  it('honours a CR timeout', async () => {
    fetchMock.mockImplementation(hanging)
    const pending = sendPost(post, '/intake/x', {}, { timeoutMs: 3000 })
    await vi.advanceTimersByTimeAsync(3000)
    expect(await pending).toEqual({ kind: 'timeout' })
  })

  it('an abort from the caller is `aborted`, not a timeout', async () => {
    fetchMock.mockImplementation(hanging)
    const controller = new AbortController()
    const pending = sendPost(post, '/intake/x', {}, { signal: controller.signal })
    controller.abort()
    expect(await pending).toEqual({ kind: 'aborted' })
  })

  it('a network failure is `network`; a refused path is `refused`, with nothing sent', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await sendPost(post, '/intake/x', {}, {})).toEqual({ kind: 'network' })
    fetchMock.mockClear()
    const refused = await sendPost(post, '/call', {}, {})
    expect(refused.kind).toBe('refused')
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await sendPost(undefined, '/intake/x', {}, {})).kind).toBe('refused')
  })

  it('the refusal is the allowlist\'s own error', async () => {
    await expect(post('//evil.example/intake/x', {})).rejects.toBeInstanceOf(PublicPostRefused)
  })
})

describe('body extras', () => {
  it('maps body keys to page extras, leaving out a key the page was not opened with', () => {
    expect(pickBodyExtras({ submission: 's', token: 't' }, { s: 'SUB', t: 'TOK', x: 'other' })).toEqual({ submission: 'SUB', token: 'TOK' })
    expect(pickBodyExtras({ submission: 's', token: 't' }, { s: 'SUB' })).toEqual({ submission: 'SUB' })
    expect(pickBodyExtras(undefined, { s: 'SUB' })).toEqual({})
  })
})
