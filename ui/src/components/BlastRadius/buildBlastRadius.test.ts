/**
 * buildBlastRadius — pure-logic coverage for the W0-2 gate kernel.
 *
 * SCOPE: no React / no DOM. We assert the verb→diff mapping (POST=create, PATCH/PUT=update
 * with before/after, DELETE=delete), the object count (1 scalar vs N for a write-set), and
 * the GVR/namespace/name/cluster parse — the shape the human confirms and the audit logs.
 */
import { describe, expect, it } from 'vitest'

import { buildBlastRadius, buildBlastRadiusSet, isMutatingVerb, parseTargetFromPath, type WriteOp } from './buildBlastRadius'

describe('parseTargetFromPath', () => {
  it('parses a namespaced named-object path (named group)', () => {
    expect(parseTargetFromPath('/apis/apps/v1/namespaces/prod/deployments/web')).toEqual({
      gvr: { group: 'apps', resource: 'deployments', version: 'v1' },
      name: 'web',
      namespace: 'prod',
    })
  })

  it('parses a list path (no name) and tolerates a query string + trailing slash', () => {
    expect(parseTargetFromPath('/apis/core.krateo.io/v1/namespaces/ns/compositions/?foo=bar')).toEqual({
      gvr: { group: 'core.krateo.io', resource: 'compositions', version: 'v1' },
      name: undefined,
      namespace: 'ns',
    })
  })

  it('parses the core group (/api/<version>/…) as an empty group', () => {
    expect(parseTargetFromPath('/api/v1/namespaces/kube-system/configmaps/cm')).toEqual({
      gvr: { group: '', resource: 'configmaps', version: 'v1' },
      name: 'cm',
      namespace: 'kube-system',
    })
  })

  it('returns undefined for an unrecognisable path', () => {
    expect(parseTargetFromPath('/not/an/apiserver/url')).toBeUndefined()
    expect(parseTargetFromPath('')).toBeUndefined()
    expect(parseTargetFromPath(undefined)).toBeUndefined()
  })

  // ── snowplow /call?… query shape — what EVERY real widget-action ref carries
  // (snowplow builds them server-side) and what the /call write-path builders emit ──

  it('parses a /call path with a name (the shape real widget actions carry)', () => {
    expect(parseTargetFromPath('/call?apiVersion=composition.krateo.io%2Fv0-1-0&resource=clickhouseoperators&name=clickhouse-operator&namespace=krateo-system')).toEqual({
      gvr: { group: 'composition.krateo.io', resource: 'clickhouseoperators', version: 'v0-1-0' },
      name: 'clickhouse-operator',
      namespace: 'krateo-system',
    })
  })

  it('accepts an unencoded apiVersion slash and any query-param order (snowplow url.Values order)', () => {
    expect(parseTargetFromPath('/call?apiVersion=core.krateo.io/v1alpha1&name=my-def&namespace=demo&resource=compositiondefinitions')).toEqual({
      gvr: { group: 'core.krateo.io', resource: 'compositiondefinitions', version: 'v1alpha1' },
      name: 'my-def',
      namespace: 'demo',
    })
  })

  it('parses a /call collection path (no name param) — a create ref before the client appends one', () => {
    expect(parseTargetFromPath('/call?apiVersion=core.krateo.io%2Fv1alpha1&namespace=krateo-system&resource=compositiondefinitions')).toEqual({
      gvr: { group: 'core.krateo.io', resource: 'compositiondefinitions', version: 'v1alpha1' },
      name: undefined,
      namespace: 'krateo-system',
    })
  })

  it('maps the required-but-ignored collection-POST name placeholder back to "no name"', () => {
    expect(parseTargetFromPath('/call?apiVersion=audit.krateo.io%2Fv1alpha1&resource=auditrecords&name=-&namespace=demo')).toEqual({
      gvr: { group: 'audit.krateo.io', resource: 'auditrecords', version: 'v1alpha1' },
      name: undefined,
      namespace: 'demo',
    })
  })

  it('parses a bare-version apiVersion as the core group', () => {
    expect(parseTargetFromPath('/call?apiVersion=v1&resource=configmaps&name=cm&namespace=kube-system')).toEqual({
      gvr: { group: '', resource: 'configmaps', version: 'v1' },
      name: 'cm',
      namespace: 'kube-system',
    })
  })

  it('returns undefined for a /call path missing apiVersion or resource', () => {
    expect(parseTargetFromPath('/call?resource=configmaps&name=cm&namespace=ns')).toBeUndefined()
    expect(parseTargetFromPath('/call?apiVersion=v1&name=cm&namespace=ns')).toBeUndefined()
    expect(parseTargetFromPath('/call')).toBeUndefined()
  })
})

describe('isMutatingVerb', () => {
  it('is true for the four mutating verbs and false for GET', () => {
    expect(isMutatingVerb('POST')).toBe(true)
    expect(isMutatingVerb('PUT')).toBe(true)
    expect(isMutatingVerb('PATCH')).toBe(true)
    expect(isMutatingVerb('DELETE')).toBe(true)
    expect(isMutatingVerb('GET')).toBe(false)
  })
})

