/**
 * useHandleAction — pure-helper coverage for the action-dispatch core.
 *
 * SCOPE: like useWidgetQuery.test.ts, we do NOT render the hook (no RTL / jsdom).
 * Instead we test the pure, dependency-injected helpers the dispatcher is built
 * from — which is where the bug-prone logic actually lives:
 *   - buildPayload       the payload merge → override precedence (the create-form
 *                        metadata.name finding: payloadToOverride must win)
 *   - updateNameNamespace the DELETE/name-namespace query-param rewrite
 *   - interpolateRedirectUrl the ${path} redirect interpolation
 *   - parseJsonResponse  the empty/204-body guard (a successful DELETE must not error)
 *   - fetchWithTimeout   the abort-based request timeout
 *
 * dispatchAction itself — routing, the SSE race and the fan-out fabric — is covered in
 * useHandleActions.dispatch.test.ts, which needs a fully-mocked ActionContext to do it.
 */
/* eslint-disable no-template-curly-in-string -- these tests intentionally use literal ${...} (the jq-override / redirect DSL). */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { restAction } from './__fixtures__/restAction'
import { buildPayload, fetchWithTimeout, interpolateRedirectUrl, parseJsonResponse, updateNameNamespace } from './useHandleActions'

// resolveJq stub: by default echoes a marker so we can see if/when it was called.
const makeResolveJq = (impl?: (expr: string, vals: Record<string, unknown>) => string) =>
  vi.fn((expr: string, vals: Record<string, unknown>): Promise<string> =>
    Promise.resolve(impl ? impl(expr, vals) : `jq(${expr})`))

describe('buildPayload', () => {
  it('merges the action payload and the referenced resource payload', async () => {
    const resolveJq = makeResolveJq()
    const out = await buildPayload(restAction({ payload: { a: 1 } }), { b: 2 }, undefined, resolveJq)
    expect(out).toEqual({ a: 1, b: 2 })
    expect(resolveJq).not.toHaveBeenCalled()
  })

  it('lets the resource payload win over the action payload on conflict', async () => {
    const out = await buildPayload(restAction({ payload: { x: 1, y: 1 } }), { x: 2 }, undefined, makeResolveJq())
    expect(out).toEqual({ x: 2, y: 1 })
  })

  it('payloadToOverride sets a deep path and WINS over the merged value (create-form metadata.name)', async () => {
    // The served resource ref carries an empty metadata.name; the override must replace it.
    const out = await buildPayload(
      restAction({ payloadToOverride: [{ name: 'metadata.name', value: 'real-name' }] }),
      { metadata: { name: '' } },
      { /* customPayload present so overrides apply */ },
      makeResolveJq()
    )
    expect((out as { metadata: { name: string } }).metadata.name).toBe('real-name')
  })

  it('resolves ${...} override values via resolveJq with the customPayload under json', async () => {
    const customPayload = { size: 'large' }
    const resolveJq = makeResolveJq((_e, vals) => (vals.json as { size: string }).size)
    const out = await buildPayload(
      restAction({ payloadToOverride: [{ name: 'spec.size', value: '${.json.size}' }] }),
      {},
      customPayload,
      resolveJq
    )
    expect((out as { spec: { size: string } }).spec.size).toBe('large')
    expect(resolveJq).toHaveBeenCalledWith('${.json.size}', { json: customPayload })
  })

  it('uses literal (non-${) override values as-is without calling resolveJq', async () => {
    const resolveJq = makeResolveJq()
    const out = await buildPayload(
      restAction({ payloadToOverride: [{ name: 'spec.x', value: 'literal' }] }),
      {},
      {},
      resolveJq
    )
    expect((out as { spec: { x: string } }).spec.x).toBe('literal')
    expect(resolveJq).not.toHaveBeenCalled()
  })

  it('skips overrides entirely when customPayload is absent', async () => {
    const resolveJq = makeResolveJq()
    const out = await buildPayload(
      restAction({ payload: { keep: 1 }, payloadToOverride: [{ name: 'metadata.name', value: 'x' }] }),
      {},
      undefined,
      resolveJq
    )
    expect(out).toEqual({ keep: 1 })
    expect(resolveJq).not.toHaveBeenCalled()
  })

  it('prunes empty oneOf handler branches so a probe keeps only its populated handler', async () => {
    // Live regression (krateo-057): editing the `frontend` composition and Saving emitted every
    // probe handler variant, the unfilled ones as `{}`, alongside the populated httpGet — which
    // k8s rejects ("may not specify more than 1 handler type" / "exec.command Required"), wedging
    // the reconcile. The built payload must carry ONLY the populated handler.
    const resourcePayload = {
      spec: {
        livenessProbe: { exec: {}, httpGet: { path: '/', port: 'http' }, tcpSocket: {} },
        readinessProbe: { exec: {}, grpc: {}, httpGet: { path: '/', port: 'http' }, tcpSocket: {} },
      },
    }
    const out = await buildPayload(restAction(), resourcePayload, undefined, makeResolveJq())
    expect(out).toEqual({
      spec: {
        livenessProbe: { httpGet: { path: '/', port: 'http' } },
        readinessProbe: { httpGet: { path: '/', port: 'http' } },
      },
    })
  })

  it('drops a probe that has ONLY empty handler branches (nothing filled) entirely', async () => {
    const out = await buildPayload(
      restAction(),
      { spec: { livenessProbe: { exec: {}, httpGet: {}, tcpSocket: {} }, replicas: 2 } },
      undefined,
      makeResolveJq()
    )
    expect(out).toEqual({ spec: { replicas: 2 } })
  })
})

