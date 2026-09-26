/**
 * What a placed node is called: its id (unique, `[a-z0-9-]`, at most 40) and the Helm expression that
 * names the object it renders.
 */
import { describe, expect, it } from 'vitest'

import { PLACED_ID_MAX, placedNameExpression, placedNodeId } from './naming'

describe('placedNodeId', () => {
  it('is the kind, lower-cased', () => {
    expect(placedNodeId('Repository', new Set())).toBe('repository')
    expect(placedNodeId('PersistentVolumeClaim', new Set())).toBe('persistentvolumeclaim')
  })

  it('uniquifies with -2, -3 … against every id and template already taken', () => {
    expect(placedNodeId('Repository', new Set(['repository']))).toBe('repository-2')
    expect(placedNodeId('Repository', new Set(['repository', 'repository-2']))).toBe('repository-3')
  })

  it('reduces anything else to [a-z0-9-], with no leading, trailing or doubled dash', () => {
    expect(placedNodeId('My_Kind.v2', new Set())).toBe('my-kind-v2')
    expect(placedNodeId('__proto__', new Set())).toBe('proto')
    expect(placedNodeId('***', new Set())).toBe('resource')
  })

  it('never produces __proto__ — the one id the descriptor refuses', () => {
    for (const kind of ['__proto__', '__PROTO__', '_proto_']) {
      expect(placedNodeId(kind, new Set())).not.toBe('__proto__')
    }
  })

  it('is at most 40 characters, the suffix included, and never ends on a dash', () => {
    const kind = 'AVeryLongCustomResourceKindNameThatGoesOnAndOn'
    const first = placedNodeId(kind, new Set())
    expect(first).toHaveLength(PLACED_ID_MAX)
    const second = placedNodeId(kind, new Set([first]))
    expect(second.length).toBeLessThanOrEqual(PLACED_ID_MAX)
    expect(second.endsWith('-2')).toBe(true)
    expect(placedNodeId('a'.repeat(39), new Set(['a'.repeat(39)]))).toBe(`${'a'.repeat(38)}-2`)
    expect(placedNodeId(`${'a'.repeat(38)}-b`, new Set([`${'a'.repeat(38)}-b`]))).toBe(`${'a'.repeat(38)}-2`)
  })
})

describe('placedNameExpression', () => {
  it('names one object after the release and the id, as a DNS label', () => {
    expect(placedNameExpression('repository', false)).toBe('printf "%s-repository" $.Release.Name | trunc 63 | trimSuffix "-"')
  })

  it('names each item of a range by its index, the prefix truncated first so the index still fits', () => {
    expect(placedNameExpression('localresource', true))
      .toBe('printf "%s-%d" (printf "%s-localresource" $.Release.Name | trunc 56 | trimSuffix "-") (int $i)')
  })
})
