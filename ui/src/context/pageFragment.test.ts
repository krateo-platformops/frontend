// @vitest-environment jsdom
/**
 * The fragment reader's pure half: parse, pick only what the page declared, rewrite the address
 * bar without what was read — and where fragment extras sit in the extras precedence, and how a
 * read that carries them avoids the URL.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildExtrasParam, readWithBodyExtras } from '../hooks/useWidgetQuery'
import type { Widget } from '../types/Widget'

import { clearFragment, EMPTY_FRAGMENT_EXTRAS, fragmentKeysOf, fragmentWithout, parseFragment, pickFragment } from './pageFragment'

const rootWith = (annotation?: string) => ({ metadata: { annotations: annotation === undefined ? undefined : { 'krateo.io/fragment-keys': annotation }, uid: 'u' } }) as unknown as Widget

afterEach(() => { window.history.replaceState(null, '', '/') })

describe('parsing and picking', () => {
  it('reads key=value pairs, percent-decoded, ignoring an anchor', () => {
    const { pairs } = parseFragment('#s=a%2Fb&t=T1&anchor')
    expect([...pairs]).toEqual([['s', 'a/b'], ['t', 'T1']])
  })

  it('keeps + literal: a base64 token must not gain spaces', () => {
    const { pairs } = parseFragment('#t=ab+cd')
    expect(pairs.get('t')).toBe('ab+cd')
  })

  it('a page reads only the keys it declares', () => {
    const fragment = parseFragment('#s=1&t=2&u=3')
    expect(pickFragment(fragment, fragmentKeysOf(rootWith('s, t')))).toEqual({ s: '1', t: '2' })
  })

  it('no annotation, an empty one or a malformed key: nothing is read', () => {
    const fragment = parseFragment('#s=1')
    expect(pickFragment(fragment, fragmentKeysOf(rootWith()))).toBe(EMPTY_FRAGMENT_EXTRAS)
    expect(pickFragment(fragment, fragmentKeysOf(rootWith('')))).toBe(EMPTY_FRAGMENT_EXTRAS)
    expect(fragmentKeysOf(rootWith('s=1,ok,a b,{x}'))).toEqual(['ok'])
  })
})

describe('clearing the address bar', () => {
  it('removes the declared keys and keeps every other part byte for byte', () => {
    expect(fragmentWithout('#s=1&anchor&t=2&u=%20', new Set(['s', 't']))).toBe('anchor&u=%20')
    expect(fragmentWithout('#s=1', 'all')).toBe('')
  })

  it('rewrites the CURRENT history entry in place, preserving history.state, adding no entry', () => {
    window.history.replaceState({ idx: 3, key: 'router' }, '', '/x?q=1#s=1&t=2&anchor')
    const { length } = window.history
    clearFragment(new Set(['s', 't']))
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/x?q=1#anchor')
    expect(window.history.state).toEqual({ idx: 3, key: 'router' })
    expect(window.history.length).toBe(length)
  })

  it('drops the # entirely when nothing is left, and never touches history when there is no fragment', () => {
    window.history.replaceState(null, '', '/x#s=1')
    clearFragment(new Set(['s']))
    expect(window.location.href.endsWith('/x')).toBe(true)

    const replace = vi.spyOn(window.history, 'replaceState')
    clearFragment('all')
    expect(replace).not.toHaveBeenCalled()
    replace.mockRestore()
  })
})

describe('fragment extras in the extras envelope', () => {
  it('beat the query string, and lose to identity and to a route param', () => {
    const query = new URLSearchParams('s=from-query&q=search')
    const extras = JSON.parse(buildExtrasParam(query, { username: 'route-user' }, 'Ada', 'ada', true, {}, { displayName: 'spoof', s: 'from-fragment', username: 'spoof' })) as Record<string, string>
    expect(extras.s).toBe('from-fragment')
    expect(extras.q).toBe('search')
    expect(extras.displayName).toBe('Ada')
    expect(extras.username).toBe('route-user')
  })

  it('an empty fragment leaves the envelope byte-identical to before it existed', () => {
    const query = new URLSearchParams('range=24h')
    expect(buildExtrasParam(query, { name: 'n' }, 'Ada', 'ada', true)).toBe(buildExtrasParam(query, { name: 'n' }, 'Ada', 'ada', true, undefined, EMPTY_FRAGMENT_EXTRAS))
  })

  it('a read carrying them is POST /call/read with the envelope in the body and none of it in the URL', async () => {
    const read = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response('{}')))
    const url = new URL('http://sp.test/call?resource=buttons&name=b&extras=%7B%22stale%22%3A1%7D')
    await readWithBodyExtras(read, url, JSON.stringify({ s: 'S1' }))
    const [[sent, init]] = read.mock.calls
    expect(new URL(sent).pathname).toBe('/call/read')
    expect(new URL(sent).searchParams.get('name')).toBe('b')
    expect(sent).not.toContain('extras')
    expect(sent).not.toContain('S1')
    expect(init).toMatchObject({ body: '{"extras":{"s":"S1"}}', method: 'POST' })
  })

  it('refuses an endpoint that is not /call rather than fall back to the query', () => {
    expect(() => readWithBodyExtras(vi.fn(), new URL('http://sp.test/other?x=1'), '{"s":"S1"}')).toThrow()
  })
})
