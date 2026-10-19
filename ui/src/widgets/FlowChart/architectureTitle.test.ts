import { describe, expect, it } from 'vitest'

import { architectureTitle } from './architectureVariant'

describe('architectureTitle (portal#311)', () => {
  it('falls back to the display string when a chart sends no names', () => {
    // A composition rendered before portal 1.8.74: `names` is absent and the RESTAction's already
    // shortened string is all there is — today's behaviour, unchanged.
    expect(architectureTitle(undefined, '…-repo')).toBe('…-repo')
    expect(architectureTitle([], '…-000 … 008')).toBe('…-000 … 008')
  })

  it('discloses the full name of a single-instance node', () => {
    expect(architectureTitle(['publish-spring-boot-app-repo'], '…-repo'))
      .toBe('publish-spring-boot-app-repo')
  })

  it('lists every instance behind a range, which the name line cannot show', () => {
    const names = ['publish-spring-boot-app-000', 'publish-spring-boot-app-001', 'publish-spring-boot-app-002']
    expect(architectureTitle(names, '…-000 … 002').split('\n')).toEqual(names)
  })

  it('caps a long list and says how many were left out', () => {
    const names = Array.from({ length: 15 }, (_, i) => `publish-spring-boot-app-${String(i).padStart(3, '0')}`)
    const lines = architectureTitle(names, '…-000 … 014').split('\n')
    expect(lines).toHaveLength(13)
    expect(lines.at(-1)).toBe('… and 3 more')
  })

  it('appends the apiVersion when the chart sends one', () => {
    expect(architectureTitle(['publish-spring-boot-app-pr'], '…-pr', 'github.krateo.io/v2022-11-28').split('\n'))
      .toEqual(['publish-spring-boot-app-pr', 'github.krateo.io/v2022-11-28'])
    expect(architectureTitle(undefined, '…-pr', 'github.krateo.io/v2022-11-28').split('\n'))
      .toEqual(['…-pr', 'github.krateo.io/v2022-11-28'])
  })
})
