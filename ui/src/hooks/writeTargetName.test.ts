/**
 * writeTargetName — the empty-string-name case that made `builder: review` unpublishable.
 *
 * The bug these tests pin (frontend#475, measured 2026-10-07 on krateo-057): the Platform
 * Review "Open change request" drawer built its claim payload from a server-side template,
 * `metadata.name: (.claimName // "")`. When that jq field resolved to nothing the payload
 * carried an EMPTY STRING, not a missing key — and the write path's guard was
 *
 *     const path = (name ?? namespace) ? updateNameNamespace(...) : refPath
 *
 * `??` passes `""` straight through, `""` is falsy, so the ternary dropped BOTH name and
 * namespace and POSTed the bare collection path. snowplow requires both on every verb and
 * answered `400 missing 'name' query parameter` — an error naming the query parameter
 * rather than the empty field behind it. Nothing was created and no BuilderPublish with
 * `builder: review` had ever existed on the cluster.
 */
import { describe, expect, it } from 'vitest'

import { COLLECTION_POST_NAME, writeTargetName } from './callPath'
import { updateNameNamespace } from './useHandleActions'

describe('writeTargetName', () => {
  it('substitutes the collection placeholder when a POST payload has an EMPTY-STRING name', () => {
    // The exact shape the review drawer sent.
    expect(writeTargetName('POST', '')).toBe(COLLECTION_POST_NAME)
  })

  it('substitutes it for a missing name too', () => {
    expect(writeTargetName('POST', undefined)).toBe(COLLECTION_POST_NAME)
    expect(writeTargetName('POST', null)).toBe(COLLECTION_POST_NAME)
  })

  it('keeps a real name on a POST — the placeholder is a fallback, never an override', () => {
    expect(writeTargetName('POST', 'review-55bf5f8454139009')).toBe('review-55bf5f8454139009')
  })

  it('is case-insensitive about the verb', () => {
    expect(writeTargetName('post', '')).toBe(COLLECTION_POST_NAME)
  })

  it('does NOT substitute for name-addressed verbs: a placeholder there would aim the write at a resource called "-"', () => {
    for (const verb of ['PATCH', 'PUT', 'DELETE']) {
      expect(writeTargetName(verb, '')).toBeUndefined()
      expect(writeTargetName(verb, undefined)).toBeUndefined()
    }
    expect(writeTargetName('PATCH', 'p-55bf5f8454139009')).toBe('p-55bf5f8454139009')
  })
})

describe('the regression, end to end on the path', () => {
  const refPath = '/call?apiVersion=composition.krateo.io%2Fv1-8-67&namespace=krateo-system&resource=builderpublishes'

  it('a POST with an empty-string name now carries BOTH name and namespace', () => {
    const name = writeTargetName('POST', '')
    const namespace = 'krateo-system'
    const path = (name ?? namespace) ? updateNameNamespace(refPath, name, namespace) : refPath

    expect(path).toContain(`name=${COLLECTION_POST_NAME}`)
    expect(path).toContain('namespace=krateo-system')
  })

  it('the OLD guard dropped both — the 400 this fixes', () => {
    const name: string | undefined = ''
    const namespace = 'krateo-system'
    const path = (name ?? namespace) ? updateNameNamespace(refPath, name, namespace) : refPath

    // Unchanged: no name, and the namespace lost with it.
    expect(path).toBe(refPath)
    expect(path).not.toContain('name=')
  })
})