describe('buildBlastRadius', () => {
  it('POST → create diff (after=payload, no before) + count 1', () => {
    const payload = { metadata: { name: 'my-app', namespace: 'demo' }, spec: { x: 1 } }
    const radius = buildBlastRadius({
      path: '/apis/core.krateo.io/v1/namespaces/demo/compositiondefinitions',
      payload,
      verb: 'POST',
    })
    expect(radius).toEqual({
      cluster: 'local',
      count: 1,
      diff: { after: payload, kind: 'create' },
      gvr: { group: 'core.krateo.io', resource: 'compositiondefinitions', version: 'v1' },
      name: 'my-app',
      namespace: 'demo',
      verb: 'POST',
    })
  })

  it('PATCH → update diff carrying both before (current) and after (merge body)', () => {
    const before = { metadata: { name: 'c1', namespace: 'ns' }, spec: { paused: false } }
    const payload = { spec: { paused: true } }
    const radius = buildBlastRadius({
      before,
      path: '/apis/core.krateo.io/v1/namespaces/ns/compositions/c1',
      payload,
      verb: 'PATCH',
    })
    expect(radius.diff).toEqual({ after: payload, before, kind: 'update' })
    expect(radius.verb).toBe('PATCH')
    expect(radius.count).toBe(1)
    expect(radius.name).toBe('c1')
    expect(radius.namespace).toBe('ns')
  })

  it('PUT → update diff (same update kind as PATCH)', () => {
    const payload = { spec: { replicas: 3 } }
    const radius = buildBlastRadius({ path: '/apis/apps/v1/namespaces/ns/deployments/d', payload, verb: 'PUT' })
    expect(radius.diff.kind).toBe('update')
    expect(radius.diff.after).toEqual(payload)
  })

  it('DELETE → delete diff (before = current/identity, no after) + count 1', () => {
    const radius = buildBlastRadius({
      path: '/apis/core.krateo.io/v1/namespaces/ns/compositions/doomed',
      verb: 'DELETE',
    })
    expect(radius.diff.kind).toBe('delete')
    expect(radius.diff.after).toBeUndefined()
    expect(radius.name).toBe('doomed')
    expect(radius.namespace).toBe('ns')
    expect(radius.count).toBe(1)
  })

  it('DELETE surfaces the freshly-read current object as the diff before when supplied', () => {
    const before = { metadata: { name: 'doomed', namespace: 'ns' }, status: { ready: true } }
    const radius = buildBlastRadius({
      before,
      path: '/apis/core.krateo.io/v1/namespaces/ns/compositions/doomed',
      verb: 'DELETE',
    })
    expect(radius.diff).toEqual({ before, kind: 'delete' })
  })

  it('N-object write-set → count = writeSet.length (W0-4 fan-out)', () => {
    const writeSet = [{ metadata: { name: 'a' } }, { metadata: { name: 'b' } }, { metadata: { name: 'c' } }]
    const radius = buildBlastRadius({
      path: '/apis/core.krateo.io/v1/namespaces/ns/compositiondefinitions',
      payload: writeSet[0],
      verb: 'POST',
      writeSet,
    })
    expect(radius.count).toBe(3)
  })

  it('an empty write-set falls back to a scalar count of 1', () => {
    const radius = buildBlastRadius({
      path: '/apis/g/v1/namespaces/ns/things/t',
      payload: {},
      verb: 'POST',
      writeSet: [],
    })
    expect(radius.count).toBe(1)
  })

  it("cluster is 'local' by default and the spoke name when the payload declares a targetRef", () => {
    const local = buildBlastRadius({ path: '/apis/g/v1/namespaces/ns/things', payload: {}, verb: 'POST' })
    expect(local.cluster).toBe('local')

    const spoke = buildBlastRadius({
      path: '/apis/g/v1/namespaces/ns/things',
      payload: { spec: { deploy: { targetRef: { name: 'spoke-eu' } } } },
      verb: 'POST',
    })
    expect(spoke.cluster).toBe('spoke-eu')

    const overridden = buildBlastRadius({
      cluster: 'explicit',
      path: '/apis/g/v1/namespaces/ns/things',
      payload: { spec: { deploy: { targetRef: { name: 'spoke-eu' } } } },
      verb: 'POST',
    })
    expect(overridden.cluster).toBe('explicit')
  })

  it('falls back to an empty GVR (never fabricated) when the ref path is unparseable', () => {
    const radius = buildBlastRadius({ path: '/garbage', payload: { metadata: { name: 'n' } }, verb: 'POST' })
    expect(radius.gvr).toEqual({ group: '', resource: '', version: '' })
    expect(radius.name).toBe('n')
    expect(radius.namespace).toBe('')
  })

  it('prefers the payload metadata.name over the ref path name (create-form names the object)', () => {
    const radius = buildBlastRadius({
      path: '/apis/g/v1/namespaces/ns/things',
      payload: { metadata: { name: 'from-form', namespace: 'ns2' } },
      verb: 'POST',
    })
    expect(radius.name).toBe('from-form')
    expect(radius.namespace).toBe('ns2')
  })
})

