// @vitest-environment jsdom
/**
 * The Builders are read from the cluster as the signed-in person (ADR 0001): one snowplow `/list` of
 * the `builders` category in BUILDERS_NAMESPACE, with the person's bearer. Every test stubs `fetch` —
 * none reaches the network — and the registry is restored to the fixtures the suite setup installed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Config } from '../context/ConfigContext'
import { invalidateAccessTokenCache } from '../utils/getAccessToken'

import { builderRegistry, buildersStatus, installBuilders } from './builderRegistry'
import {
  BUILDER_CATEGORY,
  ensureBuildersLoaded,
  readClusterBuilders,
  resetBuildersReadForTest,
  resolveBuildersNamespace,
} from './clusterBuilders'
import { fixtureBuilders, fixtureItems } from './fixtures/fixtureBuilders'

const BASE = 'http://snowplow.test'
const NS = 'krateo-system'

const config = (api: Partial<Config['api']> = {}): Config =>
  ({ api: { BUILDERS_NAMESPACE: NS, SNOWPLOW_API_BASE_URL: BASE, ...api }, params: { DELAY_SAVE_NOTIFICATION: '', FRONTEND_NAMESPACE: NS } }) as unknown as Config

const answer = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status })

const stub = (response: Response | Error) => vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)))

const signIn = (token: string) => {
  localStorage.setItem('K_user', JSON.stringify({ accessToken: token }))
  invalidateAccessTokenCache()
}

const names = () => builderRegistry.all().map((builder) => builder.metadata.name)

beforeEach(() => {
  resetBuildersReadForTest()
  signIn('token-a')
})

afterEach(() => {
  localStorage.clear()
  invalidateAccessTokenCache()
  resetBuildersReadForTest()
  installBuilders(fixtureBuilders())
})

describe('readClusterBuilders — the read itself', () => {
  it('is a GET of snowplow /list for the builders category in the namespace, with the person\'s bearer — never /call, never a service identity', async () => {
    const fetchImpl = stub(answer(200, fixtureItems()))
    await readClusterBuilders(`${BASE}/`, NS, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe(`${BASE}/list`)
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ category: BUILDER_CATEGORY, ns: NS })
    expect(init.method ?? 'GET').toBe('GET')
    expect(init.headers).toEqual({ Authorization: 'Bearer token-a' })
  })

  it('success: the three Builders load with no problem', async () => {
    const read = await readClusterBuilders(BASE, NS, stub(answer(200, fixtureItems())))
    expect(read.ok).toBe(true)
    if (!read.ok) { return }
    expect(read.loaded.builders.map((builder) => builder.metadata.name)).toEqual(['portal-builder', 'blueprint-builder', 'controller-builder'])
    expect(read.loaded.problems).toEqual([])
  })

  it('partial: a Builder that does not parse, and one naming an unknown plugin, are problems — the others still load', async () => {
    const [portal, blueprint, controller] = fixtureItems() as Record<string, Record<string, unknown>>[]
    const broken = { ...blueprint, spec: { ...blueprint.spec, route: 42 } }
    const unknownPlugin = { ...controller, spec: { ...controller.spec, canvas: { plugin: 'hologram' } } }
    const read = await readClusterBuilders(BASE, NS, stub(answer(200, [portal, broken, unknownPlugin])))
    expect(read.ok).toBe(true)
    if (!read.ok) { return }
    // The unparseable one is out; the one naming an unknown plugin loads, so its route can say what is wrong.
    expect(read.loaded.builders.map((builder) => builder.metadata.name)).toEqual(['portal-builder', 'controller-builder'])
    expect(read.loaded.problems.some((problem) => problem.startsWith('Builder blueprint-builder: '))).toBe(true)
    expect(read.loaded.problems.some((problem) => problem.startsWith('Builder controller-builder: ') && problem.includes('hologram'))).toBe(true)
  })

  it('reads only Builder objects of builders.templates.krateo.io from the category', async () => {
    const stranger = { apiVersion: 'other.example.io/v1', kind: 'Builder', metadata: { name: 'stranger' }, spec: {} }
    const read = await readClusterBuilders(BASE, NS, stub(answer(200, [...fixtureItems(), stranger])))
    expect(read.ok && read.loaded.problems).toEqual([])
    expect(read.ok && read.loaded.builders).toHaveLength(3)
  })

  it.each([
    ['a 403', stub(answer(403, { message: 'forbidden' })), /you may not list Builders in krateo-system \(403\)/],
    ['a 401', stub(answer(401, {})), /session was not accepted \(401\)/],
    ['a 500', stub(answer(500, {})), /snowplow answered 500 when listing Builders in krateo-system/],
    ['snowplow unreachable', stub(new TypeError('Failed to fetch')), /snowplow could not be reached \(Failed to fetch\)/],
    ['a body that is not a list', stub(answer(200, { items: [] })), /shape this frontend does not understand/],
    ['an empty list (the CRD or its CRs missing)', stub(answer(200, [])), /no Builder is installed in krateo-system/],
  ])('failed: %s is one sentence, never a throw', async (_label, fetchImpl, reason) => {
    const read = await readClusterBuilders(BASE, NS, fetchImpl)
    expect(read.ok).toBe(false)
    expect(!read.ok && read.reason).toMatch(reason)
  })

  it('failed: when no listed Builder parses, the read fails and says why', async () => {
    const read = await readClusterBuilders(BASE, NS, stub(answer(200, [{ apiVersion: 'builders.templates.krateo.io/v1alpha1', kind: 'Builder', metadata: { name: 'empty' } }])))
    expect(read.ok).toBe(false)
    expect(!read.ok && read.reason).toMatch(/none of the 1 Builders in krateo-system could be used: Builder empty: /)
  })
})

describe('resolveBuildersNamespace — install config, no guessed fallback', () => {
  it('reads BUILDERS_NAMESPACE, trimmed; empty or absent is null', () => {
    expect(resolveBuildersNamespace({ BUILDERS_NAMESPACE: ' krateo-system ' })).toBe('krateo-system')
    expect(resolveBuildersNamespace({ BUILDERS_NAMESPACE: '' })).toBeNull()
    expect(resolveBuildersNamespace({})).toBeNull()
    expect(resolveBuildersNamespace(undefined)).toBeNull()
  })
})

describe('ensureBuildersLoaded — the registry, populated after the read', () => {
  it('success: loading while the read is in flight, then the Builders the cluster answered', async () => {
    installBuilders({ builders: [], problems: [] })
    let release: (response: Response) => void = () => undefined
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { release = resolve }))
    const done = ensureBuildersLoaded(config(), fetchImpl)
    expect(buildersStatus()).toEqual({ state: 'loading' })
    release(answer(200, fixtureItems()))
    await done
    expect(buildersStatus()).toEqual({ state: 'loaded' })
    expect(names()).toEqual(['portal-builder', 'blueprint-builder', 'controller-builder'])
  })

  it('partial: the problems are the registry\'s, and the good Builders run', async () => {
    const [portal] = fixtureItems() as Record<string, unknown>[]
    await ensureBuildersLoaded(config(), stub(answer(200, [portal, { apiVersion: 'builders.templates.krateo.io/v1alpha1', kind: 'Builder', metadata: { name: 'bad' } }])))
    expect(buildersStatus()).toEqual({ state: 'loaded' })
    expect(names()).toEqual(['portal-builder'])
    expect(builderRegistry.problems().some((problem) => problem.startsWith('Builder bad: '))).toBe(true)
  })

  it('failed: NO Builder runs — the bundled fixtures never answer instead — and the status carries the sentence', async () => {
    await ensureBuildersLoaded(config(), stub(answer(403, {})))
    expect(names()).toEqual([])
    expect(buildersStatus()).toMatchObject({ state: 'failed' })
    expect((buildersStatus() as { reason: string }).reason).toMatch(/\(403\)/)
  })

  it('failed: no BUILDERS_NAMESPACE, or no snowplow URL, is said without a request', async () => {
    const fetchImpl = stub(answer(200, fixtureItems()))
    await ensureBuildersLoaded(config({ BUILDERS_NAMESPACE: '' }), fetchImpl)
    expect(buildersStatus()).toMatchObject({ state: 'failed' })
    expect((buildersStatus() as { reason: string }).reason).toMatch(/no BUILDERS_NAMESPACE configured/)
    resetBuildersReadForTest()
    await ensureBuildersLoaded(config({ SNOWPLOW_API_BASE_URL: '' }), fetchImpl)
    expect((buildersStatus() as { reason: string }).reason).toMatch(/no snowplow URL configured/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('caches for the session: a second call (a shell remount) does not read again; a new sign-in does', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(answer(200, fixtureItems())))
    await ensureBuildersLoaded(config(), fetchImpl)
    await ensureBuildersLoaded(config(), fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    signIn('token-b')
    await ensureBuildersLoaded(config(), fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit]
    expect(init.headers).toEqual({ Authorization: 'Bearer token-b' })
  })

  it('a slower answer for an earlier sign-in never overwrites the current one', async () => {
    let releaseOld: (response: Response) => void = () => undefined
    const slow = vi.fn(() => new Promise<Response>((resolve) => { releaseOld = resolve }))
    const old = ensureBuildersLoaded(config(), slow)
    signIn('token-b')
    await ensureBuildersLoaded(config(), stub(answer(403, {})))
    releaseOld(answer(200, fixtureItems()))
    await old
    expect(buildersStatus()).toMatchObject({ state: 'failed' })
    expect(names()).toEqual([])
  })
})