describe('updateNameNamespace', () => {
  it('appends name & namespace to a path with no query string', () => {
    expect(updateNameNamespace('/api', 'n', 'ns')).toBe('/api?name=n&namespace=ns')
  })

  it('preserves unrelated existing query params', () => {
    expect(updateNameNamespace('/api?foo=bar', 'n', 'ns')).toBe('/api?foo=bar&name=n&namespace=ns')
  })

  it('replaces any existing name / namespace params', () => {
    expect(updateNameNamespace('/api?name=old&keep=1&namespace=oldns', 'n', 'ns')).toBe('/api?keep=1&name=n&namespace=ns')
  })

  /**
   * #528. A cluster-scoped write has no namespace, and snowplow reads an ABSENT
   * `namespace` as "cluster-scoped" (#156). Interpolating an absent one sent the literal
   * `namespace=undefined`, which the apiserver took as a namespace of that name:
   * POST /apis/kyverno.io/v1/namespaces/undefined/clusterpolicies -> 404. Reproduced live
   * on krateo-demo submitting a ClusterPolicy from a Form.
   */
  it('OMITS namespace for a cluster-scoped target — never "undefined", never empty', () => {
    expect(updateNameNamespace('/api', 'n', undefined)).toBe('/api?name=n')
    expect(updateNameNamespace('/api', 'n', '')).toBe('/api?name=n')
    expect(updateNameNamespace('/api?foo=bar', 'n')).toBe('/api?foo=bar&name=n')
  })

  it('still strips a stale namespace when the new target is cluster-scoped', () => {
    // The param must not survive from the ref path: a leftover namespace would make a
    // cluster-scoped write look namespaced, which is the same failure in reverse.
    expect(updateNameNamespace('/api?namespace=oldns&keep=1', 'n', undefined)).toBe('/api?keep=1&name=n')
  })
})

describe('interpolateRedirectUrl', () => {
  it('interpolates a nested ${path} placeholder', () => {
    expect(interpolateRedirectUrl({ user: { id: 123 } }, '/profile/${user.id}')).toBe('/profile/123')
  })

  it('returns the route unchanged when there are no placeholders', () => {
    expect(interpolateRedirectUrl({}, '/static/route')).toBe('/static/route')
  })

  it('returns null when a placeholder cannot be resolved', () => {
    expect(interpolateRedirectUrl({}, '/p/${missing.key}')).toBeNull()
  })

  it('returns null when a placeholder resolves to a non-primitive', () => {
    expect(interpolateRedirectUrl({ user: { id: {} } }, '/p/${user.id}')).toBeNull()
  })
})

describe('parseJsonResponse (empty/204 guard — successful DELETE must not error)', () => {
  it('returns {} for an empty body', () => {
    expect(parseJsonResponse('')).toEqual({})
  })

  it('returns {} for a whitespace-only body', () => {
    expect(parseJsonResponse('   \n')).toEqual({})
  })

  it('parses a non-empty JSON body', () => {
    expect(parseJsonResponse('{"metadata":{"name":"foo"}}')).toEqual({ metadata: { name: 'foo' } })
  })
})

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('resolves with the response and passes an abort signal to fetch', async () => {
    const fakeRes = { ok: true } as Response
    const fetchMock = vi.fn((_input: string, _init?: RequestInit) => Promise.resolve(fakeRes))
    vi.stubGlobal('fetch', fetchMock)

    const res = await fetchWithTimeout('/x', { method: 'GET' }, 1000)

    expect(res).toBe(fakeRes)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/x')
  })

  it('aborts the request once the timeout elapses (no native fetch timeout)', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init.signal ?? undefined
      init.signal?.addEventListener('abort', () => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        reject(err)
      })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = fetchWithTimeout('/x', {}, 5000)
    const rejection = expect(pending).rejects.toThrow('aborted')

    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)

    await rejection
    expect(signal?.aborted).toBe(true)
  })
})