describe('buildBlastRadiusSet — the aggregated W0-4 set radius', () => {
  const OPS: WriteOp[] = [
    {
      path: '/apis/core.krateo.io/v1alpha1/namespaces/demo/compositiondefinitions',
      payload: { metadata: { name: 'my-def', namespace: 'demo' }, spec: { x: 1 } },
      verb: 'POST',
    },
    { path: '/api/v1/namespaces/demo/configmaps/cm', payload: { data: { k: 'v' } }, verb: 'PATCH' },
    { path: '/apis/g.krateo.io/v1/namespaces/demo/things/doomed', verb: 'DELETE' },
  ]

  it('count = ops.length and index order = dispatch order', () => {
    const radius = buildBlastRadiusSet(OPS)
    expect(radius.kind).toBe('set')
    expect(radius.count).toBe(3)
    expect(radius.ops.map((op) => op.verb)).toEqual(['POST', 'PATCH', 'DELETE'])
  })

  it('parses each op target like a scalar write (payload metadata preferred over the path)', () => {
    const [post, patch, del] = buildBlastRadiusSet(OPS).ops
    expect(post).toMatchObject({
      gvr: { group: 'core.krateo.io', resource: 'compositiondefinitions', version: 'v1alpha1' },
      name: 'my-def',
      namespace: 'demo',
    })
    expect(patch).toMatchObject({ gvr: { group: '', resource: 'configmaps', version: 'v1' }, name: 'cm' })
    expect(del).toMatchObject({ name: 'doomed', namespace: 'demo' })
  })

  it('flags ONLY the DELETE op irreversible and carries payload previews only where a body exists', () => {
    const [post, patch, del] = buildBlastRadiusSet(OPS).ops
    expect(post.irreversible).toBe(false)
    expect(patch.irreversible).toBe(false)
    expect(del.irreversible).toBe(true)
    expect(post.payloadPreview).toEqual(OPS[0].payload)
    expect(del.payloadPreview).toBeUndefined()
  })

  it('an unparseable path falls back to an empty GVR (never fabricated)', () => {
    const [op] = buildBlastRadiusSet([{ path: '/garbage', payload: { metadata: { name: 'n' } }, verb: 'PUT' }]).ops
    expect(op.gvr).toEqual({ group: '', resource: '', version: '' })
    expect(op.name).toBe('n')
    expect(op.namespace).toBe('')
  })
})

describe('the confirm never shows a secret in clear', () => {
  const SECRET_BODY = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name: 'alice-password', namespace: 'krateo-system' },
    stringData: { password: 'hunter2', username: 'alice' },
    type: 'kubernetes.io/basic-auth',
  }
  const path = '/call?apiVersion=v1&resource=secrets&namespace=krateo-system'

  it('scalar POST of a Secret: stringData values masked in the create diff, keys kept', () => {
    const radius = buildBlastRadius({ path, payload: SECRET_BODY, verb: 'POST' })
    expect(JSON.stringify(radius)).not.toContain('hunter2')
    expect(radius.diff).toEqual({ after: { ...SECRET_BODY, stringData: { password: '••••••', username: '••••••' } }, kind: 'create' })
    // the name the human confirms is still there
    expect(radius.name).toBe('alice-password')
  })

  it('PATCH / DELETE of a Secret: before and after masked', () => {
    const update = buildBlastRadius({ before: { ...SECRET_BODY, data: { password: 'aHVudGVyMg==' } }, path, payload: SECRET_BODY, verb: 'PATCH' })
    expect(JSON.stringify(update)).not.toContain('hunter2')
    expect(JSON.stringify(update)).not.toContain('aHVudGVyMg==')
    const removal = buildBlastRadius({ path, payload: SECRET_BODY, verb: 'DELETE' })
    expect(JSON.stringify(removal)).not.toContain('hunter2')
  })

  it('any kind: a value resolved from a secret form field is masked by its override path', () => {
    const body = { kind: 'Database', metadata: { name: 'db' }, spec: { adminPassword: 'hunter2', size: 'm' } }
    const radius = buildBlastRadius({ maskTargets: ['spec.adminPassword'], path: '/apis/db.io/v1/databases', payload: body, verb: 'POST' })
    expect(JSON.stringify(radius)).not.toContain('hunter2')
    expect(JSON.stringify(radius)).toContain('"size":"m"')
  })

  it('set: every op preview masked (the user-create Secret + User pair)', () => {
    const set = buildBlastRadiusSet([
      { path, payload: SECRET_BODY, verb: 'POST' },
      { maskTargets: ['spec.pin'], path: '/apis/x.io/v1/things', payload: { kind: 'Thing', spec: { pin: '1234' } }, verb: 'POST' },
    ])
    expect(JSON.stringify(set)).not.toContain('hunter2')
    expect(JSON.stringify(set)).not.toContain('1234')
  })
})
